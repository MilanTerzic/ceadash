import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { z } from "zod";

import { useDashboardRange } from "@/components/dashboard/DateRangeControl";
import { AppShell } from "@/components/shell/AppShell";

import { DateRangeProvider } from "@/lib/date-range";

const searchSchema = z.object({
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  preset: z
    .enum(["today", "d1", "7d", "30d", "mtd", "prev_month", "ytd", "custom"])
    .optional()
    .catch(undefined),
  compare: z
    .enum(["previous_equivalent", "previous_month", "previous_year", "none"])
    .optional()
    .catch(undefined),
  asset: z.enum(["solar", "wind", "bess", "hybrid"]).optional().catch(undefined),
  // Cross-workspace selection: market, border and reference market.
  m: z.string().optional().catch(undefined),
  b: z.string().optional().catch(undefined),
  ref: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/dashboard")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "CEA Power Intelligence — Southeast Europe electricity markets" },
      {
        name: "description",
        content:
          "Southeast European electricity market intelligence: day-ahead prices, cross-border flows and spreads, fundamentals, forwards, PPA and battery analytics.",
      },
    ],
  }),
  component: DashboardLayout,
});

// Workspaces built on the regional design system lay themselves out edge to edge.
// Earlier pages keep their centred column until they are rebuilt.
const FULL_BLEED = new Set([
  "/dashboard",
  "/dashboard/prices",
  "/dashboard/borders",
  "/dashboard/fundamentals",
  "/dashboard/ppa",
  "/dashboard/bess",
  "/dashboard/watch",
]);

function DashboardLayout() {
  const dashboardRange = useDashboardRange({});
  const pathname = useLocation({ select: (location) => location.pathname });
  const fullBleed = FULL_BLEED.has(pathname.replace(/\/$/, "") || "/dashboard");
  return (
    <DateRangeProvider range={dashboardRange.rangeKeys} setRange={dashboardRange.setRangeKeys}>
      <AppShell>
        {fullBleed ? (
          <Outlet />
        ) : (
          <div className="mx-auto max-w-[1400px] space-y-4 px-3 py-4 sm:px-5">
            <Outlet />
          </div>
        )}
      </AppShell>
    </DateRangeProvider>
  );
}
