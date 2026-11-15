// The application menu as plain data: seven workspaces plus reference links.
//
// A workspace is one menu button. Related pages live under it as tabs; every page keeps its
// own URL, so existing links and bookmarks keep working.

export interface NavTab {
  to: string;
  en: string;
  sr: string;
  questionEn: string;
  questionSr: string;
}

export interface NavWorkspace {
  id: string;
  /** Landing page; also the first tab. */
  to: string;
  en: string;
  sr: string;
  /** Short rail label. */
  shortEn: string;
  shortSr: string;
  /** The trading or investment question this workspace answers. */
  questionEn: string;
  questionSr: string;
  /** Shown on the rail; reference links live under "More" and in the mobile menu footer. */
  primary: boolean;
  /** Pages of this workspace, in order. Empty for single-page workspaces. */
  tabs: NavTab[];
}

export const NAV: NavWorkspace[] = [
  {
    id: "command",
    to: "/dashboard",
    en: "Command Center",
    sr: "Komandni centar",
    shortEn: "Desk",
    shortSr: "Desk",
    questionEn: "What is happening across SEE power markets?",
    questionSr: "Šta se dešava na tržištima JIE?",
    primary: true,
    tabs: [],
  },
  {
    id: "prices",
    to: "/dashboard/prices",
    en: "Price Analytics",
    sr: "Analitika cena",
    shortEn: "Prices",
    shortSr: "Cene",
    questionEn: "Which markets are dear or cheap, and when?",
    questionSr: "Koja tržišta su skupa ili jeftina, i kada?",
    primary: true,
    tabs: [],
  },
  {
    id: "borders",
    to: "/dashboard/borders",
    en: "Cross-Border",
    sr: "Prekogranično",
    shortEn: "Borders",
    shortSr: "Granice",
    questionEn: "Where is power moving and which borders are tight?",
    questionSr: "Kuda teče energija i koje granice su zagušene?",
    primary: true,
    tabs: [
      {
        to: "/dashboard/borders",
        en: "All borders",
        sr: "Sve granice",
        questionEn: "Where is power moving and which borders are tight?",
        questionSr: "Kuda teče energija i koje granice su zagušene?",
      },
      {
        to: "/dashboard/flows",
        en: "Serbia detail",
        sr: "Srbija detaljno",
        questionEn: "Serbia's borders: capacity auctions, utilisation, routes",
        questionSr: "Granice Srbije: aukcije kapaciteta, iskorišćenost, rute",
      },
      {
        to: "/dashboard/balance",
        en: "Serbia & WB6 balance",
        sr: "Bilans Srbije i ZB6",
        questionEn: "Who is importing and exporting in the Western Balkans?",
        questionSr: "Ko uvozi i izvozi na Zapadnom Balkanu?",
      },
    ],
  },
  {
    id: "fundamentals",
    to: "/dashboard/fundamentals",
    en: "Fundamentals",
    sr: "Fundamenti",
    shortEn: "Fundam.",
    shortSr: "Fundam.",
    questionEn: "What is driving price: load, mix, renewables, outages, weather?",
    questionSr: "Šta pokreće cenu: potrošnja, miks, OIE, ispadi, vreme?",
    primary: true,
    tabs: [
      {
        to: "/dashboard/fundamentals",
        en: "Load & mix",
        sr: "Potrošnja i miks",
        questionEn: "What is driving price: load, mix, renewables?",
        questionSr: "Šta pokreće cenu: potrošnja, miks, OIE?",
      },
      {
        to: "/dashboard/outages",
        en: "Outages, weather & Danube",
        sr: "Ispadi, vreme i Dunav",
        questionEn: "Which units are out, and what are weather and hydrology doing?",
        questionSr: "Koje jedinice su van pogona i kakvi su vreme i hidrologija?",
      },
    ],
  },
  {
    id: "forwards",
    to: "/dashboard/futures",
    en: "Forwards & Forecast",
    sr: "Terminsko tržište i prognoza",
    shortEn: "Forwards",
    shortSr: "Fjučersi",
    questionEn: "How is the forward curve priced?",
    questionSr: "Kako je vrednovana terminska kriva?",
    primary: true,
    tabs: [],
  },
  {
    id: "projects",
    to: "/dashboard/ppa",
    en: "Projects",
    sr: "Projekti",
    shortEn: "Projects",
    shortSr: "Projekti",
    questionEn: "What is a PPA, a battery or a solar or wind project worth?",
    questionSr: "Koliko vredi PPA, baterija ili solarni i vetro projekat?",
    primary: true,
    tabs: [
      {
        to: "/dashboard/ppa",
        en: "PPA Studio",
        sr: "PPA studio",
        questionEn: "What is a solar, wind or baseload PPA worth?",
        questionSr: "Koliko vredi solarni, vetro ili baseload PPA?",
      },
      {
        to: "/dashboard/bess",
        en: "BESS Lab",
        sr: "BESS laboratorija",
        questionEn: "What can a battery earn on these prices?",
        questionSr: "Koliko baterija može da zaradi na ovim cenama?",
      },
      {
        to: "/dashboard/calculator",
        en: "Project economics",
        sr: "Ekonomika projekata",
        questionEn: "Does this solar, wind, BESS or hybrid project pay back?",
        questionSr: "Da li se projekat isplati?",
      },
      {
        to: "/dashboard/capture",
        en: "RES capture",
        sr: "OIE capture",
        questionEn: "How much are renewables cannibalising price?",
        questionSr: "Koliko OIE obaraju sopstvenu cenu?",
      },
    ],
  },
  {
    id: "watch",
    to: "/dashboard/watch",
    en: "Watch",
    sr: "Praćenje",
    shortEn: "Watch",
    shortSr: "Praćenje",
    questionEn: "What needs my attention?",
    questionSr: "Šta zahteva moju pažnju?",
    primary: true,
    tabs: [
      {
        to: "/dashboard/watch",
        en: "Watchlist & alerts",
        sr: "Praćenje i upozorenja",
        questionEn: "What needs my attention?",
        questionSr: "Šta zahteva moju pažnju?",
      },
      {
        to: "/dashboard/insights",
        en: "Signals & news",
        sr: "Signali i vesti",
        questionEn: "Analytical signals and the policy and news monitor",
        questionSr: "Analitički signali i pregled vesti i regulative",
      },
    ],
  },
  // Reference: reachable from "More" and the menu footer, not part of the daily rail.
  {
    id: "reports",
    to: "/dashboard/market-report",
    en: "CEA Market Report",
    sr: "CEA tržišni izveštaj",
    shortEn: "Report",
    shortSr: "Izveštaj",
    questionEn: "Export-ready market report",
    questionSr: "Izveštaj spreman za izvoz",
    primary: false,
    tabs: [],
  },
  {
    id: "academy",
    to: "/dashboard/academy",
    en: "Power Academy",
    sr: "Power Academy",
    shortEn: "Academy",
    shortSr: "Akademija",
    questionEn: "Video lessons on how power markets work",
    questionSr: "Video lekcije o tome kako rade tržišta električne energije",
    primary: false,
    tabs: [],
  },
  {
    id: "data",
    to: "/dashboard/methodology",
    en: "Data & Methodology",
    sr: "Podaci i metodologija",
    shortEn: "Data",
    shortSr: "Podaci",
    questionEn: "Sources, coverage, formulas and their limits",
    questionSr: "Izvori, pokrivenost, formule i ograničenja",
    primary: false,
    tabs: [],
  },
];

const clean = (pathname: string) => pathname.replace(/\/$/, "") || "/dashboard";

function pagesOf(workspace: NavWorkspace): string[] {
  return [workspace.to, ...workspace.tabs.map((tab) => tab.to)];
}

/** The workspace a path belongs to: exact page first, then sub-pages such as an Academy episode. */
export function navWorkspaceFor(pathname: string): NavWorkspace {
  const path = clean(pathname);
  return (
    NAV.find((workspace) => pagesOf(workspace).includes(path)) ??
    NAV.filter((workspace) => workspace.to !== "/dashboard").find((workspace) =>
      pagesOf(workspace).some((page) => path.startsWith(`${page}/`)),
    ) ??
    NAV[0]
  );
}

/** The tab of a workspace that is open at this path, if it has tabs. */
export function navTabFor(workspace: NavWorkspace, pathname: string): NavTab | null {
  if (workspace.tabs.length === 0) return null;
  const path = clean(pathname);
  return (
    workspace.tabs.find((tab) => tab.to === path) ??
    workspace.tabs.find((tab) => path.startsWith(`${tab.to}/`)) ??
    workspace.tabs[0]
  );
}

export interface NavDestination {
  to: string;
  en: string;
  sr: string;
  questionEn: string;
  questionSr: string;
  workspaceId: string;
}

/** Every page reachable from the menu, flat, for search. Tabs are named with their workspace. */
export function navDestinations(): NavDestination[] {
  const out: NavDestination[] = [];
  for (const workspace of NAV) {
    if (workspace.tabs.length === 0) {
      out.push({ ...workspace, workspaceId: workspace.id });
      continue;
    }
    for (const tab of workspace.tabs) {
      out.push({
        to: tab.to,
        en: `${workspace.en}: ${tab.en}`,
        sr: `${workspace.sr}: ${tab.sr}`,
        questionEn: tab.questionEn,
        questionSr: tab.questionSr,
        workspaceId: workspace.id,
      });
    }
  }
  return out;
}
