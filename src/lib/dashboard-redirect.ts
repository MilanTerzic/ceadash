import { redirect } from "@tanstack/react-router";

const PRESERVED_SEARCH = ["from", "to", "preset"] as const;

export function legacyDashboardRedirect(
  to: string,
  search: Record<string, unknown> | undefined,
  view?: string,
) {
  const next: Record<string, string> = {};
  for (const key of PRESERVED_SEARCH) {
    const value = search?.[key];
    if (typeof value === "string" && value) next[key] = value;
  }
  if (view) next.view = view;
  throw redirect({ to: to as never, search: next as never });
}
