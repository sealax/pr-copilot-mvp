import { ApiReservation, UsageError, OPENAI_MODEL, OPENAI_TIMEOUT_MS, OPENAI_MAX_RETRIES, validateModelText, validatePromptSize } from "../../lib/server/apiUsage";

import { createDraftReceipt, verifyDemoResult } from "../../lib/server/demoProvenance";
import OpenAI from 'openai';

import { createClient } from '@supabase/supabase-js';
import {
  getDemoVisitorHash,
  verifyDemoEvaluationToken,
} from "../../lib/server/demoUsage";
import {
  isAdminConfigPresent,
  isAdminUser,
  normalizeAdminEmail,
} from "../../lib/server/admin";

export const config = { maxDuration: 45 };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: OPENAI_TIMEOUT_MS, maxRetries: OPENAI_MAX_RETRIES });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_PROMPT_LENGTH = 6000;
const MAX_EVALUATION_ID_LENGTH = 100;
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

export default async function handler(req, res) {
  let reservation: ApiReservation | undefined;
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { prompt, evaluation_id, demoEvaluationToken, evaluationReceipt } = req.body ?? {};
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

    let canonicalPrompt = cleanPrompt.value;
    const demoIpHash = verifiedUser ? null : getDemoVisitorHash(req);
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

      const anonymousResult = verifyDemoResult(evaluationReceipt);
      if (!anonymousResult || anonymousResult.announcement !== cleanPrompt.value ||
          anonymousResult.evaluation.verdict !== demoEvaluation.verdict) {
        return res.status(403).json({ error: "Run a new readiness check before generating a demo draft" });
      }
      canonicalPrompt = anonymousResult.announcement;

      if (!["GO", "CONDITIONAL"].includes(demoEvaluation.verdict)) {
        return res.status(403).json({
          error: "Generation is blocked for NO-GO evaluations",
        });
      }

    }

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

      evaluationId = cleanEvaluationId.value;
      let evaluationVerdict: "GO" | "CONDITIONAL" | "NO-GO" | null = null;

      const { data: evaluation, error: evaluationError } = await supabase
        .from("evaluations")
        .select("id, verdict, user_id, announcement, source, demo_import_id, evaluation_json")
        .eq("id", evaluationId)
        .eq("user_id", verifiedUser.id)
        .single();

      if (evaluationError || !evaluation) {
        return res.status(404).json({ error: "Evaluation not found" });
      }

      evaluationVerdict = evaluation.verdict;

      if (evaluation.source === "anonymous_demo" || evaluation.demo_import_id) {
        const original = verifyDemoResult(evaluation.evaluation_json?.evaluationReceipt, false);
        if (!original || original.importId !== evaluation.demo_import_id ||
            original.announcement !== evaluation.announcement || original.evaluation.verdict !== evaluationVerdict) {
          return res.status(403).json({ error: "This imported evaluation needs reassessment before drafting" });
        }
      }

      if (typeof evaluation.announcement !== "string" || evaluation.announcement.trim() !== cleanPrompt.value) {
        return res.status(409).json({ error: "Announcement changed. Run a new readiness check before drafting" });
      }
      canonicalPrompt = evaluation.announcement;

      if (!["GO", "CONDITIONAL"].includes(evaluationVerdict)) {
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
${canonicalPrompt}`;

    validatePromptSize(system, user);
    reservation = new ApiReservation(supabase, verifiedUser?.id ?? null, adminUser);
    await reservation.reserve(req, "generate");
    await reservation.dispatch();

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      max_completion_tokens: 1500,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
    });

    const text = validateModelText(completion);

    const draftReceipt = !verifiedUser ? createDraftReceipt(evaluationReceipt, text) : undefined;
    const completed = await reservation.complete({ evaluation_id: evaluationId, prompt: canonicalPrompt, output: text });
    return res.status(200).json({
      response: text,
      ...(verifiedUser ? { generation_id: completed.id } : { draftReceipt }),
      ...completed.usage,
    });

  } catch (err) {
    await reservation?.release();
    if (err instanceof UsageError) return res.status(err.status).json({ error: err.message, ...err.usage });
    if (err instanceof Error && err.message === "Invalid Supabase access token") {
      return res.status(401).json({ error: "Invalid Supabase access token" });
    }

    console.error('API error:', err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
