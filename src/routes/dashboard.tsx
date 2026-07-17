import { createFileRoute, Outlet, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

import { DashboardTabs } from "@/components/dashboard/DashboardTabs";
import {
  HeaderActionButtons,
  PortfolioSelector,
  RoleSelector,
} from "@/components/dashboard/WorkspaceSelectors";
import { Button } from "@/components/ui/button";
import { addDaysISO, belgradeDateISO, DateRangeProvider, useDateRange } from "@/lib/date-range";
import { useLang } from "@/lib/i18n";
import { WorkspaceProvider } from "@/lib/workspace";

const searchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.enum(["today", "d1", "7d", "30d", "mtd", "prev_month", "ytd", "custom"]).optional(),
  view: z.string().optional(),
  tab: z.string().optional(),
});

export const Route = createFileRoute("/dashboard")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Dashboard - CEA Power Dashboard" },
      {
        name: "description",
        content:
          "Decision-oriented electricity-market workspace for Serbia, regional spot markets, flexibility, reports and project economics.",
      },
    ],
  }),
  component: DashboardLayout,
});

function monthStart(dayISO: string) {
  return `${dayISO.slice(0, 7)}-01`;
}

function previousMonthRange(todayISO: string) {
  const date = new Date(`${monthStart(todayISO)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const from = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const toDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));
  const to = `${toDate.getUTCFullYear()}-${String(toDate.getUTCMonth() + 1).padStart(2, "0")}-${String(toDate.getUTCDate()).padStart(2, "0")}`;
  return { from, to };
}

function yearStart(dayISO: string) {
  return `${dayISO.slice(0, 4)}-01-01`;
}

function GlobalDateRangeControl() {
  const { t } = useLang();
  const { range, setRange } = useDateRange();
  const navigate = useNavigate();
  const today = belgradeDateISO();
  const presets = [
    { label: t("Today", "Danas"), range: { from: today, to: today } },
    { label: "D+1", range: { from: addDaysISO(today, 1), to: addDaysISO(today, 1) } },
    {
      label: t("Last 7 days", "Poslednjih 7 dana"),
      range: { from: addDaysISO(today, -6), to: today },
    },
    {
      label: t("Last 30 days", "Poslednjih 30 dana"),
      range: { from: addDaysISO(today, -29), to: today },
    },
    { label: "MTD", range: { from: monthStart(today), to: today } },
    { label: t("Previous month", "Prethodni mesec"), range: previousMonthRange(today) },
    { label: "YTD", range: { from: yearStart(today), to: today } },
  ];
  const applyRange = (nextRange: { from: string; to: string }) => {
    setRange(nextRange);
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        preset: "custom",
        from: nextRange.from,
        to: nextRange.to,
      }),
      replace: true,
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex max-w-full gap-1 overflow-x-auto pb-1">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            size="sm"
            variant={
              range.from === preset.range.from && range.to === preset.range.to ? "default" : "ghost"
            }
            className="h-8 shrink-0 px-2 text-[11px]"
            onClick={() => applyRange(preset.range)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <label className="grid gap-1 text-xs text-muted-foreground">
        <span>{t("From", "Od")}</span>
        <input
          type="date"
          value={range.from}
          max={range.to}
          onChange={(event) => applyRange({ ...range, from: event.target.value })}
          className="h-9 rounded-md border border-border/60 bg-surface-2 px-2 text-xs text-foreground"
        />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        <span>{t("To", "Do")}</span>
        <input
          type="date"
          value={range.to}
          min={range.from}
          onChange={(event) => applyRange({ ...range, to: event.target.value })}
          className="h-9 rounded-md border border-border/60 bg-surface-2 px-2 text-xs text-foreground"
        />
      </label>
    </div>
  );
}

function DateRangeUrlSync() {
  const search = useSearch({ strict: false }) as { from?: string; to?: string };
  const { range, setRange } = useDateRange();

  useEffect(() => {
    if (!search.from || !search.to) return;
    if (range.from === search.from && range.to === search.to) return;
    setRange({ from: search.from, to: search.to });
  }, [range.from, range.to, search.from, search.to, setRange]);

  return null;
}

function DashboardLayout() {
  const { t } = useLang();
  return (
    <DateRangeProvider>
      <WorkspaceProvider>
        <DateRangeUrlSync />
        <div>
          <section className="border-b border-border/60 bg-surface/80">
            <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    {t("CEA Power Dashboard", "CEA Power Dashboard")}
                  </div>
                  <h1 className="mt-1 font-display text-2xl text-foreground md:text-3xl">
                    {t(
                      "Serbia Electricity Market Workspace",
                      "Radni prostor za trziste elektricne energije Srbije",
                    )}
                  </h1>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                    {t(
                      "Select your role and asset, then focus on the market, financial and operational signals that matter.",
                      "Izaberite ulogu i asset, zatim pratite trziste, finansijske i operativne signale koji su vazni.",
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-end justify-start gap-3 xl:justify-end">
                  <RoleSelector />
                  <PortfolioSelector />
                  <HeaderActionButtons />
                </div>
              </div>
              <div className="mt-4">
                <GlobalDateRangeControl />
              </div>
            </div>
          </section>
          <DashboardTabs />
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </div>
      </WorkspaceProvider>
    </DateRangeProvider>
  );
}
