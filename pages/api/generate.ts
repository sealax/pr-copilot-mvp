import OpenAI from 'openai';
import { createHmac, timingSafeEqual } from 'crypto';

import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const tokenSecret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.OPENAI_API_KEY ?? "";

async function getVerifiedUser(req) {
  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) return null;

  const accessToken = authHeader.slice("Bearer ".length);
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data?.user) {
    throw new Error("Invalid Supabase access token");
  }

  return data.user;
}

function verifyEvaluationToken(token: string, prompt: string) {
  const [payload, signature] = token.split(".");

  if (!payload || !signature) return null;

  const expectedSignature = createHmac("sha256", tokenSecret).update(payload).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const expectedAnnouncementHash = createHmac("sha256", tokenSecret).update(prompt).digest("hex");

  if (parsed?.announcement_hash !== expectedAnnouncementHash) return null;

  return parsed?.verdict === "GO" || parsed?.verdict === "CONDITIONAL" || parsed?.verdict === "NO-GO"
    ? parsed.verdict
    : null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { prompt, evaluation_id, evaluation_token } = req.body;
    const verifiedUser = await getVerifiedUser(req);

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    let evaluationId = typeof evaluation_id === "string" ? evaluation_id : null;
    let evaluationVerdict: "GO" | "CONDITIONAL" | "NO-GO" | null = null;

    if (evaluationId) {
      let evaluationQuery = supabase
        .from("evaluations")
        .select("id, verdict, user_id")
        .eq("id", evaluationId);

      if (verifiedUser) {
        evaluationQuery = evaluationQuery.eq("user_id", verifiedUser.id);
      } else {
        evaluationQuery = evaluationQuery.is("user_id", null);
      }

      const { data: evaluation, error: evaluationError } = await evaluationQuery.single();

      if (evaluationError || !evaluation) {
        return res.status(404).json({ error: "Evaluation not found" });
      }

      evaluationVerdict = evaluation.verdict;
    } else if (typeof evaluation_token === "string") {
      evaluationVerdict = verifyEvaluationToken(evaluation_token, prompt);

      if (!evaluationVerdict) {
        return res.status(400).json({ error: "Invalid evaluation token" });
      }
    } else {
      return res.status(400).json({ error: "Missing evaluation_id" });
    }

    if (evaluationVerdict === "NO-GO") {
      return res.status(403).json({ error: "Generation is blocked for NO-GO evaluations" });
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
${prompt}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
    });

    const text = completion.choices?.[0]?.message?.content ?? '';

    const { data, error } = await supabase
      .from("generations")
      .insert({
        evaluation_id: evaluationId,
        user_id: verifiedUser?.id ?? null,
        prompt,
        output: text,
        model: "gpt-4o-mini",
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
    }

    return res.status(200).json({
      response: text,
      generation_id: data?.id ?? null,
    });

  } catch (err) {
    if (err instanceof Error && err.message === "Invalid Supabase access token") {
      return res.status(401).json({ error: "Invalid Supabase access token" });
    }

    console.error('API error:', err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
