export const PENDING_DEMO_RESULT_KEY = "pr_copilot_pending_demo_result";

export type DemoVerdict = "GO" | "CONDITIONAL" | "NO-GO";

export type PendingDemoResult = {
  version: 1;
  importId: string;
  source: "anonymous_demo";
  timestamp: string;
  announcement: string;
  market: string;
  partners: string;
  funding: string;
  evaluation: {
    verdict: DemoVerdict;
    risk_score: number;
    risk_breakdown: {
      external_validation: number;
      beneficiary_clarity: number;
      explainability: number;
      third_party_support: number;
      impact_vs_activity: number;
    };
    primary_failure_modes: string[];
    journalist_reaction: string;
    recommendation: {
      summary: string;
      next_actions: string[];
    };
  };
  draft?: string;
};

export function readPendingDemoResult(): PendingDemoResult | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(PENDING_DEMO_RESULT_KEY);

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);

    return parsed?.version === 1 &&
      parsed?.source === "anonymous_demo" &&
      typeof parsed?.importId === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function writePendingDemoResult(result: PendingDemoResult) {
  window.localStorage.setItem(PENDING_DEMO_RESULT_KEY, JSON.stringify(result));
}

export function clearPendingDemoResult(importId: string) {
  const pending = readPendingDemoResult();

  if (pending?.importId === importId) {
    window.localStorage.removeItem(PENDING_DEMO_RESULT_KEY);
  }
}
