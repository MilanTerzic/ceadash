import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useIsFetching } from "@tanstack/react-query";
import { FlaskConical, Menu, MoreHorizontal, Search } from "lucide-react";

import { IconButton } from "@/components/cea/primitives";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import ceaLogo from "@/assets/cea-logo.png.asset.json";
import { LanguageToggle, useLang } from "@/lib/i18n";
import { fmtDay } from "@/lib/see/format";
import { worstState, type Provenance } from "@/lib/see/status";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { PeriodControl } from "./PeriodControl";
import { PriceTape, useTape, type TapeEntry } from "./PriceTape";
import { ThemeToggle } from "./theme";
import { WORKSPACES, workspaceFor, type Workspace } from "./workspaces";

const keepSearch = ((prev: Record<string, unknown>) => prev) as never;

function Brand({ compact = false }: { compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  // The image may have failed before hydration attached onError.
  useEffect(() => {
    const image = imageRef.current;
    if (image && image.complete && image.naturalWidth === 0) setFailed(true);
  }, []);
  return (
    <Link
      to="/dashboard"
      search={keepSearch}
      className="flex items-center gap-2"
      aria-label="CEA Power Intelligence"
    >
      {failed ? (
        <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-brand font-display text-[11px] font-bold tracking-tight text-primary-foreground">
          CEA
        </span>
      ) : (
        <img
          ref={imageRef}
          src={ceaLogo.url}
          alt=""
          onError={() => setFailed(true)}
          className="h-8 w-8 rounded-sm bg-[#f7f4e8] object-contain p-0.5"
        />
      )}
      {!compact && (
        <span className="leading-none">
          <span className="block font-display text-sm font-semibold tracking-tight text-foreground">
            CEA Power Intelligence
          </span>
          <span className="eyebrow mt-0.5 block !text-[9.5px]">Southeast Europe</span>
        </span>
      )}
    </Link>
  );
}

function RailItem({ workspace, active }: { workspace: Workspace; active: boolean }) {
  const { lang } = useLang();
  return (
    <Link
      to={workspace.to}
      search={keepSearch}
      title={`${lang === "sr" ? workspace.sr : workspace.en} — ${
        lang === "sr" ? workspace.questionSr : workspace.questionEn
      }`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full flex-col items-center gap-1 py-2 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground",
        active && "bg-surface-2 text-foreground",
      )}
    >
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-brand" aria-hidden />
      )}
      <workspace.icon
        className={cn("h-[18px] w-[18px]", active && "text-brand")}
        strokeWidth={1.75}
      />
      <span className="font-condensed text-[10.5px] font-medium leading-none tracking-wide">
        {lang === "sr" ? workspace.shortSr : workspace.shortEn}
      </span>
    </Link>
  );
}

function WorkspaceList({ current, onNavigate }: { current: Workspace; onNavigate?: () => void }) {
  const { lang } = useLang();
  return (
    <nav className="grid gap-0.5">
      {WORKSPACES.map((workspace) => (
        <Link
          key={workspace.id}
          to={workspace.to}
          search={keepSearch}
          onClick={onNavigate}
          className={cn(
            "flex items-start gap-2.5 rounded-sm px-2 py-1.5 transition-colors hover:bg-surface-2",
            current.id === workspace.id && "bg-surface-2",
          )}
        >
          <workspace.icon
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-foreground">
              {lang === "sr" ? workspace.sr : workspace.en}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {lang === "sr" ? workspace.questionSr : workspace.questionEn}
            </span>
          </span>
        </Link>
      ))}
    </nav>
  );
}

function Rail({ current, onSearch }: { current: Workspace; onSearch: () => void }) {
  const { t } = useLang();
  const [moreOpen, setMoreOpen] = useState(false);
  const secondaryActive = !current.primary;
  return (
    <aside className="hidden w-[68px] shrink-0 flex-col border-r border-border bg-surface md:flex print:hidden">
      <div className="flex h-9 items-center justify-center border-b border-border">
        <Brand compact />
      </div>
      <nav
        className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1"
        aria-label={t("Workspaces", "Radni prostori")}
      >
        {WORKSPACES.filter((workspace) => workspace.primary).map((workspace) => (
          <RailItem key={workspace.id} workspace={workspace} active={current.id === workspace.id} />
        ))}
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "relative flex w-full flex-col items-center gap-1 py-2 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground",
                secondaryActive && "bg-surface-2 text-foreground",
              )}
            >
              {secondaryActive && (
                <span
                  className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-brand"
                  aria-hidden
                />
              )}
              <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.75} />
              <span className="font-condensed text-[10.5px] font-medium leading-none tracking-wide">
                {t("More", "Još")}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-80 p-1.5">
            <WorkspaceList current={current} onNavigate={() => setMoreOpen(false)} />
          </PopoverContent>
        </Popover>
      </nav>
      <button
        type="button"
        onClick={onSearch}
        title={t("Search and commands (Ctrl/⌘ K)", "Pretraga i komande (Ctrl/⌘ K)")}
        className="flex flex-col items-center gap-1 border-t border-border py-2 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <Search className="h-4 w-4" strokeWidth={1.75} />
        <span className="num text-[9.5px]">⌘K</span>
      </button>
    </aside>
  );
}

function FetchBar() {
  const fetching = useIsFetching();
  return (
    <div className="relative h-px overflow-hidden bg-border" aria-hidden>
      {fetching > 0 && <div className="animate-loading-sweep absolute inset-y-0 w-1/4 bg-brand" />}
    </div>
  );
}

function MarketClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!now) return <span className="num">--:--</span>;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(now);
  return <span className="num">{parts}</span>;
}

const STATE_COPY: Record<Provenance, { en: string; sr: string; tone: string }> = {
  live: { en: "ENTSO-E connected · live", sr: "ENTSO-E povezan · uživo", tone: "bg-positive" },
  cache: { en: "ENTSO-E observations · cached", sr: "ENTSO-E merenja · keš", tone: "bg-positive" },
  stale: {
    en: "Provider unreachable · showing last good observations",
    sr: "Provajder nedostupan · poslednja ispravna merenja",
    tone: "bg-warning",
  },
  synthetic: {
    en: "SYNTHETIC DATA · not market observations",
    sr: "SINTETIČKI PODACI · nisu tržišna merenja",
    tone: "bg-serious",
  },
  empty: {
    en: "No day-ahead data published",
    sr: "Nema objavljenih day-ahead podataka",
    tone: "bg-muted-foreground",
  },
  unavailable: {
    en: "ENTSO-E not connected · no market data",
    sr: "ENTSO-E nije povezan · nema tržišnih podataka",
    tone: "bg-muted-foreground",
  },
  error: { en: "Data requests failing", sr: "Zahtevi za podatke ne uspevaju", tone: "bg-critical" },
};

function StatusBar({ entries, isLoading }: { entries: TapeEntry[]; isLoading: boolean }) {
  const { t, lang } = useLang();
  const states = entries
    .map((entry) => entry.state)
    .filter((state): state is Provenance => state !== null);
  const worst = worstState(states);
  // The headline state is the best case for healthy feeds and the worst case otherwise.
  const headline: Provenance | null =
    worst === null
      ? null
      : states.includes("synthetic")
        ? "synthetic"
        : states.includes("live")
          ? "live"
          : worst;
  const covered = entries.filter((entry) => entry.base !== null).length;
  const latest = entries.reduce<string | null>(
    (max, entry) => (entry.day && (!max || entry.day > max) ? entry.day : max),
    null,
  );
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-[11px] text-muted-foreground print:hidden">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            headline ? STATE_COPY[headline].tone : "bg-border-strong",
          )}
          aria-hidden
        />
        <span className="truncate">
          {isLoading || !headline
            ? t("Connecting to data sources…", "Povezivanje sa izvorima…")
            : STATE_COPY[headline][lang]}
        </span>
      </span>
      {!isLoading && headline && (
        <span className="num hidden whitespace-nowrap md:inline">
          {covered}/{entries.length} {t("markets priced", "tržišta sa cenom")}
          {latest
            ? ` · ${t("latest delivery day", "poslednji dan isporuke")} ${fmtDay(latest)}`
            : ""}
        </span>
      )}
      <span className="ml-auto hidden truncate xl:inline">
        {t(
          "Indicative analysis, not trading or investment advice.",
          "Indikativna analiza, nije trgovački ni investicioni savet.",
        )}
      </span>
      <span className="ml-auto shrink-0 whitespace-nowrap xl:ml-0">
        <MarketClock />
      </span>
    </footer>
  );
}

/** The single application frame: rail, price tape, context bar, workspace, status bar. */
export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang } = useLang();
  const pathname = useLocation({ select: (location) => location.pathname });
  const current = workspaceFor(pathname);
  const tape = useTape();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const synthetic = tape.entries.some((entry) => entry.state === "synthetic");

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground print:h-auto">
      {synthetic && (
        <div
          role="status"
          className="flex min-h-6 shrink-0 items-center justify-center gap-2 bg-serious px-3 py-0.5 text-center text-[11px] font-semibold leading-tight tracking-wide text-black"
        >
          <FlaskConical className="h-3 w-3" aria-hidden />
          {t(
            "SYNTHETIC DEVELOPMENT DATA — every figure on this screen is generated, not a market observation",
            "SINTETIČKI RAZVOJNI PODACI — sve vrednosti na ekranu su generisane, nisu tržišna merenja",
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <Rail current={current} onSearch={() => setPaletteOpen(true)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="print:hidden">
            <PriceTape entries={tape.entries} isLoading={tape.isLoading} />
          </div>
          <div className="flex h-11 shrink-0 items-center gap-2 bg-surface px-3 print:hidden">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label={t("Open navigation", "Otvori navigaciju")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border text-ink-2 md:hidden"
                >
                  <Menu className="h-4 w-4" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 overflow-y-auto bg-surface p-3">
                <SheetTitle className="mb-3">
                  <Brand />
                </SheetTitle>
                <WorkspaceList current={current} onNavigate={() => setMenuOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-[15px] font-semibold leading-tight">
                {lang === "sr" ? current.sr : current.en}
              </h1>
              <p className="hidden truncate text-[11.5px] leading-tight text-muted-foreground sm:block">
                {lang === "sr" ? current.questionSr : current.questionEn}
              </p>
            </div>
            <PeriodControl />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-7 items-center gap-2 rounded-sm border border-border bg-background px-2 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground xl:inline-flex"
            >
              <Search className="h-3.5 w-3.5" />
              {t("Search", "Pretraga")}
              <kbd className="num rounded-[3px] border border-border px-1 text-[10px]">⌘K</kbd>
            </button>
            <IconButton
              label={t("Search and commands", "Pretraga i komande")}
              onClick={() => setPaletteOpen(true)}
              className="xl:hidden"
            >
              <Search className="h-3.5 w-3.5" />
            </IconButton>
            <ThemeToggle />
            <LanguageToggle className="h-7 !rounded-sm !border-border" />
          </div>
          <FetchBar />
          <main className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">{children}</main>
          <StatusBar entries={tape.entries} isLoading={tape.isLoading} />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
