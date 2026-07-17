import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  FileChartColumn,
  LayoutDashboard,
  TrendingUp,
  Zap,
} from "lucide-react";

export type LocalizedLabel = {
  en: string;
  sr: string;
};

export type DashboardNavItem = {
  id: string;
  to: string;
  label: LocalizedLabel;
  description: LocalizedLabel;
};

export type DashboardNavGroup = {
  id: string;
  label: LocalizedLabel;
  icon: LucideIcon;
  to?: string;
  items?: DashboardNavItem[];
};

export const dashboardNavGroups: DashboardNavGroup[] = [
  {
    id: "overview",
    label: { en: "Overview", sr: "Pregled" },
    icon: LayoutDashboard,
    to: "/dashboard",
  },
  {
    id: "markets",
    label: { en: "Markets", sr: "Tržišta" },
    icon: BarChart3,
    items: [
      {
        id: "prices",
        to: "/dashboard/prices",
        label: { en: "Prices & Spreads", sr: "Cene i spreadovi" },
        description: {
          en: "Market summary, hourly profiles and regional spreads",
          sr: "Pregled tržišta, satni profili i regionalni spreadovi",
        },
      },
      {
        id: "flows",
        to: "/dashboard/flows",
        label: { en: "Cross-Border & Flows", sr: "Granice i tokovi" },
        description: {
          en: "Capacity, utilization, physical flows and route map",
          sr: "Kapacitet, iskorišćenost, fizički tokovi i mapa ruta",
        },
      },
      {
        id: "balance",
        to: "/dashboard/balance",
        label: { en: "Regional & Serbia Balance", sr: "Regionalni i srpski bilans" },
        description: {
          en: "Serbia position, WB6 comparison and net-balance analysis",
          sr: "Pozicija Srbije, WB6 poređenje i neto bilans",
        },
      },
    ],
  },
  {
    id: "outlook",
    label: { en: "Outlook", sr: "Izgledi" },
    icon: Zap,
    items: [
      {
        id: "futures",
        to: "/dashboard/futures",
        label: { en: "Futures & Forecast", sr: "Fjučersi i prognoza" },
        description: {
          en: "Forward curves, forecast inputs and assumptions",
          sr: "Forward krive, ulazi za prognozu i pretpostavke",
        },
      },
      {
        id: "fundamentals",
        to: "/dashboard/outages",
        label: { en: "System Fundamentals", sr: "Fundamenti sistema" },
        description: {
          en: "Outages, weather and hydrology",
          sr: "Ispadi, vreme i hidrologija",
        },
      },
    ],
  },
  {
    id: "intelligence",
    label: { en: "Market Intelligence", sr: "Tržišna analitika" },
    icon: FileChartColumn,
    items: [
      {
        id: "reports",
        to: "/dashboard/market-report",
        label: { en: "CEA Reports", sr: "CEA izveštaji" },
        description: {
          en: "Market report, weekly brief and export-ready outputs",
          sr: "Tržišni izveštaj, nedeljni pregled i izvozi",
        },
      },
      {
        id: "signals-news",
        to: "/dashboard/insights",
        label: { en: "Signals & News", sr: "Signali i vesti" },
        description: {
          en: "Analytical signals plus news and policy monitor",
          sr: "Analitički signali i pregled vesti i regulative",
        },
      },
    ],
  },
  {
    id: "renewables",
    label: { en: "Renewables", sr: "OIE" },
    icon: TrendingUp,
    items: [
      {
        id: "res-flex",
        to: "/dashboard/capture",
        label: { en: "RES & Flexibility", sr: "OIE i fleksibilnost" },
        description: {
          en: "Capture prices, negative-price exposure and BESS signals",
          sr: "Capture cene, izloženost negativnim cenama i BESS signali",
        },
      },
      {
        id: "project-economics",
        to: "/dashboard/calculator",
        label: { en: "Project Economics", sr: "Ekonomika projekata" },
        description: {
          en: "Solar, wind, BESS and hybrid project economics",
          sr: "Ekonomika solarnih, vetro, BESS i hibridnih projekata",
        },
      },
    ],
  },
  {
    id: "more",
    label: { en: "More", sr: "Još" },
    icon: BookOpen,
    items: [
      {
        id: "methodology",
        to: "/dashboard/methodology",
        label: { en: "Methodology & Data Status", sr: "Metodologija i status podataka" },
        description: {
          en: "Calculation methodology, providers, cache and configuration",
          sr: "Metodologija, provajderi, keš i konfiguracija",
        },
      },
    ],
  },
];
