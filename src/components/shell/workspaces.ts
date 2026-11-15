import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeftRight,
  BookOpen,
  Bell,
  CandlestickChart,
  FileText,
  FlaskConical,
  GraduationCap,
  LineChart,
  Radar,
} from "lucide-react";

import {
  NAV,
  navDestinations,
  navTabFor,
  navWorkspaceFor,
  type NavDestination,
  type NavTab,
  type NavWorkspace,
} from "./nav-structure";

export type { NavTab };

export interface Workspace extends NavWorkspace {
  icon: LucideIcon;
}

const ICONS: Record<string, LucideIcon> = {
  command: Radar,
  prices: LineChart,
  borders: ArrowLeftRight,
  fundamentals: Activity,
  forwards: CandlestickChart,
  projects: FlaskConical,
  watch: Bell,
  reports: FileText,
  academy: GraduationCap,
  data: BookOpen,
};

export const WORKSPACES: Workspace[] = NAV.map((workspace) => ({
  ...workspace,
  icon: ICONS[workspace.id] ?? Radar,
}));

export function workspaceFor(pathname: string): Workspace {
  const found = navWorkspaceFor(pathname);
  return WORKSPACES.find((workspace) => workspace.id === found.id) ?? WORKSPACES[0];
}

export function tabFor(workspace: Workspace, pathname: string): NavTab | null {
  return navTabFor(workspace, pathname);
}

export interface Destination extends NavDestination {
  icon: LucideIcon;
}

/** All pages for the command palette. */
export const DESTINATIONS: Destination[] = navDestinations().map((destination) => ({
  ...destination,
  icon: ICONS[destination.workspaceId] ?? Radar,
}));
