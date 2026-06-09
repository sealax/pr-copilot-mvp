import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

import type { DemoVerdict, PendingDemoResult } from "../../lib/demoResult";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_ANNOUNCEMENT_LENGTH = 6000;
const MAX_CONTEXT_FIELD_LENGTH = 1000;
const MAX_DRAFT_LENGTH = 20000;
const IMPORT_ID_PATTERN = /^[a-zA-Z0-9-]{16,100}$/;

async function getVerifiedUser(req: NextApiRequest) {
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

function cleanString(value: unknown, maxLength: number, required = true) {
  if (typeof value !== "string") return null;

  const cleaned = value.trim();

  if ((required && !cleaned) || cleaned.length > maxLength) return null;

  return cleaned;
}

function clampInt(value: unknown, min: number, max: number) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) return min;

  return Math.max(min, Math.min(max, Math.trunc(numberValue)));
}

function cleanStringArray(value: unknown, limit: number) {
  return Array.isArray(value)
    ? value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim().slice(0, 2000))
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

function cleanVerdict(value: unknown): DemoVerdict | null {
  return value === "GO" || value === "CONDITIONAL" || value === "NO-GO"
    ? value
    : null;
}

function validatePayload(value: unknown): PendingDemoResult | null {
  const payload = value as PendingDemoResult;
  const verdict = cleanVerdict(payload?.evaluation?.verdict);
  const announcement = cleanString(payload?.announcement, MAX_ANNOUNCEMENT_LENGTH);
  const market = cleanString(payload?.market, MAX_CONTEXT_FIELD_LENGTH, false);
  const partners = cleanString(payload?.partners, MAX_CONTEXT_FIELD_LENGTH, false);
  const funding = cleanString(payload?.funding, MAX_CONTEXT_FIELD_LENGTH, false);
  const journalistReaction = cleanString(
    payload?.evaluation?.journalist_reaction,
    6000,
    false
  );
  const recommendationSummary = cleanString(
    payload?.evaluation?.recommendation?.summary,
    6000,
    false
  );
  const draft =
    payload?.draft === undefined
      ? undefined
      : cleanString(payload.draft, MAX_DRAFT_LENGTH);
  const timestamp = new Date(payload?.timestamp);

  if (
    payload?.version !== 1 ||
    payload?.source !== "anonymous_demo" ||
    typeof payload?.importId !== "string" ||
    !IMPORT_ID_PATTERN.test(payload.importId) ||
    !announcement ||
    market === null ||
    partners === null ||
    funding === null ||
    !verdict ||
    journalistReaction === null ||
    recommendationSummary === null ||
    Number.isNaN(timestamp.getTime()) ||
    timestamp.getTime() > Date.now() + 5 * 60 * 1000 ||
    (payload?.draft !== undefined && !draft) ||
    (draft && verdict === "NO-GO")
  ) {
    return null;
  }

  return {
    version: 1,
    importId: payload.importId,
    source: "anonymous_demo",
    timestamp: timestamp.toISOString(),
    announcement,
    market,
    partners,
    funding,
    evaluation: {
      verdict,
      risk_score: clampInt(payload.evaluation.risk_score, 0, 100),
      risk_breakdown: {
        external_validation: clampInt(
          payload.evaluation.risk_breakdown?.external_validation,
          0,
          30
        ),
        beneficiary_clarity: clampInt(
          payload.evaluation.risk_breakdown?.beneficiary_clarity,
          0,
          20
        ),
        explainability: clampInt(
          payload.evaluation.risk_breakdown?.explainability,
          0,
          20
        ),
        third_party_support: clampInt(
          payload.evaluation.risk_breakdown?.third_party_support,
          0,
          15
        ),
        impact_vs_activity: clampInt(
          payload.evaluation.risk_breakdown?.impact_vs_activity,
          0,
          15
        ),
      },
      primary_failure_modes: cleanStringArray(
        payload.evaluation.primary_failure_modes,
        8
      ),
      journalist_reaction: journalistReaction,
      recommendation: {
        summary: recommendationSummary,
        next_actions: cleanStringArray(
          payload.evaluation.recommendation?.next_actions,
          3
        ),
      },
    },
    ...(draft ? { draft } : {}),
  };
}

async function findImportedEvaluation(importId: string, userId: string) {
  const { data, error } = await supabase
    .from("evaluations")
    .select("id")
    .eq("demo_import_id", importId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Demo import lookup error:", error);
    throw new Error("Could not check demo import");
  }

  return data;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const verifiedUser = await getVerifiedUser(req);
    const payload = validatePayload(req.body);

    if (!payload) {
      return res.status(400).json({ error: "Invalid anonymous demo result" });
    }

    let evaluation = await findImportedEvaluation(payload.importId, verifiedUser.id);

    if (!evaluation) {
      const { data, error } = await supabase
        .from("evaluations")
        .insert({
          user_id: verifiedUser.id,
          announcement: payload.announcement,
          market: payload.market,
          partners: payload.partners,
          funding: payload.funding,
          verdict: payload.evaluation.verdict,
          risk_score: payload.evaluation.risk_score,
          source: "anonymous_demo",
          demo_import_id: payload.importId,
          created_at: payload.timestamp,
          evaluation_json: {
            risk_breakdown: payload.evaluation.risk_breakdown,
            primary_failure_modes: payload.evaluation.primary_failure_modes,
            journalist_reaction: payload.evaluation.journalist_reaction,
            recommendation: payload.evaluation.recommendation,
            source: "anonymous_demo",
            demo_timestamp: payload.timestamp,
          },
        })
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505") {
          evaluation = await findImportedEvaluation(payload.importId, verifiedUser.id);
        } else {
          console.error("Demo evaluation import error:", error);
          return res.status(500).json({ error: "Could not save demo evaluation" });
        }
      } else {
        evaluation = data;
      }
    }

    if (!evaluation?.id) {
      return res.status(409).json({ error: "Demo result was already imported elsewhere" });
    }

    if (payload.draft) {
      const { count, error: countError } = await supabase
        .from("generations")
        .select("id", { count: "exact", head: true })
        .eq("evaluation_id", evaluation.id)
        .eq("user_id", verifiedUser.id);

      if (countError || typeof count !== "number") {
        console.error("Demo draft import lookup error:", countError);
        return res.status(500).json({ error: "Could not check imported demo draft" });
      }

      if (count === 0) {
        const { error: generationError } = await supabase
          .from("generations")
          .insert({
            evaluation_id: evaluation.id,
            user_id: verifiedUser.id,
            prompt: payload.announcement,
            output: payload.draft,
            model: "anonymous_demo_import",
            created_at: payload.timestamp,
          });

        if (generationError) {
          console.error("Demo draft import error:", generationError);
          return res.status(500).json({ error: "Could not save demo draft" });
        }
      }
    }

    return res.status(200).json({
      saved: true,
      evaluation_id: evaluation.id,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Missing Supabase access token") {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (err instanceof Error && err.message === "Invalid Supabase access token") {
      return res.status(401).json({ error: "Invalid Supabase access token" });
    }

    console.error("Demo import API error:", err);
    return res.status(500).json({ error: "Something went wrong on the server." });
  }
}
