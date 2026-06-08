import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, UserSearch, Trophy, GraduationCap, Users, RefreshCw,
  BookMarked, Library, LifeBuoy, CalendarCheck, School, ClipboardCheck,
} from "lucide-react";
import type { AppRole } from "@/lib/types";
import { isAdminPlus, isSuper } from "@/lib/types";

export type Role = AppRole;

export interface NavItem {
  id: string;
  label: string;
  href: string;            // real route
  icon: LucideIcon;
  hint?: string;           // shown in the ⌘K palette
  badgeKey?: BadgeKey;     // which live count (if any) to render
}
export interface NavGroup { group: string | null; items: NavItem[]; }

export type BadgeKey = "applicants" | "users" | "toClaim";

// ---- accent ----------------------------------------------------------------
export const ORR_ORANGE = "#ff6a3d";
export const SCHOOL_ACCENT: Record<string, string> = {
  IU: "#cf2740", Purdue: "#b1810b", Butler: "#13294b",
  DePauw: "#000000", Wabash: "#8b0000", default: "#cf2740",
};

// Admin tiers = Orr orange. Fellow/lead = their school color (the DB's
// color_primary is preferred upstream; this map is only the fallback).
export function accentFor(role: Role, school?: string): string {
  if (isAdminPlus(role)) return ORR_ORANGE;
  return SCHOOL_ACCENT[school ?? "default"] ?? SCHOOL_ACCENT.default;
}

// ---- access (single source of truth for sidebar + route guards) ------------
export const WORKSPACE_SECTIONS = ["snapshot", "my-school", "standings", "applicants", "playbook", "resources"] as const;
export const CONSOLE_SECTIONS = ["overview", "applicants", "standings", "schools", "users", "sync", "review", "playbook", "resources"] as const;

export function canAccessWorkspaceSection(role: Role, section: string): boolean {
  if (isAdminPlus(role)) return false; // admins/super use the console
  return (WORKSPACE_SECTIONS as readonly string[]).includes(section);
}
export function canAccessConsoleSection(role: Role, section: string): boolean {
  if (!isAdminPlus(role)) return false; // fellows/leads use the workspace
  if (section === "users" || section === "sync") return isSuper(role);
  // overview, applicants, standings, schools, review, playbook, resources → admin+
  return (CONSOLE_SECTIONS as readonly string[]).includes(section);
}

// ---- nav model -------------------------------------------------------------
const HOW_TO: NavItem = { id: "howto", label: "How-To", href: "/how-to", icon: LifeBuoy, hint: "Guides & support" };

function consoleNav(role: Role): NavGroup[] {
  const operations: NavItem[] = isSuper(role)
    ? [
        { id: "users", label: "Users", href: "/console/users", icon: Users, hint: "Roles & access", badgeKey: "users" },
        { id: "sync", label: "Sync", href: "/console/sync", icon: RefreshCw, hint: "JazzHR integration" },
      ]
    : [
        { id: "review", label: "Review Sync", href: "/console/review", icon: ClipboardCheck, hint: "Match JazzHR ↔ sourced" },
      ];
  return [
    { group: null, items: [{ id: "overview", label: "Overview", href: "/console/overview", icon: LayoutDashboard, hint: "Dashboard & KPIs" }] },
    { group: "Recruiting", items: [
      { id: "applicants", label: "Applicants", href: "/console/applicants", icon: UserSearch, hint: "Candidate pipeline", badgeKey: "applicants" },
      { id: "standings", label: "Standings", href: "/console/standings", icon: Trophy, hint: "School leaderboard" },
      { id: "schools", label: "Schools", href: "/console/schools", icon: GraduationCap, hint: "Programs & targets" },
    ] },
    { group: "Operations", items: operations },
    { group: "Knowledge", items: [
      { id: "playbook", label: "Playbook", href: "/console/playbook", icon: BookMarked, hint: "Process & strategy" },
      { id: "resources", label: "Resources", href: "/console/resources", icon: Library, hint: "Docs & assets" },
      HOW_TO,
    ] },
  ];
}

function workspaceNav(): NavGroup[] {
  return [
    { group: null, items: [{ id: "snapshot", label: "Weekly Snapshot", href: "/workspace/snapshot", icon: CalendarCheck, hint: "Your week at a glance" }] },
    { group: "Recruiting", items: [
      { id: "my-school", label: "My School", href: "/workspace/my-school", icon: School, hint: "Your school dashboard" },
      { id: "standings", label: "Standings", href: "/workspace/standings", icon: Trophy, hint: "How schools rank" },
      { id: "applicants", label: "Applicants", href: "/workspace/applicants", icon: UserSearch, hint: "Your candidate pipeline", badgeKey: "applicants" },
    ] },
    { group: "Playbook", items: [
      { id: "playbook", label: "Playbook", href: "/workspace/playbook", icon: BookMarked, hint: "Strategy & process" },
      { id: "resources", label: "Resources", href: "/workspace/resources", icon: Library, hint: "Docs & assets" },
      HOW_TO,
    ] },
  ];
}

export function navForRole(role: Role): NavGroup[] {
  return isAdminPlus(role) ? consoleNav(role) : workspaceNav();
}

// Flattened items (palette + breadcrumb helpers).
export function flatNav(role: Role): (NavItem & { group: string })[] {
  return navForRole(role).flatMap((s) => s.items.map((i) => ({ ...i, group: s.group ?? "Home" })));
}

// Is `href` reachable for this role? (sidebar + palette already enforce this;
// this is the shared check used by the route guards too.)
export function hrefAllowed(role: Role, href: string): boolean {
  return flatNav(role).some((i) => i.href === href);
}
