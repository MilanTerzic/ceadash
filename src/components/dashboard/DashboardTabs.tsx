import { Link, useLocation } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Calculator,
  ChevronDown,
  FileChartColumn,
  LayoutDashboard,
  Menu,
} from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

type NavItem = {
  to: string;
  label: string;
  description: string;
};

type NavGroup = {
  label: string;
  icon: typeof LayoutDashboard;
  to?: string;
  items?: NavItem[];
};

function activeFor(pathname: string, group: NavGroup) {
  if (group.to) return pathname === group.to;
  return (
    group.items?.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`)) ?? false
  );
}

export function DashboardTabs() {
  const { pathname } = useLocation();
  const { t } = useLang();

  const groups: NavGroup[] = [
    { to: "/dashboard", label: t("Overview", "Pregled"), icon: LayoutDashboard },
    {
      label: t("Markets", "Tržišta"),
      icon: BarChart3,
      items: [
        {
          to: "/dashboard/regional",
          label: t("Prices & Flows", "Cene i tokovi"),
          description: t(
            "Regional DA prices and physical-flow snapshot",
            "Regionalne day-ahead cene i fizički tokovi",
          ),
        },
        {
          to: "/dashboard/capture",
          label: t("RES Capture Prices", "Capture cene OIE"),
          description: t(
            "Solar, wind and baseload capture analytics",
            "Analitika capture cena za solar, vetar i baznu cenu",
          ),
        },
        {
          to: "/dashboard/market",
          label: t("Serbia Market Position", "Pozicija tržišta Srbije"),
          description: t(
            "Serbian prices, spreads and market statistics",
            "Cene, spreadovi i statistika Srbije",
          ),
        },
        {
          to: "/dashboard/report",
          label: t("Flexibility & Storage", "Fleksibilnost i skladištenje"),
          description: t(
            "BESS spreads and daily trading signals",
            "BESS spreadovi i dnevni tržišni signali",
          ),
        },
      ],
    },
    {
      label: t("Intelligence", "Analitika"),
      icon: FileChartColumn,
      items: [
        {
          to: "/dashboard/weekly",
          label: t("Market Brief", "Tržišni pregled"),
          description: t("Weekly CEA market intelligence", "Nedeljna CEA analiza tržišta"),
        },
        {
          to: "/dashboard/report",
          label: t("CEA Report", "CEA izveštaj"),
          description: t("LinkedIn-ready CEA market report", "CEA izveštaj spreman za LinkedIn"),
        },
        {
          to: "/dashboard/insights",
          label: t("Analytical Signals", "Analitički signali"),
          description: t(
            "Serbia RES market signals and context",
            "Signali i kontekst OIE tržišta Srbije",
          ),
        },
        {
          to: "/dashboard/news",
          label: t("News & Policy", "Vesti i regulativa"),
          description: t("Policy and market updates", "Regulatorne i tržišne vesti"),
        },
      ],
    },
    {
      label: t("Calculators", "Kalkulatori"),
      icon: Calculator,
      items: [
        {
          to: "/dashboard/calculator",
          label: t("Solar Project Calculator", "Kalkulator solarnog projekta"),
          description: t(
            "Project economics and financing assumptions",
            "Ekonomika projekta i finansijske pretpostavke",
          ),
        },
        {
          to: "/dashboard/cbam",
          label: t("CBAM Export Calculator", "CBAM izvozni kalkulator"),
          description: t(
            "Carbon-cost impact on export economics",
            "Uticaj troška ugljenika na ekonomiku izvoza",
          ),
        },
      ],
    },
    { to: "/dashboard/methodology", label: t("Methodology", "Metodologija"), icon: BookOpen },
  ];

  return (
    <div className="sticky top-[73px] z-20 border-b border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="hidden h-14 items-center gap-2 lg:flex">
          {groups.map((group) => {
            const Icon = group.icon;
            const active = activeFor(pathname, group);
            if (group.to) {
              return (
                <Link
                  key={group.label}
                  to={group.to}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {group.label}
                </Link>
              );
            }

            return (
              <DropdownMenu key={group.label}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {group.label}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80 p-2">
                  <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </DropdownMenuLabel>
                  {group.items?.map((item) => (
                    <DropdownMenuItem key={item.to} asChild>
                      <Link
                        to={item.to}
                        className={cn(
                          "flex cursor-pointer flex-col items-start gap-0.5 rounded-lg px-3 py-2",
                          pathname === item.to && "bg-muted text-primary",
                        )}
                      >
                        <span className="font-medium">{item.label}</span>
                        <span className="text-xs text-muted-foreground">{item.description}</span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
        </div>

        <div className="flex h-14 items-center justify-between lg:hidden">
          <div className="text-sm font-medium text-muted-foreground">
            {t("Dashboard navigation", "Dashboard navigacija")}
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Menu className="h-4 w-4" />
                {t("Menu", "Meni")}
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[330px] overflow-y-auto bg-background p-5 sm:max-w-sm"
            >
              <SheetHeader className="text-left">
                <SheetTitle className="font-display text-2xl">CEA Power Dashboard</SheetTitle>
              </SheetHeader>
              <Accordion type="multiple" className="mt-6 space-y-2">
                {groups.map((group) => {
                  const Icon = group.icon;
                  const active = activeFor(pathname, group);
                  if (group.to) {
                    return (
                      <SheetClose asChild key={group.label}>
                        <Link
                          to={group.to}
                          className={cn(
                            "flex min-h-11 items-center gap-3 rounded-xl border border-border/70 px-3 text-sm font-medium",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-card text-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          {group.label}
                        </Link>
                      </SheetClose>
                    );
                  }
                  return (
                    <AccordionItem
                      key={group.label}
                      value={group.label}
                      className="rounded-xl border border-border/70 bg-card px-3"
                    >
                      <AccordionTrigger
                        className={cn("min-h-11 py-0 hover:no-underline", active && "text-primary")}
                      >
                        <span className="flex items-center gap-3">
                          <Icon className="h-4 w-4" />
                          {group.label}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-1 pb-3">
                        {group.items?.map((item) => (
                          <SheetClose asChild key={item.to}>
                            <Link
                              to={item.to}
                              className={cn(
                                "block rounded-lg px-3 py-2 text-sm",
                                pathname === item.to
                                  ? "bg-muted text-primary"
                                  : "text-muted-foreground hover:bg-muted/70",
                              )}
                            >
                              <span className="font-medium">{item.label}</span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {item.description}
                              </span>
                            </Link>
                          </SheetClose>
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </div>
  );
}
