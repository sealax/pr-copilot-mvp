import { randomUUID } from "crypto";
import { getDemoVisitorHash } from "./demoUsage";

export const OPENAI_MODEL = "gpt-4o-mini";
export const OPENAI_TIMEOUT_MS = 25000;
export const OPENAI_MAX_RETRIES = 0;

export class UsageError extends Error {
  constructor(message: string, public status = 503, public usage: Record<string, unknown> = {}) {
    super(message);
  }
}

export function usageScope() {
  const scope = process.env.VERCEL_ENV;
  if (process.env.VERCEL === "1") {
    if (scope === "production" || scope === "preview" || scope === "development") return scope;
  } else if ((!scope || scope === "development") && process.env.NODE_ENV !== "production") {
    return "development";
  }
  throw new UsageError("Invalid usage environment");
}

// The RPC deadline leaves time for cleanup within the 45-second route budget.
export async function usageRpc(supabase: any, name: string, args: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const { data, error } = await supabase.rpc(name, args).abortSignal(controller.signal);
    if (error || (data === null && !["release_api_usage", "import_demo_draft"].includes(name))) throw new UsageError("Usage service is unavailable. Please try again shortly.");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function usageResponse(data: any, demo: boolean) {
  if (demo) return { demo: true, remainingChecks: data.remaining_evaluations, remainingDrafts: data.remaining_generations };
  const { result_id, allowed, reservation_id, status, error, ...allowance } = data;
  return allowance;
}

export async function readUsage(supabase: any, userId: string | null, demoHash: string | null, admin: boolean) {
  const data = await usageRpc(supabase, "get_api_usage", {
    p_scope: usageScope(), p_user_id: userId, p_demo_hash: demoHash, p_admin: admin,
  });
  return usageResponse(data, !userId);
}

export class ApiReservation {
  readonly id = randomUUID();
  private completed = false;
  constructor(private supabase: any, private userId: string | null, private admin: boolean) {}

  async reserve(req: any, operation: "evaluate" | "generate") {
    const ipHash = getDemoVisitorHash(req);
    const data = await usageRpc(this.supabase, "reserve_api_usage", {
      p_scope: usageScope(), p_user_id: this.userId, p_demo_hash: this.userId ? null : ipHash,
      p_admin: this.admin, p_operation: operation, p_request_id: this.id, p_ip_hash: ipHash,
    });
    if (!data.allowed) throw new UsageError(data.error, data.status, usageResponse(data, !this.userId));
  }

  async dispatch() {
    const data = await usageRpc(this.supabase, "dispatch_api_usage", { p_request_id: this.id });
    if (!data.allowed) throw new UsageError(data.error, data.status);
  }

  async complete(result: Record<string, unknown>) {
    const data = await usageRpc(this.supabase, "complete_api_usage", { p_request_id: this.id, p_result: result, p_admin: this.admin });
    if (this.userId && !data.result_id) throw new UsageError("Result could not be saved", 500);
    this.completed = true;
    return { id: data.result_id, usage: usageResponse(data, !this.userId) };
  }

  async release() {
    if (this.completed) return;
    try {
      await usageRpc(this.supabase, "release_api_usage", { p_request_id: this.id });
    } catch {
      // Expiry conservatively releases the quota. Global dispatched attempts remain counted.
      console.error("Could not release AI reservation; expiry will reconcile it");
    }
  }
}

export function validateModelText(completion: any) {
  const choice = completion.choices?.[0];
  const text = choice?.message?.content;
  if (choice?.finish_reason !== "stop" || typeof text !== "string" || !text.trim()) {
    throw new UsageError("AI returned an incomplete response. Please try again.", 502);
  }
  return text;
}

export function validatePromptSize(system: string, user: string) {
  if (Buffer.byteLength(system + user, "utf8") > 64000) throw new UsageError("Announcement context is too long", 400);
}
