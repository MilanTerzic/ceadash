// Cross-workspace selection, kept in the URL so every view is a shareable link:
//   m    selected market      b  selected border id      ref  reference market
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { BORDER_BY_ID, isSeeCode, SEE_MARKETS, type SeeCode } from "./registry";

export const DEFAULT_REFERENCE: SeeCode = "RS";

export function useSelection() {
  const search = useSearch({ strict: false }) as { m?: string; b?: string; ref?: string };
  const navigate = useNavigate();

  const market = isSeeCode(search.m) ? search.m : null;
  const border = search.b && search.b in BORDER_BY_ID ? search.b : null;
  const reference =
    isSeeCode(search.ref) && SEE_MARKETS[search.ref].price !== null
      ? search.ref
      : DEFAULT_REFERENCE;

  const patch = useCallback(
    (next: { m?: string; b?: string; ref?: string }) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({ ...prev, ...next }),
        replace: true,
      });
    },
    [navigate],
  );

  return useMemo(
    () => ({
      market,
      border,
      reference,
      selectMarket: (code: SeeCode | null) => patch({ m: code ?? undefined, b: undefined }),
      selectBorder: (id: string | null) => patch({ b: id ?? undefined, m: undefined }),
      clear: () => patch({ m: undefined, b: undefined }),
      setReference: (code: SeeCode) =>
        patch({ ref: code === DEFAULT_REFERENCE ? undefined : code }),
    }),
    [market, border, reference, patch],
  );
}
