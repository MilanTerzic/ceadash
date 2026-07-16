export const ENTSOE_TOKEN_ENV_NAMES = [
  "ENTSOE_SECURITY_TOKEN",
  "ENTSOE_API_TOKEN",
  "ENTSOE_API_KEY",
] as const;

export function getEntsoeToken(): string | null {
  for (const name of ENTSOE_TOKEN_ENV_NAMES) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  return null;
}

export function entsoeTokenMissingMessage() {
  return `${ENTSOE_TOKEN_ENV_NAMES.join(" / ")} not configured`;
}
