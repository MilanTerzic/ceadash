import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  FileChartColumn,
  LayoutDashboard,
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
    id: "today",
    label: { en: "Today", sr: "Danas" },
    icon: LayoutDashboard,
    to: "/dashboard",
  },
  {
    id: "markets",
    label: { en: "Markets", sr: "Trzista" },
    icon: BarChart3,
    items: [
      {
        id: "spot",
        to: "/dashboard/markets/spot",
        label: { en: "Spot Markets", sr: "Spot trzista" },
        description: {
          en: "Day-ahead prices, spreads, heatmaps and regional comparison",
          sr: "Day-ahead cene, spreadovi, heatmap i regionalno poredjenje",
        },
      },
      {
        id: "outlook",
        to: "/dashboard/markets/outlook",
        label: { en: "Forwards & Outlook", sr: "Terminske cene i izgledi" },
        description: {
          en: "Futures, forecasts, weather, outages and hydrology",
          sr: "Futures, prognoze, vreme, ispadi i hidrologija",
        },
      },
      {
        id: "system",
        to: "/dashboard/markets/system",
        label: { en: "System & Borders", sr: "Sistem i granice" },
        description: {
          en: "Flows, capacity, utilization, Serbia and WB6 balance",
          sr: "Tokovi, kapacitet, iskoriscenost, Srbija i WB6 bilans",
        },
      },
    ],
  },
  {
    id: "portfolio",
    label: { en: "Portfolio & Flexibility", sr: "Portfolio i fleksibilnost" },
    icon: BriefcaseBusiness,
    to: "/dashboard/portfolio",
  },
  {
    id: "reports",
    label: { en: "Reports", sr: "Izvestaji" },
    icon: FileChartColumn,
    to: "/dashboard/reports",
  },
  {
    id: "more",
    label: { en: "More", sr: "Vise" },
    icon: BookOpen,
    to: "/dashboard/more",
  },
];
