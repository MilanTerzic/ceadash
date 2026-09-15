import { timingSafeEqual } from "node:crypto";

export type AutomationAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: "unauthorized" | "automation_token_not_configured" };

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Protect cron/write endpoints from public invocation. */
export async function authorizeAutomationRequest(request: Request): Promise<AutomationAuthResult> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const supplied = match?.[1]?.trim() ?? "";
  if (!supplied) return { ok: false, status: 401, error: "unauthorized" };

  const expected = process.env.AUTOMATION_TOKEN?.trim();
  if (!expected) {
    return { ok: false, status: 503, error: "automation_token_not_configured" };
  }
  return safeEqual(supplied, expected)
    ? { ok: true }
    : { ok: false, status: 401, error: "unauthorized" };
}
