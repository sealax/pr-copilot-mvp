import OpenAI from 'openai';

import { createClient } from '@supabase/supabase-js';
import {
  consumeDemoDraft,
  getDemoAllowance,
  getDemoVisitorHash,
  verifyDemoEvaluationToken,
} from "../../lib/server/demoUsage";
import {
  ADMIN_USAGE_SENTINEL,
  isAdminConfigPresent,
  isAdminUser,
  normalizeAdminEmail,
} from "../../lib/server/admin";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FREE_GENERATION_LIMIT = 5;
const MAX_PROMPT_LENGTH = 6000;
const MAX_EVALUATION_ID_LENGTH = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

async function getOptionalVerifiedUser(req) {
  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const accessToken = authHeader.slice("Bearer ".length);
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data?.user) {
    throw new Error("Invalid Supabase access token");
  }

  return data.user;
}

function cleanRequiredString(value: any, fieldName: string, maxLength: number) {
  if (typeof value !== "string") {
    return { error: `${fieldName} is required` };
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return { error: `${fieldName} cannot be empty` };
  }

  if (trimmed.length > maxLength) {
    return { error: `${fieldName} must be ${maxLength} characters or fewer` };
  }

  return { value: trimmed };
}

function checkRateLimit(userId: string) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(userId);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    return `Too many generation requests. Try again in ${retryAfterSeconds} seconds.`;
  }

  bucket.count += 1;
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { prompt, evaluation_id, demoEvaluationToken } = req.body;
    const verifiedUser = await getOptionalVerifiedUser(req);
    const adminUser = isAdminUser(verifiedUser);

    console.info("[admin-generate-diagnostic]", {
      adminConfigPresent: isAdminConfigPresent(),
      authenticatedEmail: normalizeAdminEmail(verifiedUser?.email),
      isAdmin: adminUser,
    });

    const cleanPrompt = cleanRequiredString(prompt, "prompt", MAX_PROMPT_LENGTH);

    if (cleanPrompt.error) {
      return res.status(400).json({ error: cleanPrompt.error });
    }

    const demoIpHash = verifiedUser ? null : getDemoVisitorHash(req);
    const rateLimitError = adminUser
      ? null
      : checkRateLimit(verifiedUser?.id ?? `demo:${demoIpHash}`);

    if (rateLimitError) {
      return res.status(429).json({ error: rateLimitError });
    }

    if (!verifiedUser && demoIpHash) {
      const demoEvaluation = verifyDemoEvaluationToken(
        demoEvaluationToken,
        demoIpHash,
        cleanPrompt.value
      );

      if (!demoEvaluation) {
        return res.status(403).json({
          error: "Run a PR readiness check before generating a demo draft",
        });
      }

      if (demoEvaluation.verdict === "NO-GO") {
        return res.status(403).json({
          error: "Generation is blocked for NO-GO evaluations",
        });
      }

      const demoAllowance = await getDemoAllowance(supabase, demoIpHash);

      if (demoAllowance.remainingDrafts <= 0) {
        return res.status(403).json({
          error: "Free demo draft limit reached",
          ...demoAllowance,
        });
      }
    }

    let generationsUsed: number | null = null;
    let evaluationId: string | null = null;

    if (verifiedUser) {
      const cleanEvaluationId = cleanRequiredString(
        evaluation_id,
        "evaluation_id",
        MAX_EVALUATION_ID_LENGTH
      );

      if (cleanEvaluationId.error) {
        return res.status(400).json({ error: cleanEvaluationId.error });
      }

      if (!adminUser) {
        const { count, error: usageError } = await supabase
          .from("generations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", verifiedUser.id);

        if (usageError || typeof count !== "number") {
          console.error("Supabase usage count error:", usageError);
          return res.status(500).json({ error: "Could not check generation usage" });
        }

        generationsUsed = count;

        if (generationsUsed >= FREE_GENERATION_LIMIT) {
          return res.status(403).json({
            error: "Free generation limit reached",
            generations_used: generationsUsed,
            remaining_generations: 0,
          });
        }
      }

      evaluationId = cleanEvaluationId.value;
      let evaluationVerdict: "GO" | "CONDITIONAL" | "NO-GO" | null = null;

      const { data: evaluation, error: evaluationError } = await supabase
        .from("evaluations")
        .select("id, verdict, user_id")
        .eq("id", evaluationId)
        .eq("user_id", verifiedUser.id)
        .single();

      if (evaluationError || !evaluation) {
        return res.status(404).json({ error: "Evaluation not found" });
      }

      evaluationVerdict = evaluation.verdict;

      if (evaluationVerdict === "NO-GO") {
        return res.status(403).json({ error: "Generation is blocked for NO-GO evaluations" });
      }
    }

    const system = `You are a senior tech PR professional.
Write crisp, credible press releases. Avoid hype and generic advice.
If key details are missing, make minimal reasonable assumptions and mark them as [TBD].`;

    const user = `Create a press release draft based on the announcement brief below.

Output format:
1) HEADLINE (max 14 words)
2) SUBHEAD (max 22 words)
3) BODY (250–450 words, AP-style, short paragraphs, Do NOT include quotes in the body text.)
4) QUOTE (1 founder/executive quote, 2–3 sentences)
5) BOILERPLATE (2–3 sentences)
6) MEDIA CONTACT (Name, email, phone as [TBD] if unknown)

Brief:
${cleanPrompt.value}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
    });

    const text = completion.choices?.[0]?.message?.content ?? '';

    if (!verifiedUser && demoIpHash) {
      const demoAllowance = await consumeDemoDraft(supabase, demoIpHash);

      if (!demoAllowance) {
        const currentAllowance = await getDemoAllowance(supabase, demoIpHash);
        return res.status(403).json({
          error: "Free demo draft limit reached",
          ...currentAllowance,
        });
      }

      return res.status(200).json({
        response: text,
        ...demoAllowance,
      });
    }

    const { data, error } = await supabase
      .from("generations")
      .insert({
        evaluation_id: evaluationId,
        user_id: verifiedUser!.id,
        prompt: cleanPrompt.value,
        output: text,
        model: "gpt-4o-mini",
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "Could not save generation" });
    }

    if (!data?.id) {
      console.error("Supabase generation insert did not return an id");
      return res.status(500).json({ error: "Could not save generation" });
    }

    const nextGenerationsUsed = adminUser
      ? 0
      : (generationsUsed ?? 0) + 1;

    return res.status(200).json({
      response: text,
      generation_id: data.id,
      generations_used: nextGenerationsUsed,
      remaining_generations: adminUser
        ? ADMIN_USAGE_SENTINEL
        : Math.max(0, FREE_GENERATION_LIMIT - nextGenerationsUsed),
    });

  } catch (err) {
    if (err instanceof Error && err.message === "Invalid Supabase access token") {
      return res.status(401).json({ error: "Invalid Supabase access token" });
    }

    console.error('API error:', err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
