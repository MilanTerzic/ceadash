import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeftRight,
  BatteryCharging,
  Bell,
  BookOpen,
  Calculator,
  CandlestickChart,
  FileSignature,
  FileText,
  LineChart,
  Newspaper,
  Radar,
  Scale,
  Sun,
  Waves,
  Zap,
} from "lucide-react";

export interface Workspace {
  id: string;
  to: string;
  en: string;
  sr: string;
  /** Short rail label. */
  shortEn: string;
  shortSr: string;
  icon: LucideIcon;
  /** The trading or investment question this workspace answers. */
  questionEn: string;
  questionSr: string;
  /** Shown on the rail; the rest live under "More" and in the command palette. */
  primary: boolean;
}

export const WORKSPACES: Workspace[] = [
  {
    id: "command",
    to: "/dashboard",
    en: "Command Center",
    sr: "Komandni centar",
    shortEn: "Desk",
    shortSr: "Desk",
    icon: Radar,
    questionEn: "What is happening across SEE power markets?",
    questionSr: "Šta se dešava na tržištima JIE?",
    primary: true,
  },
  {
    id: "prices",
    to: "/dashboard/prices",
    en: "Price Analytics",
    sr: "Analitika cena",
    shortEn: "Prices",
    shortSr: "Cene",
    icon: LineChart,
    questionEn: "Which markets are dear or cheap, and when?",
    questionSr: "Koja tržišta su skupa ili jeftina, i kada?",
    primary: true,
  },
  {
    id: "borders",
    to: "/dashboard/borders",
    en: "Cross-Border",
    sr: "Prekogranično",
    shortEn: "Borders",
    shortSr: "Granice",
    icon: ArrowLeftRight,
    questionEn: "Where is power moving and which borders are tight?",
    questionSr: "Kuda teče energija i koje granice su zagušene?",
    primary: true,
  },
  {
    id: "fundamentals",
    to: "/dashboard/fundamentals",
    en: "Fundamentals",
    sr: "Fundamenti",
    shortEn: "Fundam.",
    shortSr: "Fundam.",
    icon: Activity,
    questionEn: "What is driving price: load, mix, renewables?",
    questionSr: "Šta pokreće cenu: potrošnja, miks, OIE?",
    primary: true,
  },
  {
    id: "forwards",
    to: "/dashboard/futures",
    en: "Forwards & Forecast",
    sr: "Terminsko tržište i prognoza",
    shortEn: "Forwards",
    shortSr: "Fjučersi",
    icon: CandlestickChart,
    questionEn: "How is the forward curve priced?",
    questionSr: "Kako je vrednovana terminska kriva?",
    primary: true,
  },
  {
    id: "ppa",
    to: "/dashboard/ppa",
    en: "PPA Studio",
    sr: "PPA studio",
    shortEn: "PPA",
    shortSr: "PPA",
    icon: FileSignature,
    questionEn: "What is a solar, wind or baseload PPA worth?",
    questionSr: "Koliko vredi solarni, vetro ili baseload PPA?",
    primary: true,
  },
  {
    id: "bess",
    to: "/dashboard/bess",
    en: "BESS Lab",
    sr: "BESS laboratorija",
    shortEn: "BESS",
    shortSr: "BESS",
    icon: BatteryCharging,
    questionEn: "What can a battery earn on these prices?",
    questionSr: "Koliko baterija može da zaradi na ovim cenama?",
    primary: true,
  },
  {
    id: "watch",
    to: "/dashboard/watch",
    en: "Watchlist & Alerts",
    sr: "Praćenje i upozorenja",
    shortEn: "Watch",
    shortSr: "Praćenje",
    icon: Bell,
    questionEn: "What needs my attention?",
    questionSr: "Šta zahteva moju pažnju?",
    primary: true,
  },
  {
    id: "capture",
    to: "/dashboard/capture",
    en: "RES Capture",
    sr: "OIE capture",
    shortEn: "Capture",
    shortSr: "Capture",
    icon: Sun,
    questionEn: "How much are renewables cannibalising price?",
    questionSr: "Koliko OIE obaraju sopstvenu cenu?",
    primary: false,
  },
  {
    id: "economics",
    to: "/dashboard/calculator",
    en: "Project Economics",
    sr: "Ekonomika projekata",
    shortEn: "Projects",
    shortSr: "Projekti",
    icon: Calculator,
    questionEn: "Does this solar, wind, BESS or hybrid project pay back?",
    questionSr: "Da li se projekat isplati?",
    primary: false,
  },
  {
    id: "serbia-flows",
    to: "/dashboard/flows",
    en: "Serbia Borders Detail",
    sr: "Granice Srbije detaljno",
    shortEn: "RS flows",
    shortSr: "RS tokovi",
    icon: Zap,
    questionEn: "Serbia's borders: capacity auctions, utilisation, routes",
    questionSr: "Granice Srbije: aukcije kapaciteta, iskorišćenost, rute",
    primary: false,
  },
  {
    id: "balance",
    to: "/dashboard/balance",
    en: "Serbia & WB6 Balance",
    sr: "Bilans Srbije i ZB6",
    shortEn: "Balance",
    shortSr: "Bilans",
    icon: Scale,
    questionEn: "Who is importing and exporting in the Western Balkans?",
    questionSr: "Ko uvozi i izvozi na Zapadnom Balkanu?",
    primary: false,
  },
  {
    id: "outages",
    to: "/dashboard/outages",
    en: "Outages, Weather & Danube",
    sr: "Ispadi, vreme i Dunav",
    shortEn: "Outages",
    shortSr: "Ispadi",
    icon: Waves,
    questionEn: "Which units are out, and what are weather and hydrology doing?",
    questionSr: "Koje jedinice su van pogona i kakvi su vreme i hidrologija?",
    primary: false,
  },
  {
    id: "reports",
    to: "/dashboard/market-report",
    en: "CEA Market Report",
    sr: "CEA tržišni izveštaj",
    shortEn: "Report",
    shortSr: "Izveštaj",
    icon: FileText,
    questionEn: "Export-ready market report",
    questionSr: "Izveštaj spreman za izvoz",
    primary: false,
  },
  {
    id: "signals",
    to: "/dashboard/insights",
    en: "Signals & News",
    sr: "Signali i vesti",
    shortEn: "News",
    shortSr: "Vesti",
    icon: Newspaper,
    questionEn: "Analytical signals and the policy and news monitor",
    questionSr: "Analitički signali i pregled vesti i regulative",
    primary: false,
  },
  {
    id: "data",
    to: "/dashboard/methodology",
    en: "Data & Methodology",
    sr: "Podaci i metodologija",
    shortEn: "Data",
    shortSr: "Podaci",
    icon: BookOpen,
    questionEn: "Sources, coverage, formulas and their limits",
    questionSr: "Izvori, pokrivenost, formule i ograničenja",
    primary: false,
  },
];

export function workspaceFor(pathname: string): Workspace {
  const path = pathname.replace(/\/$/, "") || "/dashboard";
  return (
    WORKSPACES.find((workspace) => workspace.to === path) ??
    WORKSPACES.filter((workspace) => workspace.to !== "/dashboard").find((workspace) =>
      path.startsWith(workspace.to),
    ) ??
    WORKSPACES[0]
  );
}
