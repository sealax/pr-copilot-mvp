import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { NextApiRequest } from "next";

export const DEMO_CHECK_LIMIT = 2;
export const DEMO_DRAFT_LIMIT = 1;

export type DemoAllowance = {
  remainingChecks: number;
  remainingDrafts: number;
};

type DemoEvaluationToken = {
  ipHash: string;
  promptHash: string;
  verdict: "GO" | "CONDITIONAL" | "NO-GO";
  expiresAt: number;
};

function getDemoSalt() {
  const salt = process.env.DEMO_USAGE_SALT;

  if (!salt || salt.length < 32) {
    throw new Error("DEMO_USAGE_SALT must be at least 32 characters");
  }

  return salt;
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function getVisitorIp(req: NextApiRequest) {
  const forwardedFor = firstHeaderValue(req.headers["x-forwarded-for"]);
  const forwardedIp = forwardedFor?.split(",")[0]?.trim();
  const realIp = firstHeaderValue(req.headers["x-real-ip"])?.trim();
  const socketIp = req.socket.remoteAddress?.trim();
  const ip = forwardedIp || realIp || socketIp;

  if (!ip) {
    throw new Error("Could not identify demo visitor");
  }

  return ip;
}

export function getDemoVisitorHash(req: NextApiRequest) {
  return createHash("sha256")
    .update(`${getVisitorIp(req)}${getDemoSalt()}`)
    .digest("hex");
}

export function hashDemoPrompt(prompt: string) {
  return createHash("sha256").update(prompt).digest("hex");
}

export function createDemoEvaluationToken(
  ipHash: string,
  prompt: string,
  verdict: DemoEvaluationToken["verdict"]
) {
  const payload: DemoEvaluationToken = {
    ipHash,
    promptHash: hashDemoPrompt(prompt),
    verdict,
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getDemoSalt())
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

export function verifyDemoEvaluationToken(
  token: unknown,
  ipHash: string,
  prompt: string
): DemoEvaluationToken | null {
  if (typeof token !== "string") return null;

  const [encodedPayload, encodedSignature, extra] = token.split(".");

  if (!encodedPayload || !encodedSignature || extra) return null;

  const expectedSignature = createHmac("sha256", getDemoSalt())
    .update(encodedPayload)
    .digest();

  let suppliedSignature: Buffer;

  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }

  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as DemoEvaluationToken;

    if (
      payload.ipHash !== ipHash ||
      payload.promptHash !== hashDemoPrompt(prompt) ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt < Date.now() ||
      !["GO", "CONDITIONAL", "NO-GO"].includes(payload.verdict)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function toAllowance(row: any): DemoAllowance {
  const checksUsed = Number.isFinite(Number(row?.readiness_checks_used))
    ? Number(row.readiness_checks_used)
    : 0;
  const draftsUsed = Number.isFinite(Number(row?.drafts_used))
    ? Number(row.drafts_used)
    : 0;

  return {
    remainingChecks: Math.max(0, DEMO_CHECK_LIMIT - checksUsed),
    remainingDrafts: Math.max(0, DEMO_DRAFT_LIMIT - draftsUsed),
  };
}

export async function getDemoAllowance(supabase: any, ipHash: string) {
  const { data, error } = await supabase
    .from("demo_usage")
    .select("readiness_checks_used, drafts_used")
    .eq("ip_hash", ipHash)
    .maybeSingle();

  if (error) {
    console.error("Supabase demo usage fetch error:", error);
    throw new Error("Could not check demo usage");
  }

  return toAllowance(data);
}

async function consumeDemoUsage(
  supabase: any,
  functionName: "consume_demo_readiness_check" | "consume_demo_draft",
  ipHash: string
) {
  const { data, error } = await supabase.rpc(functionName, {
    visitor_ip_hash: ipHash,
  });

  if (error) {
    console.error(`Supabase ${functionName} error:`, error);
    throw new Error("Could not update demo usage");
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) return null;

  return toAllowance(row);
}

export function consumeDemoReadinessCheck(supabase: any, ipHash: string) {
  return consumeDemoUsage(supabase, "consume_demo_readiness_check", ipHash);
}

export function consumeDemoDraft(supabase: any, ipHash: string) {
  return consumeDemoUsage(supabase, "consume_demo_draft", ipHash);
}
