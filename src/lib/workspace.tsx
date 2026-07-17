/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type DashboardRole = "analyst" | "producer" | "consumer" | "vpp" | "battery" | "investor";

export type PortfolioProfile =
  | "serbia-market"
  | "solar-project"
  | "wind-project"
  | "industrial-consumer"
  | "battery"
  | "aggregated-portfolio";

export const DASHBOARD_ROLES: Array<{
  value: DashboardRole;
  en: string;
  sr: string;
  defaultPortfolio: PortfolioProfile;
  defaultPortfolioView: "producer" | "consumer" | "vpp" | "battery" | "project";
}> = [
  {
    value: "analyst",
    en: "Market Analyst",
    sr: "Trzisni analiticar",
    defaultPortfolio: "serbia-market",
    defaultPortfolioView: "producer",
  },
  {
    value: "producer",
    en: "RES Producer",
    sr: "OIE proizvodjac",
    defaultPortfolio: "solar-project",
    defaultPortfolioView: "producer",
  },
  {
    value: "consumer",
    en: "Electricity Consumer",
    sr: "Potrosac elektricne energije",
    defaultPortfolio: "industrial-consumer",
    defaultPortfolioView: "consumer",
  },
  {
    value: "vpp",
    en: "VPP / Aggregator",
    sr: "VPP / Agregator",
    defaultPortfolio: "aggregated-portfolio",
    defaultPortfolioView: "vpp",
  },
  {
    value: "battery",
    en: "Battery Operator",
    sr: "Operator baterije",
    defaultPortfolio: "battery",
    defaultPortfolioView: "battery",
  },
  {
    value: "investor",
    en: "Investor / Developer",
    sr: "Investitor / developer",
    defaultPortfolio: "solar-project",
    defaultPortfolioView: "project",
  },
];

export const PORTFOLIO_PROFILES: Array<{
  value: PortfolioProfile;
  en: string;
  sr: string;
  kind: "public" | "private-ready";
}> = [
  { value: "serbia-market", en: "Serbia Market", sr: "Trziste Srbije", kind: "public" },
  { value: "solar-project", en: "Solar Project", sr: "Solarni projekat", kind: "private-ready" },
  { value: "wind-project", en: "Wind Project", sr: "Vetro projekat", kind: "private-ready" },
  {
    value: "industrial-consumer",
    en: "Industrial Consumer",
    sr: "Industrijski potrosac",
    kind: "private-ready",
  },
  { value: "battery", en: "Battery", sr: "Baterija", kind: "private-ready" },
  {
    value: "aggregated-portfolio",
    en: "Aggregated Portfolio",
    sr: "Agregirani portfolio",
    kind: "private-ready",
  },
];

type WorkspaceContextValue = {
  role: DashboardRole;
  setRole: (role: DashboardRole) => void;
  portfolio: PortfolioProfile;
  setPortfolio: (portfolio: PortfolioProfile) => void;
  selectedRole: (typeof DASHBOARD_ROLES)[number];
  selectedPortfolio: (typeof PORTFOLIO_PROFILES)[number];
  privateDataRequiredMessage: string;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const ROLE_STORAGE_KEY = "cea.workspace.role";
const PORTFOLIO_STORAGE_KEY = "cea.workspace.portfolio";

function readPortfolio(): PortfolioProfile {
  if (typeof localStorage === "undefined") return "serbia-market";
  const stored = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
  return PORTFOLIO_PROFILES.some((profile) => profile.value === stored)
    ? (stored as PortfolioProfile)
    : "serbia-market";
}

function roleForPortfolio(portfolio: PortfolioProfile): DashboardRole {
  if (portfolio === "industrial-consumer") return "consumer";
  if (portfolio === "battery") return "battery";
  if (portfolio === "aggregated-portfolio") return "vpp";
  if (portfolio === "solar-project" || portfolio === "wind-project") return "producer";
  return "analyst";
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<DashboardRole>("analyst");
  const [portfolio, setPortfolioState] = useState<PortfolioProfile>("serbia-market");

  useEffect(() => {
    const storedPortfolio = readPortfolio();
    setPortfolioState(storedPortfolio);
    setRoleState(roleForPortfolio(storedPortfolio));
  }, []);

  const setRole = useCallback((nextRole: DashboardRole) => {
    setRoleState(nextRole);
    const roleConfig = DASHBOARD_ROLES.find((item) => item.value === nextRole);
    if (roleConfig) setPortfolioState(roleConfig.defaultPortfolio);
    try {
      localStorage.setItem(ROLE_STORAGE_KEY, nextRole);
      if (roleConfig) localStorage.setItem(PORTFOLIO_STORAGE_KEY, roleConfig.defaultPortfolio);
    } catch {
      // Local storage is optional.
    }
  }, []);

  const setPortfolio = useCallback((nextPortfolio: PortfolioProfile) => {
    const nextRole = roleForPortfolio(nextPortfolio);
    setPortfolioState(nextPortfolio);
    setRoleState(nextRole);
    try {
      localStorage.setItem(PORTFOLIO_STORAGE_KEY, nextPortfolio);
      localStorage.setItem(ROLE_STORAGE_KEY, nextRole);
    } catch {
      // Local storage is optional.
    }
  }, []);

  const selectedRole = DASHBOARD_ROLES.find((item) => item.value === role) ?? DASHBOARD_ROLES[0];
  const selectedPortfolio =
    PORTFOLIO_PROFILES.find((item) => item.value === portfolio) ?? PORTFOLIO_PROFILES[0];

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      role,
      setRole,
      portfolio,
      setPortfolio,
      selectedRole,
      selectedPortfolio,
      privateDataRequiredMessage: "Connect or upload asset data to calculate this metric.",
    }),
    [portfolio, role, selectedPortfolio, selectedRole, setPortfolio, setRole],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("WorkspaceProvider missing");
  return context;
}
