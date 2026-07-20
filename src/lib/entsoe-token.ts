export const ENTSOE_TOKEN_ENV_NAMES = [
  "ENTSOE_SECURITY_TOKEN",
  "ENTSOE_API_TOKEN",
  "ENTSOE_API_KEY",
] as const;

export function resolveEntsoeToken(
  env: Partial<Record<(typeof ENTSOE_TOKEN_ENV_NAMES)[number], string | undefined>>,
): { token: string; envName: (typeof ENTSOE_TOKEN_ENV_NAMES)[number] } | null {
  for (const envName of ENTSOE_TOKEN_ENV_NAMES) {
    const value = env[envName];
    if (value?.trim()) return { token: value.trim(), envName };
  }
  return null;
}

export function getEntsoeToken(): string | null {
  return resolveEntsoeToken(process.env)?.token ?? null;
}

export function entsoeTokenMissingMessage() {
  return "entsoe_token_missing";
}
