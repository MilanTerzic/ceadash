# Security audit notes

## P0: unauthenticated futures write actions

The public dashboard exposes TanStack server functions that perform privileged Supabase writes through `supabaseAdmin`, which uses the service-role key and bypasses RLS.

Affected functions in `src/lib/eex-futures.server.ts`:

- `refreshPublicFuturesSnapshots` (`POST`)
- `importManualFuturesData` (`POST`)
- `collectFuturesSnapshots` (`POST`)

These functions currently have no explicit authorization check in the function body. Because the dashboard is intentionally public, UI visibility is not a sufficient security boundary.

Required remediation:

1. Protect all state-changing server functions with an explicit admin/auth guard.
2. Keep read-only futures dashboard functions public.
3. Validate request size and CSV row count for manual imports.
4. Rate-limit public snapshot refresh even after auth to avoid accidental or abusive upstream traffic.
5. Add tests proving anonymous callers cannot invoke privileged writes.
6. Review every other `createServerFn({ method: "POST" })` in the repository for the same pattern.

This is a release blocker if the service-role key is configured in production.