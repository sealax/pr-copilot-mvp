import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import type { PendingDemoResult } from "../demoResult";
import { getDemoSalt } from "./demoUsage";

const IMPORT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function sign(value: unknown) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", getDemoSalt()).update(body).digest("base64url")}`;
}

function verify(token: unknown): any | null {
  if (typeof token !== "string" || token.length > 100000) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = createHmac("sha256", getDemoSalt()).update(body).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); }
  catch { return null; }
}

export function createDemoResult(
  announcement: string,
  context: { market: string; partners: string; funding: string },
  evaluation: PendingDemoResult["evaluation"]
): PendingDemoResult {
  const result: PendingDemoResult = {
    version: 1, source: "anonymous_demo", importId: randomUUID(),
    timestamp: new Date().toISOString(), announcement, ...context, evaluation,
  };
  return {
    ...result,
    evaluationReceipt: sign({ kind: "demo-evaluation-v1", expiresAt: Date.now() + IMPORT_LIFETIME_MS, result }),
  };
}

// Expiry applies to importing, not to already-owned saved history.
export function verifyDemoResult(token: unknown, checkExpiry = true): PendingDemoResult | null {
  const value = verify(token);
  if (value?.kind !== "demo-evaluation-v1" || !Number.isFinite(value.expiresAt) ||
      (checkExpiry && value.expiresAt < Date.now())) return null;
  return value.result ?? null;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createDraftReceipt(evaluationReceipt: string, draft: string) {
  return sign({ kind: "demo-draft-v1", evaluationHash: digest(evaluationReceipt), draftHash: digest(draft) });
}

export function verifyDraftReceipt(token: unknown, evaluationReceipt: string, draft: string) {
  const value = verify(token);
  return value?.kind === "demo-draft-v1" && value.evaluationHash === digest(evaluationReceipt) &&
    value.draftHash === digest(draft);
}
