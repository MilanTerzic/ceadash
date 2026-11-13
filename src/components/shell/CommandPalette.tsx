import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftRight, CalendarRange, Languages, MapPin, SunMoon } from "lucide-react";

import { useDashboardRange, type PresetKey } from "@/components/dashboard/DateRangeControl";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";
import { SEE_BORDERS, SEE_CODES, SEE_MARKETS } from "@/lib/see/registry";
import { useTheme } from "./theme";
import { WORKSPACES } from "./workspaces";

const PERIODS: Array<{ key: PresetKey; en: string; sr: string }> = [
  { key: "d1", en: "Tomorrow (D+1)", sr: "Sutra (D+1)" },
  { key: "today", en: "Today", sr: "Danas" },
  { key: "7d", en: "Last 7 days", sr: "Poslednjih 7 dana" },
  { key: "30d", en: "Last 30 days", sr: "Poslednjih 30 dana" },
  { key: "mtd", en: "Month to date", sr: "Od početka meseca" },
  { key: "prev_month", en: "Previous month", sr: "Prethodni mesec" },
  { key: "ytd", en: "Year to date", sr: "Od početka godine" },
];

/**
 * Every typed word must start a word of the item. Fuzzy matching ranks "RES Capture"
 * for "rs hu"; a trader typing two market codes means that border.
 */
function matchWords(value: string, search: string): number {
  const words = value.toLowerCase().split(/[^\p{L}\p{N}+]+/u);
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    if (words.includes(token)) score += 2;
    else if (words.some((word) => word.startsWith(token))) score += 1;
    else return 0;
  }
  return score / (tokens.length * 2 || 1);
}

/** Global search and command palette: Ctrl/⌘ K or "/". */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, lang, setLang } = useLang();
  const { theme, setTheme } = useTheme();
  const { setPreset } = useDashboardRange({});
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      } else if (event.key === "/" && !typing && !open) {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const run = (action: () => void) => {
    onOpenChange(false);
    setQuery("");
    action();
  };
  const keep = (prev: Record<string, unknown>) => prev;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] max-w-2xl translate-y-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">
          {t("Search and commands", "Pretraga i komande")}
        </DialogTitle>
        <Command
          filter={matchWords}
          className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group]]:px-1.5 [&_[cmdk-item]]:gap-2.5 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2 [&_[cmdk-item]_svg]:text-muted-foreground"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t(
              "Search markets, borders, workspaces, actions…",
              "Pretraži tržišta, granice, radne prostore…",
            )}
          />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>{t("Nothing matches.", "Nema rezultata.")}</CommandEmpty>
            <CommandGroup heading={t("Workspaces", "Radni prostori")}>
              {WORKSPACES.map((workspace) => (
                <CommandItem
                  key={workspace.id}
                  value={`${workspace.en} ${workspace.sr} ${workspace.questionEn}`}
                  onSelect={() =>
                    run(() => void navigate({ to: workspace.to, search: keep as never }))
                  }
                >
                  <workspace.icon className="h-4 w-4" />
                  <span>{lang === "sr" ? workspace.sr : workspace.en}</span>
                  <span className="ml-auto truncate pl-4 text-[11px] text-muted-foreground">
                    {lang === "sr" ? workspace.questionSr : workspace.questionEn}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={t("Markets", "Tržišta")}>
              {SEE_CODES.map((code) => {
                const market = SEE_MARKETS[code];
                return (
                  <CommandItem
                    key={code}
                    value={`market ${market.short} ${market.name} ${market.nameSr} ${market.exchange ?? ""} ${market.tso}`}
                    onSelect={() =>
                      run(
                        () =>
                          void navigate({
                            to: "/dashboard",
                            search: ((prev: Record<string, unknown>) => ({
                              ...prev,
                              m: code,
                              b: undefined,
                            })) as never,
                          }),
                      )
                    }
                  >
                    <MapPin className="h-4 w-4" />
                    <span className="num w-10 text-xs text-muted-foreground">{market.short}</span>
                    <span>{lang === "sr" ? market.nameSr : market.name}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {market.exchange ?? t("no day-ahead market", "bez day-ahead tržišta")}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={t("Borders", "Granice")}>
              {SEE_BORDERS.map((border) => (
                <CommandItem
                  key={border.id}
                  value={`border ${SEE_MARKETS[border.a].short} ${SEE_MARKETS[border.b].short} ${SEE_MARKETS[border.a].name} ${SEE_MARKETS[border.b].name}`}
                  onSelect={() =>
                    run(
                      () =>
                        void navigate({
                          to: "/dashboard/borders",
                          search: ((prev: Record<string, unknown>) => ({
                            ...prev,
                            b: border.id,
                            m: undefined,
                          })) as never,
                        }),
                    )
                  }
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  <span className="num text-xs">
                    {SEE_MARKETS[border.a].short} ⇄ {SEE_MARKETS[border.b].short}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {border.link === "HVDC" ? "HVDC · " : ""}
                    {border.allocation === "implicit"
                      ? t("implicit (coupled)", "implicitno (spojeno)")
                      : t("explicit auctions", "eksplicitne aukcije")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={t("Period", "Period")}>
              {PERIODS.map((period) => (
                <CommandItem
                  key={period.key}
                  value={`period ${period.en} ${period.sr}`}
                  onSelect={() => run(() => setPreset(period.key))}
                >
                  <CalendarRange className="h-4 w-4" />
                  {lang === "sr" ? period.sr : period.en}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={t("Preferences", "Podešavanja")}>
              <CommandItem
                value="theme dark light tema"
                onSelect={() => run(() => setTheme(theme === "dark" ? "light" : "dark"))}
              >
                <SunMoon className="h-4 w-4" />
                {theme === "dark"
                  ? t("Switch to light theme", "Svetla tema")
                  : t("Switch to dark theme", "Tamna tema")}
              </CommandItem>
              <CommandItem
                value="language jezik english srpski"
                onSelect={() => run(() => setLang(lang === "en" ? "sr" : "en"))}
              >
                <Languages className="h-4 w-4" />
                {lang === "en" ? "Prebaci na srpski" : "Switch to English"}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
