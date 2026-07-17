import { Link, useLocation } from "@tanstack/react-router";
import { ChevronDown, Menu } from "lucide-react";

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
import {
  dashboardNavGroups,
  type DashboardNavGroup,
  type LocalizedLabel,
} from "@/components/dashboard/navigation/config";

function localize(label: LocalizedLabel, t: (en: string, sr: string) => string) {
  return t(label.en, label.sr);
}

function activeFor(pathname: string, group: DashboardNavGroup) {
  if (group.to) return pathname === group.to;
  return (
    group.items?.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`)) ?? false
  );
}

function primaryDestination(group: DashboardNavGroup) {
  return group.to ?? (group.items?.length === 1 ? group.items[0]?.to : undefined);
}

export function DashboardTabs() {
  const { pathname } = useLocation();
  const { t } = useLang();

  return (
    <div className="sticky top-[73px] z-20 border-b border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="hidden h-14 items-center gap-2 lg:flex">
          {dashboardNavGroups.map((group) => {
            const Icon = group.icon;
            const active = activeFor(pathname, group);
            const directTo = primaryDestination(group);
            if (directTo && (!group.items || group.items.length <= 1)) {
              return (
                <Link
                  key={group.id}
                  to={directTo}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {localize(group.label, t)}
                </Link>
              );
            }

            return (
              <DropdownMenu key={group.id}>
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
                    {localize(group.label, t)}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80 p-2">
                  <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                    {localize(group.label, t)}
                  </DropdownMenuLabel>
                  {group.items?.map((item) => (
                    <DropdownMenuItem key={item.id} asChild>
                      <Link
                        to={item.to}
                        className={cn(
                          "flex cursor-pointer flex-col items-start gap-0.5 rounded-lg px-3 py-2",
                          pathname === item.to && "bg-muted text-primary",
                        )}
                      >
                        <span className="font-medium">{localize(item.label, t)}</span>
                        <span className="text-xs text-muted-foreground">
                          {localize(item.description, t)}
                        </span>
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
                {dashboardNavGroups.map((group) => {
                  const Icon = group.icon;
                  const active = activeFor(pathname, group);
                  const directTo = primaryDestination(group);
                  if (directTo && (!group.items || group.items.length <= 1)) {
                    return (
                      <SheetClose asChild key={group.id}>
                        <Link
                          to={directTo}
                          className={cn(
                            "flex min-h-11 items-center gap-3 rounded-xl border border-border/70 px-3 text-sm font-medium",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-card text-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          {localize(group.label, t)}
                        </Link>
                      </SheetClose>
                    );
                  }
                  return (
                    <AccordionItem
                      key={group.id}
                      value={group.id}
                      className="rounded-xl border border-border/70 bg-card px-3"
                    >
                      <AccordionTrigger
                        className={cn("min-h-11 py-0 hover:no-underline", active && "text-primary")}
                      >
                        <span className="flex items-center gap-3">
                          <Icon className="h-4 w-4" />
                          {localize(group.label, t)}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-1 pb-3">
                        {group.items?.map((item) => (
                          <SheetClose asChild key={item.id}>
                            <Link
                              to={item.to}
                              className={cn(
                                "block rounded-lg px-3 py-2 text-sm",
                                pathname === item.to
                                  ? "bg-muted text-primary"
                                  : "text-muted-foreground hover:bg-muted/70",
                              )}
                            >
                              <span className="font-medium">{localize(item.label, t)}</span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {localize(item.description, t)}
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
