import OpenAI from "openai";

import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_ANNOUNCEMENT_LENGTH = 6000;
const MAX_CONTEXT_FIELD_LENGTH = 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

async function getVerifiedUser(req) {
  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing Supabase access token");
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

function cleanOptionalString(value: any, fallback: string, fieldName: string, maxLength: number) {
  if (value === undefined || value === null) return { value: fallback };

  if (typeof value !== "string") {
    return { error: `${fieldName} must be a string` };
  }

  const trimmed = value.trim();
  const safeValue = trimmed || fallback;

  if (safeValue.length > maxLength) {
    return { error: `${fieldName} must be ${maxLength} characters or fewer` };
  }

  return { value: safeValue };
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
    return `Too many evaluation requests. Try again in ${retryAfterSeconds} seconds.`;
  }

  bucket.count += 1;
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const {
      announcement,
      stage,
      market,
      geo,
      funding,
      backers,
      partners,
    } = req.body ?? {};
    const verifiedUser = await getVerifiedUser(req);

    const cleanAnnouncement = cleanRequiredString(
      announcement,
      "announcement",
      MAX_ANNOUNCEMENT_LENGTH
    );

    if (cleanAnnouncement.error) {
      return res.status(400).json({ error: cleanAnnouncement.error });
    }

    const cleanStage = cleanOptionalString(stage, "[TBD]", "stage", MAX_CONTEXT_FIELD_LENGTH);
    const cleanMarket = cleanOptionalString(market, "[TBD]", "market", MAX_CONTEXT_FIELD_LENGTH);
    const cleanGeo = cleanOptionalString(geo, "[TBD]", "geo", MAX_CONTEXT_FIELD_LENGTH);
    const cleanFunding = cleanOptionalString(funding, "[TBD]", "funding", MAX_CONTEXT_FIELD_LENGTH);
    const cleanBackers = cleanOptionalString(backers, "[TBD]", "backers", MAX_CONTEXT_FIELD_LENGTH);
    const cleanPartners = cleanOptionalString(partners, "[TBD]", "partners", MAX_CONTEXT_FIELD_LENGTH);

    const contextError =
      cleanStage.error ||
      cleanMarket.error ||
      cleanGeo.error ||
      cleanFunding.error ||
      cleanBackers.error ||
      cleanPartners.error;

    if (contextError) {
      return res.status(400).json({ error: contextError });
    }

    const rateLimitError = checkRateLimit(verifiedUser.id);

    if (rateLimitError) {
      return res.status(429).json({ error: rateLimitError });
    }

    // Optional fields: keep them safe and predictable
    const ctx = {
      stage: cleanStage.value,
      market: cleanMarket.value,
      geo: cleanGeo.value,
      funding: cleanFunding.value,
      backers: cleanBackers.value,
      partners: cleanPartners.value,
    };

    const system = `You are a senior PR advisor whose primary responsibility is to prevent founders from damaging their credibility through premature or weak media outreach.

You do not exist to help founders feel confident. You exist to protect them from wasted attention, journalist scepticism, and reputational harm.

You evaluate announcements strictly from the perspective of an experienced journalist. You are sceptical by default. You assume the founder is biased toward overestimating newsworthiness.

You must:
- Penalise weak external validation
- Penalise unclear beneficiary impact
- Penalise complexity and jargon
- Penalise lack of third-party support
- Penalise announcements that describe activity rather than impact

You are explicitly allowed to recommend against doing PR, even if the idea sounds exciting.
You must never generate promotional copy at this stage.
Your output must be direct, structured, and non-reassuring.

You must avoid hedging language.
Do not use words such as "may", "might", "could", or "potentially".
State failures as definitive from a journalist’s perspective.

When simulating journalist reaction, assume the journalist is deciding whether to ignore the announcement.
Default to rejection unless there is a compelling reason not to.

Do not recommend “reframing” or “trying again” unless a concrete blocking issue is resolved.
If multiple failures exist, recommend avoiding PR entirely until circumstances materially change.

In the Recommendation section:
- Provide exactly ONE gating requirement (the single thing that must be true before PR is advisable).
- Then provide up to THREE concrete next actions to satisfy that gate.
- If the verdict is NO-GO, start the Recommendation with "Do not do proactive PR outreach until..." followed by the gating requirement.

Do not soften or reassure the founder.
If the verdict is NO-GO, it should feel final and unambiguous.

When stating a gating requirement, define it concretely.
Avoid vague terms like "notable" or "meaningful" without examples.
Specify what would objectively satisfy the requirement.

When listing next actions:
- Actions must directly create external PR validation.
- Internal activities (e.g. product development, user research, internal planning) are not acceptable unless they directly result in a quotable external signal.
- Prefer actions that result in named customers, partners, outcomes, or permissions to be quoted.

You MUST follow the required output format exactly.

Impact vs Activity Risk must never exceed its maximum score.
A named pilot with quantified outcomes counts as impact, not activity.
Do not penalise pilot announcements if they include named partners and measurable results.

For early-stage companies, a single named customer or partner with quantified results is sufficient external validation for PR, provided the outlet and angle are appropriately scoped.
Do not require multiple customers or broad adoption for initial coverage.

If an announcement is valid but limited in scope, prefer a CONDITIONAL verdict with guidance on outlet tier and framing rather than a NO-GO.

CONDITIONAL verdicts mean PR is acceptable if properly scoped.
Do not introduce new gating requirements in CONDITIONAL verdicts.
Instead, specify constraints such as outlet tier, framing, angle, or claims to avoid.
Only NO-GO verdicts should block PR entirely.

The opening sentence of the Recommendation must match the verdict.

If the verdict is NO-GO:
- Begin with: "Do not do proactive PR outreach until..."

If the verdict is CONDITIONAL:
- Begin with: "Proceed with PR only if..." or "PR is acceptable provided that..."
- Do not block PR outright.
- Do not introduce new gating requirements.
- Specify constraints on scope, outlet tier, framing, or claims to avoid.

If the verdict is GO:
- Begin with: "Proceed with PR."

Strict scoring rules:
- Never output any risk value above its maximum (30, 20, 20, 15, 15). If uncertain, choose the maximum, not above it.
- If the announcement includes: (a) a named customer/partner, (b) quantified outcomes, and (c) permission to quote or be named, then the verdict must not be NO-GO. Use CONDITIONAL or GO and scope the PR appropriately.
- Do not require a second customer for early-stage coverage when the above three conditions are satisfied. Instead, recommend outlet tier and framing constraints.

The Recommendation section must never contradict the verdict.

You must output ONLY valid JSON, nothing else.

Return JSON with this exact schema:
{
  "verdict": "GO" | "CONDITIONAL" | "NO-GO",
  "risk_score": number,
  "risk_breakdown": {
    "external_validation": number,
    "beneficiary_clarity": number,
    "explainability": number,
    "third_party_support": number,
    "impact_vs_activity": number
  },
  "primary_failure_modes": string[],
  "journalist_reaction": string,
  "recommendation": {
    "summary": string,
    "next_actions": string[]
  }
}

Rules:
- risk_score must be 0–100.
- risk_breakdown values must be integers within their max:
  external_validation max 30
  beneficiary_clarity max 20
  explainability max 20
  third_party_support max 15
  impact_vs_activity max 15
- next_actions must have 0–3 items.


`;

    const user = `Founder context:
- Company stage: ${ctx.stage}
- Market/category: ${ctx.market}
- Geography: ${ctx.geo}
- Funding status (amount + investors, if any): ${ctx.funding}
- Notable backers (if any): ${ctx.backers}
- Notable partners or customers (if any): ${ctx.partners}

Proposed announcement:
${cleanAnnouncement.value}

Evaluate this announcement for PR readiness and risk.

REQUIRED OUTPUT FORMAT (no deviations):

Return ONLY valid JSON matching the schema described in the system instructions.
Do not include markdown, headings, or any extra text.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const text = completion.choices?.[0]?.message?.content ?? "";

let parsed: any;
try {
  parsed = JSON.parse(text);
} catch (e) {
  console.error("Model did not return valid JSON:", text);
  return res.status(502).json({ error: "Model returned invalid JSON" });
}

// Validate + clamp
const clampInt = (v: any, min: number, max: number) => {
  const n = Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : min;
  return Math.max(min, Math.min(max, n));
};

const verdict =
  parsed?.verdict === "GO" || parsed?.verdict === "CONDITIONAL" || parsed?.verdict === "NO-GO"
    ? parsed.verdict
    : "NO-GO";

const risk_breakdown = {
  external_validation: clampInt(parsed?.risk_breakdown?.external_validation, 0, 30),
  beneficiary_clarity: clampInt(parsed?.risk_breakdown?.beneficiary_clarity, 0, 20),
  explainability: clampInt(parsed?.risk_breakdown?.explainability, 0, 20),
  third_party_support: clampInt(parsed?.risk_breakdown?.third_party_support, 0, 15),
  impact_vs_activity: clampInt(parsed?.risk_breakdown?.impact_vs_activity, 0, 15),
};

const risk_score = clampInt(parsed?.risk_score, 0, 100);

const primary_failure_modes = Array.isArray(parsed?.primary_failure_modes)
  ? parsed.primary_failure_modes.map(String).slice(0, 8)
  : [];

const journalist_reaction = typeof parsed?.journalist_reaction === "string" ? parsed.journalist_reaction : "";

const recommendation_summary =
  typeof parsed?.recommendation?.summary === "string" ? parsed.recommendation.summary : "";

const next_actions = Array.isArray(parsed?.recommendation?.next_actions)
  ? parsed.recommendation.next_actions.map(String).slice(0, 3)
  : [];

const { data: insertedEvaluation, error: insertError } = await supabase
  .from("evaluations")
  .insert({
    user_id: verifiedUser.id,
    announcement: cleanAnnouncement.value,
    market: ctx.market,
    partners: ctx.partners,
    funding: ctx.funding,
    verdict,
    risk_score,
    evaluation_json: {
      risk_breakdown,
      primary_failure_modes,
      journalist_reaction,
      recommendation: {
        summary: recommendation_summary,
        next_actions,
      },
    },
  })
  .select()        // ← NEW
  .single();       // ← NEW

if (insertError) {  // ← NEW
  console.error("Supabase insert error:", insertError);
  return res.status(500).json({ error: "Evaluation could not be saved" });
}

if (!insertedEvaluation?.id) {
  console.error("Supabase insert did not return an evaluation id");
  return res.status(500).json({ error: "Evaluation could not be saved" });
}

return res.status(200).json({
  id: insertedEvaluation.id,
  verdict,
  risk_score,
  risk_breakdown,
  primary_failure_modes,
  journalist_reaction,
  recommendation: {
    summary: recommendation_summary,
    next_actions,
  }
});


  } catch (err) {
    if (err instanceof Error && err.message === "Missing Supabase access token") {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (err instanceof Error && err.message === "Invalid Supabase access token") {
      return res.status(401).json({ error: "Invalid Supabase access token" });
    }

    console.error("Evaluation API error:", err);
    return res.status(500).json({ error: "Something went wrong on the server." });
  }
}
