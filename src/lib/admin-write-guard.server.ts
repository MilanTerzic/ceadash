import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isValidAdminWriteToken } from "./admin-write-guard";

export function requireAdminWriteToken(candidate?: string): void {
  const expected = process.env.CEA_ADMIN_WRITE_TOKEN;
  if (!isValidAdminWriteToken(candidate, expected)) throw new Error("unauthorized_admin_write");
}

export async function enforceAdminRateLimit(key: string, minimumSeconds: number): Promise<void> {
  const cacheKey = `admin_rate_limit:${key}`;
  const { data } = await supabaseAdmin
    .from("api_cache")
    .select("fetched_at")
    .eq("key", cacheKey)
    .maybeSingle();
  if (data?.fetched_at) {
    const ageSeconds = (Date.now() - new Date(String(data.fetched_at)).getTime()) / 1000;
    if (ageSeconds < minimumSeconds) throw new Error("admin_write_rate_limited");
  }
  await supabaseAdmin.from("api_cache").upsert({
    key: cacheKey,
    payload: { ok: true } as never,
    fetched_at: new Date().toISOString(),
    ttl_seconds: Math.max(minimumSeconds, 60),
  });
}
