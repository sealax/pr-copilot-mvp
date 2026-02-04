import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

    if (!announcement || typeof announcement !== "string") {
      return res.status(400).json({ error: "Missing announcement" });
    }

    // Optional fields: keep them safe and predictable
    const ctx = {
      stage: typeof stage === "string" ? stage : "[TBD]",
      market: typeof market === "string" ? market : "[TBD]",
      geo: typeof geo === "string" ? geo : "[TBD]",
      funding: typeof funding === "string" ? funding : "[TBD]",
      backers: typeof backers === "string" ? backers : "[TBD]",
      partners: typeof partners === "string" ? partners : "[TBD]",
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


`;

    const user = `Founder context:
- Company stage: ${ctx.stage}
- Market/category: ${ctx.market}
- Geography: ${ctx.geo}
- Funding status (amount + investors, if any): ${ctx.funding}
- Notable backers (if any): ${ctx.backers}
- Notable partners or customers (if any): ${ctx.partners}

Proposed announcement:
${announcement}

Evaluate this announcement for PR readiness and risk.

REQUIRED OUTPUT FORMAT (no deviations):
PR Readiness Verdict: [GO / CONDITIONAL / NO-GO]
This announcement is not suitable for proactive PR outreach in its current form.

Overall Risk Score (0–100):
[number]

Risk Breakdown (higher = worse):
- External Validation Risk: [x/30]
- Beneficiary Clarity Risk: [x/20]
- Explainability Risk: [x/20]
- Third-Party Support Risk: [x/15]
- Impact vs Activity Risk: [x/15]

Primary Failure Modes:
- Bullet list of the main reasons this would fail with journalists

Journalist Reaction Simulation:
- One short paragraph describing how a relevant journalist would likely respond

Recommendation:
- Start with: "Do not do proactive PR outreach until..." and state exactly ONE concrete gating requirement.
- Define what would objectively satisfy that requirement (examples or thresholds).
- Then list up to 3 concrete next actions that directly create external, quotable validation (e.g. named customers, partners, measurable outcomes, or permission to be quoted).`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const text = completion.choices?.[0]?.message?.content ?? "";

    return res.status(200).json({ evaluation: text });
  } catch (err) {
    console.error("Evaluation API error:", err);
    return res.status(500).json({ error: "Something went wrong on the server." });
  }
}