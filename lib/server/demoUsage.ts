import { createHash, createHmac, timingSafeEqual } from "crypto";
import { isIP } from "net";
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

export function getDemoSalt() {
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
  // Vercel overwrites x-forwarded-for at its edge. Never fall back to a
  // caller-controlled alternative header on Vercel. Local servers use the socket.
  const ip = process.env.VERCEL === "1" ? forwardedIp : socketIp || forwardedIp || realIp;

  if (!ip || !isIP(ip)) {
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
