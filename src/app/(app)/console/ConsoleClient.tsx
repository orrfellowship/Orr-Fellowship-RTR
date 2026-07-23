"use client";

import { useState, useMemo, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Profile, Resource } from "@/lib/types";
import { isSuper, isAdminPlus, canManageResources } from "@/lib/types";
import {
  toggleFavorite, setNotInterested, logOutreach, getOutreach, getConnections,
  reassignPointPerson, reassignSchool, addConnection, addPhase, upsertTask, deleteTask, deletePhase, updatePhase, type SchoolMatchReviewRow,
  upsertGoal, upsertGroupGoal, updateUser, updateUserName, setUserActive, addCandidate, updateCandidate, deleteCandidate, deleteOutreach, deleteConnection,
  deduplicateCandidates, inviteUser, resendUserInvite, bulkInviteUsers, seedPlaybook,
  unlinkJazzCandidate, getUserSnapshot, listCandidates, getCandidateFacets, migratePlaybooksToDates,
} from "./actions";
import dynamic from "next/dynamic";
import SchoolFilter, { matchesSchoolFilter } from "@/components/SchoolFilter";
import PersonPicker from "@/components/PersonPicker";
import ContactPopover from "@/components/ContactPopover";
import PaginationControls from "@/components/PaginationControls";
import type { CalEvent } from "@/components/RecruitingCalendar";
import type { BudgetEntry, Guidance } from "@/components/BudgetPanel";
import { findDuplicateGroups, nameSchoolKey } from "@/lib/duplicates";

// Per-section code splitting: each /console/<section> route renders exactly one
// of these, so they load as their own chunks instead of shipping the calendar,
// budget, playbook and import code with every console page.
const StandingsClient = dynamic(() => import("@/components/StandingsClient"));
const RecruitingCalendar = dynamic(() => import("@/components/RecruitingCalendar"));
const BudgetPanel = dynamic(() => import("@/components/BudgetPanel"));
const BudgetAnalysis = dynamic(() => import("@/components/BudgetPanel").then((m) => m.BudgetAnalysis));
const PlaybookBoard = dynamic(() => import("@/components/PlaybookBoard"));
const ResourcesPanel = dynamic(() => import("@/components/ResourcesPanel"));
const MatchReview = dynamic(() => import("@/components/MatchReview"));
const DuplicateReview = dynamic(() => import("@/components/DuplicateReview"));
const RoutingReview = dynamic(() => import("@/components/RoutingReview"));
const SchoolMatchReview = dynamic(() => import("@/components/SchoolMatchReview"));
const ResumeModal = dynamic(() => import("@/components/ResumeModal"));
const BulkImportModal = dynamic(() => import("@/components/BulkImportModal"));
const ImportInfoModal = dynamic(() => import("@/components/ImportInfoModal"));
const BulkDeleteCandidatesModal = dynamic(() => import("@/components/BulkDeleteCandidatesModal"));
import { phaseOf, routeToSchoolNameByEmail } from "@/lib/stages";
import { candidateSchoolDisplay, candidateSchoolKey, findMisrouted } from "@/lib/candidateSchool";
import { useIsMobile } from "@/lib/useIsMobile";

const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD",
  orange: "#DD5434", blue: "#8AB9E2", gray: "#303333", grayMute: "#6E7385",
  line: "#E4E7EE", canvas: "#F7F8FB", gold: "#C9A227", good: "#2F8F6B",
};
const HEAD = "var(--font-head)";
// Thousands-separated integer (e.g. 1,200).
const nf = (n: number) => Number(n || 0).toLocaleString("en-US");

// Launch row for an admin review — a compact card that opens the quizlet-style
// ReviewDeck instead of expanding a long inline list.
function ReviewLaunchCard({ accent, title, count, blurb, onOpen }: {
  accent: string; title: string; count: string; blurb: string; onOpen: () => void;
}) {
  return (
    <button onClick={onOpen}
      style={{ marginTop: 12, width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", border: `1px solid ${accent}`, borderRadius: 14, background: `${accent}0e`, cursor: "pointer", textAlign: "left" }}>
      <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 14.5, color: C.navy, flex: 1 }}>
        {title} · <span style={{ color: C.orange }}>{count}</span>
      </span>
      <span style={{ fontSize: 12.5, color: C.grayMute, fontWeight: 600 }}>{blurb}</span>
      <span style={{ color: accent, fontSize: 13, fontWeight: 700 }}>Review →</span>
    </button>
  );
}

type School = { id: string; name: string; tier: string; color_primary: string | null; logo_url: string | null };
type Cand = {
  id: string; jazz_id: string | null; name: string; email: string | null; school_id: string | null;
  stage: string | null; gpa: string | null; area_of_study: string | null; university_raw: string | null;
  linkedin: string | null; resume_link: string | null; grad_date: string | null;
  point_person_id: string | null; not_interested: boolean; is_favorite: boolean;
  source: string | null; created_by: string | null;
};
type TeamMember = { id: string; full_name: string; email?: string | null; school_id?: string | null; role?: string | null };
// Slim full-set projection for the Candidates tab's full-dataset features
// (duplicate detection, JazzHR match review, import dedupe warnings).
type SlimCand = { id: string; name: string; email: string | null; school_id: string | null; jazz_id: string | null; source: string | null; stage: string | null; area_of_study: string | null; gpa: string | null; university_raw: string | null };
type Goal = { school_id: string; goal_sourced: number; goal_contacted: number; goal_applied: number };
type Task = { id: string; text: string; assignee_id: string | null; assignee_label: string | null; month_label: string | null; notes: string | null; due_date: string | null; done: boolean };
type Phase = { id: string; label: string; title: string; sort_order: number; school_id: string; playbook_tasks: Task[] };
type UserProfile = { id: string; full_name: string; email: string; role: string; school_id: string | null; is_active: boolean; last_sign_in_at?: string | null };
type JazzReview = { id: string; jazz_snapshot: any; candidate_id: string | null; reason: string | null };

const ALL_ROLES = ["super_admin", "admin", "team_lead", "fellow"] as const;

// School pickers collapse satellite/bonus tiers into a single grouped option each
// (core schools stay individual). The grouped option's value is a representative
// school_id — the first school of that tier by name — so it maps to a real row.
function schoolSelectOptions(schools: School[]): { value: string; label: string }[] {
  const byTier = (t: string) => schools.filter((s) => s.tier === t).sort((a, b) => a.name.localeCompare(b.name));
  const opts = byTier("core").map((s) => ({ value: s.id, label: s.name }));
  const sat = byTier("satellite");
  const bon = byTier("bonus");
  if (sat.length) opts.push({ value: sat[0].id, label: "Satellite School" });
  if (bon.length) opts.push({ value: bon[0].id, label: "Bonus School" });
  return opts;
}

// Normalize a stored school_id to its picker value: any satellite/bonus school
// resolves to that tier's representative id so the grouped option shows selected.
function schoolOptionValue(schools: School[], schoolId: string | null): string {
  if (!schoolId) return "";
  const s = schools.find((x) => x.id === schoolId);
  if (!s) return "";
  if (s.tier === "satellite" || s.tier === "bonus") {
    const rep = schools.filter((x) => x.tier === s.tier).sort((a, b) => a.name.localeCompare(b.name))[0];
    return rep?.id ?? schoolId;
  }
  return schoolId;
}

const PHASE_OF: Record<string, string> = { new: "Sourced", contacted: "Contacted", applied: "Applied", bmi: "Advanced", finalist: "Finalist", fellow: "Fellow" };
const phaseTone: Record<string, string> = { Sourced: C.navy3, Contacted: C.blue, Applied: C.navy2, Advanced: C.orange, Finalist: C.gold, Fellow: C.good };
function StagePill({ stage }: { stage: string | null }) {
  const ph = stage ? PHASE_OF[stage] ?? stage : "—";
  const tone = phaseTone[ph] ?? C.grayMute;
  return <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: tone, background: `${tone}22`, padding: "4px 9px", borderRadius: 999 }}>{stage ?? "—"}</span>;
}

const SOURCED = new Set(["new", "contacted", "applied", "bmi", "finalist", "fellow"]);
const APPLIED = new Set(["applied", "bmi", "finalist", "fellow"]);

function fmtPct(actual: number, goal: number) {
  if (!goal || goal <= 0) return "—";
  const p = (actual / goal) * 100;
  return (p > 999 ? ">999" : p.toFixed(0)) + "%";
}

function sumGoalsForScope(scope: string, goals: Goal[], schools: School[], field: "goal_sourced" | "goal_applied") {
  const goalMap = new Map(goals.map((g) => [g.school_id, g]));

  if (scope !== "all" && !scope.startsWith("tier:")) {
    return goalMap.get(scope)?.[field] ?? 0;
  }

  const scopedSchools = scope === "all"
    ? schools
    : schools.filter((s) => s.tier === scope.slice("tier:".length));
  const countedGroupTiers = new Set<string>();

  return scopedSchools.reduce((sum, school) => {
    if (school.tier === "satellite" || school.tier === "bonus") {
      if (countedGroupTiers.has(school.tier)) return sum;
      countedGroupTiers.add(school.tier);
      const tierSchoolIds = new Set(schools.filter((s) => s.tier === school.tier).map((s) => s.id));
      const groupGoal = goals.find((g) => tierSchoolIds.has(g.school_id));
      return sum + (groupGoal?.[field] ?? 0);
    }
    return sum + (goalMap.get(school.id)?.[field] ?? 0);
  }, 0);
}

function overviewSchoolKey(candidate: Pick<Cand, "school_id" | "university_raw">, schools: School[]): string | null {
  return candidateSchoolKey(candidate, schools);
}

// Weighted stage-count row (school × raw university × stage, n candidates).
type StageCount = { school_id: string | null; university_raw: string | null; stage: string | null; n: number };
// Total candidates in `rows` whose stage is in `set`.
function countStages(rows: StageCount[], set: Set<string>): number {
  return rows.reduce((s, r) => s + (r.stage && set.has(r.stage) ? r.n : 0), 0);
}

export default function ConsoleClient({
  profile, initialSection, schools, candidates, stageCounts = [], schoolReviews = [], team, goals, phases, users, reviews, resources,
  events = [], people = [], budgetEntries = [], budgetGuidance = [],
  candidatesTotal, candidatesPageSize = 500, facetMajors = [], facetStages = [], facetUnrouted = 0, slimCandidates = [],
}: {
  profile: Profile; initialSection: string; schools: School[]; candidates: Cand[]; team: TeamMember[];
  // Aggregate sections (overview/standings/schools) read weighted counts — one
  // row per school × raw university × stage — instead of full candidate rows.
  stageCounts?: StageCount[];
  // Pending phase20 school-match reviews (applicants section).
  schoolReviews?: SchoolMatchReviewRow[];
  goals: Goal[]; phases: Phase[]; users: UserProfile[];
  reviews: JazzReview[]; resources: Resource[];
  events?: CalEvent[]; people?: { id: string; full_name: string }[]; budgetEntries?: BudgetEntry[]; budgetGuidance?: Guidance[];
  // Candidates tab is server-paginated: `candidates` is the first page; these
  // carry the total count + the full-set facets/slim list the page still needs.
  candidatesTotal?: number; candidatesPageSize?: number;
  facetMajors?: string[]; facetStages?: string[]; facetUnrouted?: number;
  slimCandidates?: SlimCand[];
}) {
  const isMobile = useIsMobile();
  const [tab] = useState<"overview" | "applicants" | "standings" | "playbook" | "schools" | "calendar" | "budget" | "users" | "sync" | "resources" | "review">(initialSection as any);
  const [scope, setScope] = useState<string>("all"); // SchoolFilter value: all | id | tier:satellite | tier:bonus
  const [appSchool, setAppSchool] = useState<string>("all");
  const [obExpand, setObExpand] = useState<Record<string, boolean>>({}); // overview "By school" tier expand
  const [budgetView, setBudgetView] = useState<"manage" | "analysis">("analysis");
  const [snapshotUser, setSnapshotUser] = useState<UserProfile | null>(null);
  const [usrSearch, setUsrSearch] = useState("");
  const [usrRole, setUsrRole] = useState("all");
  const [usrSchool, setUsrSchool] = useState("all");
  const [usrStatus, setUsrStatus] = useState<"all" | "active" | "inactive">("all");
  const [usrSort, setUsrSort] = useState<{ key: "name" | "email" | "role" | "school" | "signin"; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [playbookSchool, setPlaybookSchool] = useState<string>(schoolSelectOptions(schools)[0]?.value ?? "");
  const [pbAssignee, setPbAssignee] = useState<string>("all");
  const [pbFrom, setPbFrom] = useState<string>("");
  const [pbTo, setPbTo] = useState<string>("");
  const [pbMigrating, setPbMigrating] = useState(false);
  const router = useRouter();
  const pbFiltersActive = pbAssignee !== "all" || pbFrom !== "" || pbTo !== "";
  const pbMatches = (t: Task): boolean => {
    if (pbAssignee === "team" && t.assignee_label !== "team") return false;
    if (pbAssignee === "unassigned" && (t.assignee_id || t.assignee_label === "team")) return false;
    if (pbAssignee !== "all" && pbAssignee !== "team" && pbAssignee !== "unassigned" && t.assignee_id !== pbAssignee) return false;
    if ((pbFrom || pbTo) && !t.due_date) return false;
    if (pbFrom && t.due_date && t.due_date < pbFrom) return false;
    if (pbTo && t.due_date && t.due_date > pbTo) return false;
    return true;
  };
  const [openId, setOpenId] = useState<string | null>(null);
  const [showUnrouted, setShowUnrouted] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [bulkDelOpen, setBulkDelOpen] = useState(false);
  // Applicants filters + sort
  const [appSearch, setAppSearch] = useState("");
  const [appMajor, setAppMajor] = useState("All majors");
  const [appStage, setAppStage] = useState("All stages");
  const [appMinGpa, setAppMinGpa] = useState("");
  const [appFavOnly, setAppFavOnly] = useState(false);
  const [appCreator, setAppCreator] = useState("anyone"); // anyone | jazzhr | <profile_id>
  const [appSort, setAppSort] = useState<{ key: "name" | "school" | "major" | "gpa" | "stage"; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  // Server-paginated Candidates tab. `candidates` is the first page from the
  // server; we refetch a page whenever filters/sort/page change.
  const [appRows, setAppRows] = useState<Cand[]>(candidates);
  const [appTotal, setAppTotal] = useState<number>(candidatesTotal ?? candidates.length);
  const [appPage, setAppPage] = useState(0);
  const [appPageSize, setAppPageSize] = useState(candidatesPageSize);
  const [appLoading, setAppLoading] = useState(false);
  const [candidateFacets, setCandidateFacets] = useState({
    majors: facetMajors,
    stages: facetStages,
    unroutedCount: facetUnrouted,
    slim: slimCandidates,
  });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [routingOpen, setRoutingOpen] = useState(false);
  const [smrOpen, setSmrOpen] = useState(false);
  // Match-review decks on the JazzHR Sync tab and the dedicated Review Sync page.
  const [syncMatchOpen, setSyncMatchOpen] = useState(false);
  const [reviewSyncOpen, setReviewSyncOpen] = useState(false);

  // Snapshot task links land on /console/applicants?review=duplicates|routing —
  // open the matching panel so the admin isn't hunting for it.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("review");
    if (want === "duplicates") setDupOpen(true);
    if (want === "routing") setRoutingOpen(true);
    if (want === "school-match") setSmrOpen(true);
  }, []);

  // The review panels read the client-side slim snapshot, which router.refresh()
  // can't update — patch it (and the visible page) directly after a fix.
  const handleCandidateDeleted = (id: string) => {
    setCandidateFacets((f) => ({ ...f, slim: f.slim.filter((c) => c.id !== id) }));
    setAppRows((rows) => rows.filter((c) => c.id !== id));
    setAppTotal((t) => Math.max(0, t - 1));
  };
  const handleRoutingMoved = (moves: { id: string; school_id: string }[]) => {
    const dest = new Map(moves.map((m) => [m.id, m.school_id]));
    setCandidateFacets((f) => ({ ...f, slim: f.slim.map((c) => dest.has(c.id) ? { ...c, school_id: dest.get(c.id)! } : c) }));
    setAppRows((rows) => rows.map((c) => dest.has(c.id) ? { ...c, school_id: dest.get(c.id)! } : c));
  };
  const [inviteOpen, setInviteOpen] = useState(false);
  const [bulkInviteOpen, setBulkInviteOpen] = useState(false);
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);
  const [updatingActiveId, setUpdatingActiveId] = useState<string | null>(null);
  const [resendInviteMessage, setResendInviteMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [dedupMsg, setDedupMsg] = useState<string | null>(null);
  const [deduping, setDeduping] = useState(false);
  const [syncingIds, setSyncingIds] = useState(false);
  const [syncIdsMsg, setSyncIdsMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const superUser = isSuper(profile.role);
  const adminPlus = isAdminPlus(profile.role);
  // School picker options shown everywhere EXCEPT the Candidates page: core
  // schools individually + one "Satellite School" + one "Bonus School" group.
  const schoolPickOptions = useMemo(() => schoolSelectOptions(schools).map((o) => ({ id: o.value, name: o.label })), [schools]);

  const nameOf = (id: string | null) => id ? (id === profile.id ? "You" : team.find((t) => t.id === id)?.full_name ?? "—") : "Unassigned";

  async function handleResendInvite(user: UserProfile) {
    if (!confirm(`Send a new account setup link to ${user.full_name}? The link will let them choose a password.`)) return;
    setResendingInviteId(user.id);
    setResendInviteMessage(null);
    try {
      const result = await resendUserInvite(user.id);
      if ("error" in result && result.error) {
        setResendInviteMessage({ kind: "error", text: result.error });
      } else {
        setResendInviteMessage({ kind: "success", text: `Account setup email queued for ${user.full_name}.` });
      }
    } catch {
      setResendInviteMessage({ kind: "error", text: "The account setup email could not be sent." });
    } finally {
      setResendingInviteId(null);
    }
  }

  async function handleUserActiveChange(user: UserProfile) {
    const nextActive = !user.is_active;
    if (!confirm(`${nextActive ? "Reactivate" : "Deactivate"} ${user.full_name}? ${nextActive ? "They will be able to sign in again." : "They will lose access, but their assignments and history will be preserved."}`)) return;
    setUpdatingActiveId(user.id);
    setResendInviteMessage(null);
    try {
      const result = await setUserActive(user.id, nextActive);
      if ("error" in result && result.error) {
        setResendInviteMessage({ kind: "error", text: result.error });
      } else {
        setResendInviteMessage({ kind: "success", text: `${user.full_name} ${nextActive ? "reactivated" : "deactivated"}. Refreshing…` });
        router.refresh();
      }
    } catch {
      setResendInviteMessage({ kind: "error", text: `Could not ${nextActive ? "reactivate" : "deactivate"} this user.` });
    } finally {
      setUpdatingActiveId(null);
    }
  }

  // ---- JazzHR sync (super-admin only) ----
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [rerouteResult, setRerouteResult] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ id: string; title: string; status: string | null; city: string | null }[] | null>(null);
  const [listing, setListing] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);
  const CONFIRM = "DELETE ALL CANDIDATES";

  async function listJobs() {
    setListing(true); setSyncError(null);
    try {
      const res = await fetch("/api/sync", { method: "GET" });
      const data = await res.json();
      if (!res.ok) setSyncError(typeof data.error === "string" ? data.error : JSON.stringify(data));
      else setJobs(data.jobs ?? []);
    } catch (e: any) { setSyncError(e?.message ?? "Request failed"); }
    finally { setListing(false); }
  }

  async function clearData() {
    setClearing(true); setClearMsg(null);
    try {
      const res = await fetch("/api/clear-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: confirmText }) });
      const data = await res.json();
      if (!res.ok) setClearMsg(`Error: ${typeof data.error === "string" ? data.error : JSON.stringify(data)}`);
      else { setClearMsg(`Cleared ${data.deleted} candidates. Refresh to see the empty state.`); setConfirmText(""); }
    } catch (e: any) { setClearMsg(`Error: ${e?.message ?? "Request failed"}`); }
    finally { setClearing(false); }
  }

  async function runReroute() {
    setRerouting(true); setRerouteResult(null); setSyncError(null);
    try {
      const res = await fetch("/api/sync", { method: "PUT" });
      const data = await res.json();
      if (!res.ok) setSyncError(typeof data.error === "string" ? data.error : JSON.stringify(data));
      else setRerouteResult(`Routed ${data.matched} candidate${data.matched !== 1 ? "s" : ""} to schools · ${data.still_unrouted} still unrouted (likely out-of-state)`);
    } catch (e: any) { setSyncError(e?.message ?? "Request failed"); }
    finally { setRerouting(false); }
  }

  async function runSync(mode: "full" | "refresh") {
    setSyncing(true); setSyncResult(null); setSyncError(null);
    try {
      const res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const data = await res.json();
      if (!res.ok) setSyncError(typeof data.error === "string" ? data.error : JSON.stringify(data));
      else setSyncResult(`${data.partial ? "Partial (re-run to continue)" : "Complete"} · linked ${data.linked ?? 0} · refreshed ${data.refreshed ?? 0} · imported ${data.imported ?? 0} · review queue ${data.queued ?? 0}${data.failed ? ` · failed ${data.failed}` : ""}${data.remaining ? ` · ${data.remaining} remaining` : ""}`);
    } catch (e: any) { setSyncError(e?.message ?? "Request failed"); }
    finally { setSyncing(false); }
  }

  async function syncResumeIds() {
    setSyncingIds(true); setSyncIdsMsg(null);
    try {
      const res = await fetch("/api/sync-jazz-ids", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setSyncIdsMsg(`Error: ${typeof data.error === "string" ? data.error : JSON.stringify(data)}`);
      else setSyncIdsMsg(`Mapped ${data.synced} prospect${data.synced !== 1 ? "s" : ""} across ${data.pages} page${data.pages !== 1 ? "s" : ""}.`);
    } catch (e: any) { setSyncIdsMsg(`Error: ${e?.message ?? "Request failed"}`); }
    finally { setSyncingIds(false); }
  }

  // scoreboard totals
  const board = useMemo(() => {
    const rows = stageCounts.filter((r) => matchesSchoolFilter(scope, r.school_id, schools));
    return [
      { label: "Sourced", actual: countStages(rows, SOURCED), goal: sumGoalsForScope(scope, goals, schools, "goal_sourced") },
      { label: "Applied", actual: countStages(rows, APPLIED), goal: sumGoalsForScope(scope, goals, schools, "goal_applied") },
    ];
  }, [scope, stageCounts, goals, schools]);

  const open = appRows.find((c) => c.id === openId) ?? candidates.find((c) => c.id === openId) ?? null;

  // Fetch one page of candidates with the current filters/sort applied server-side.
  const APP_PAGE_SIZE = appPageSize;
  const loadAppPage = async (page: number) => {
    setAppLoading(true);
    const res = await listCandidates({
      variant: "console", page, pageSize: APP_PAGE_SIZE,
      scope: appSchool, unroutedOnly: showUnrouted,
      q: appSearch, major: appMajor, stage: appStage, minGpa: appMinGpa,
      favOnly: appFavOnly, creator: appCreator,
      sortKey: appSort.key, sortDir: appSort.dir,
    });
    setAppRows(res.rows as Cand[]);
    setAppTotal(res.total);
    setAppPage(page);
    setAppLoading(false);
  };
  // Refetch page 0 whenever a filter/sort changes (debounced so typing in the
  // search box doesn't fire a request per keystroke). Skips the initial mount —
  // the server already provided page 0.
  const appMounted = useRef(false);
  useEffect(() => {
    if (tab !== "applicants") return;
    if (!appMounted.current) { appMounted.current = true; return; }
    const t = setTimeout(() => { loadAppPage(0); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSearch, appSchool, appMajor, appStage, appMinGpa, appFavOnly, appCreator, appSort, showUnrouted, appPageSize]);

  const facetsLoaded = useRef(candidateFacets.slim.length > 0 || candidateFacets.majors.length > 0 || candidateFacets.stages.length > 0 || candidateFacets.unroutedCount > 0);
  useEffect(() => {
    if (tab !== "applicants" || facetsLoaded.current) return;
    facetsLoaded.current = true;
    getCandidateFacets(true)
      .then((f) => setCandidateFacets(f))
      .catch(() => {
        facetsLoaded.current = false;
      });
  }, [tab]);
  const playbookSchoolObj = schools.find((s) => s.id === playbookSchool);
  const playbookGrouped = playbookSchoolObj?.tier === "satellite" || playbookSchoolObj?.tier === "bonus";
  const playbookLabel = schoolSelectOptions(schools).find((o) => o.value === playbookSchool)?.label ?? playbookSchoolObj?.name ?? "School";
  // Satellite/bonus share one team AND one playbook across the tier, so both
  // are matched tier-wide (phases may live under any of the group's rows).
  const playbookTierIds = playbookGrouped
    ? new Set(schools.filter((s) => s.tier === playbookSchoolObj?.tier).map((s) => s.id))
    : new Set([playbookSchool]);
  const playbookPhases = phases.filter((p) => playbookTierIds.has(p.school_id));
  const playbookTeam = team.filter((m) => m.school_id && playbookTierIds.has(m.school_id));
  // Flatten this school's tasks for the person-grouped board + a lookup for updates.
  const playbookTaskMap = new Map(playbookPhases.flatMap((p) => p.playbook_tasks.map((t) => [t.id, { t, phaseId: p.id }])));
  const playbookTasks = playbookPhases
    .flatMap((p) => p.playbook_tasks.map((t) => ({ id: t.id, phaseId: p.id, phaseTitle: p.title, text: t.text, assigneeId: t.assignee_id, dueDate: t.due_date, done: t.done })))
    .filter((t) => pbMatches(playbookTaskMap.get(t.id)!.t));
  const playbookPhaseOpts = playbookPhases.map((p) => ({ id: p.id, title: p.title }));
  const updatePlaybookTask = (taskId: string, patch: { text?: string; phaseId?: string; dueDate?: string | null; assigneeId?: string | null; done?: boolean }) => {
    const found = playbookTaskMap.get(taskId); if (!found) return;
    const o = found.t;
    startTransition(() => { upsertTask({
      id: taskId,
      phase_id: patch.phaseId ?? found.phaseId,
      text: patch.text ?? o.text,
      assignee_id: patch.assigneeId !== undefined ? patch.assigneeId : o.assignee_id,
      assignee_label: o.assignee_label ?? null,
      month_label: o.month_label ?? null,
      notes: o.notes ?? null,
      due_date: patch.dueDate !== undefined ? patch.dueDate : o.due_date,
      done: patch.done !== undefined ? patch.done : o.done,
    }); });
  };

  // goal draft state: school_id → {sourced, contacted, applied}
  const [goalDrafts, setGoalDrafts] = useState<Record<string, { sourced: string; contacted: string; applied: string }>>({});
  const [goalSaved, setGoalSaved] = useState<Record<string, "saved" | "error">>({});
  const [goalErr, setGoalErr] = useState<Record<string, string>>({});
  // group goal draft state: tier → {sourced, contacted, applied}
  const [groupGoalDrafts, setGroupGoalDrafts] = useState<Record<string, { sourced: string; contacted: string; applied: string }>>({});
  const [groupGoalSaved, setGroupGoalSaved] = useState<Record<string, "saved" | "error">>({});
  const [groupGoalErr, setGroupGoalErr] = useState<Record<string, string>>({});
  const goalDraft = (sid: string) => {
    if (goalDrafts[sid]) return goalDrafts[sid];
    const g = goals.find((g) => g.school_id === sid);
    return { sourced: String(g?.goal_sourced ?? 0), contacted: String(g?.goal_contacted ?? 0), applied: String(g?.goal_applied ?? 0) };
  };
  const setGoalField = (sid: string, field: "sourced" | "contacted" | "applied", val: string) =>
    setGoalDrafts((prev) => ({ ...prev, [sid]: { ...goalDraft(sid), [field]: val } }));
  const groupGoalDraft = (tier: string, tierSchoolIds: string[]) => {
    if (groupGoalDrafts[tier]) return groupGoalDrafts[tier];
    // Use first school's goal as the shared group goal (all should be the same)
    const g = goals.find((g) => tierSchoolIds.includes(g.school_id));
    return { sourced: String(g?.goal_sourced ?? 0), contacted: String(g?.goal_contacted ?? 0), applied: String(g?.goal_applied ?? 0) };
  };
  const setGroupGoalField = (tier: string, tierSchoolIds: string[], field: "sourced" | "contacted" | "applied", val: string) =>
    setGroupGoalDrafts((prev) => ({ ...prev, [tier]: { ...groupGoalDraft(tier, tierSchoolIds), [field]: val } }));

  return (
    <>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: isMobile ? "20px 14px 60px" : "30px 28px 80px", opacity: pending ? 0.7 : 1 }}>

        {/* ---- OVERVIEW ---- */}
        {tab === "overview" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
              <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Where the program stands</h1>
              <SchoolFilter schools={schools} value={scope} onChange={setScope} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(220px, 340px))", justifyContent: "center", gap: 16, marginTop: 22 }}>
              {board.map((b) => {
                const p = b.goal > 0 ? (b.actual / b.goal) * 100 : 0;
                const tone = p >= 100 ? C.good : p >= 70 ? C.gold : C.orange;
                return (
                  <div key={b.label} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
                    <div style={{ background: C.navy, color: "#fff", padding: "16px 20px", textAlign: "center" }}>
                      <div style={{ fontFamily: HEAD, fontSize: 13, fontWeight: 600, textTransform: "uppercase", opacity: 0.8 }}>{b.label}</div>
                      <div style={{ fontFamily: HEAD, fontSize: 40, fontWeight: 700, marginTop: 4 }}>{nf(b.actual)}</div>
                    </div>
                    <div style={{ padding: "12px 20px", textAlign: "center", borderBottom: `1px solid ${C.line}` }}>
                      <div style={{ fontSize: 12, color: C.grayMute, fontWeight: 600 }}>Goal</div>
                      <div style={{ fontFamily: HEAD, fontSize: 22, fontWeight: 700, color: C.navy2 }}>{nf(b.goal)}</div>
                    </div>
                    <div style={{ padding: "12px 20px", textAlign: "center", background: `${tone}14` }}>
                      <div style={{ fontSize: 12, color: C.grayMute, fontWeight: 600 }}>% Complete</div>
                      <div style={{ fontFamily: HEAD, fontSize: 26, fontWeight: 700, color: tone }}>{fmtPct(b.actual, b.goal)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <h2 style={{ fontFamily: HEAD, fontSize: 20, color: C.navy, margin: "32px 0 12px" }}>By school</h2>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", padding: "10px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                <div>School</div><div>Sourced</div><div>Applied</div>
              </div>
              {(() => {
                const cnt = (keys: string[]) => {
                  const keySet = new Set(keys);
                  const rows = stageCounts.filter((r) => {
                    const key = overviewSchoolKey(r, schools);
                    return !!key && keySet.has(key);
                  });
                  return { sourced: countStages(rows, SOURCED), applied: countStages(rows, APPLIED) };
                };
                const row = (key: string, name: string, sub: string, ids: string[], accent: string, opts: { logo?: string | null; indent?: boolean; expandKey?: string } = {}) => {
                  const c2 = cnt(ids);
                  const exp = opts.expandKey ? !!obExpand[opts.expandKey] : false;
                  return (
                    <div key={key} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", padding: "12px 18px", paddingLeft: opts.indent ? 40 : 18, borderBottom: `1px solid ${C.line}`, alignItems: "center", borderLeft: `4px solid ${accent}`, background: opts.indent ? "#FBFBFE" : "#fff" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {opts.expandKey && <button onClick={() => setObExpand((p) => ({ ...p, [opts.expandKey!]: !p[opts.expandKey!] }))} style={{ border: "none", background: "none", cursor: "pointer", color: C.grayMute, fontSize: 11, padding: 0 }}>{exp ? "▾" : "▸"}</button>}
                        {opts.logo && <img src={opts.logo} alt="" style={{ height: 24, width: 24, objectFit: "contain", borderRadius: 4 }} />}
                        <div><div style={{ fontWeight: 700, color: C.gray }}>{name}</div><div style={{ fontSize: 11, color: C.grayMute, textTransform: "capitalize" }}>{sub}</div></div>
                      </div>
                      <div style={{ color: accent, fontWeight: 700 }}>{nf(c2.sourced)}</div>
                      <div style={{ color: accent, fontWeight: 700 }}>{nf(c2.applied)}</div>
                    </div>
                  );
                };
                const byName = (a: School, b: School) => a.name.localeCompare(b.name);
                const core = schools.filter((s) => s.tier === "core").sort(byName);
                const sat = schools.filter((s) => s.tier === "satellite").sort(byName);
                const bon = schools.filter((s) => s.tier === "bonus").sort(byName);
                const rawRows = (tier: string) => {
                  const byKey = new Map<string, string>();
                  for (const c of stageCounts) {
                    const key = overviewSchoolKey(c, schools);
                    if (!key?.startsWith(`raw:${tier}:`)) continue;
                    byKey.set(key, candidateSchoolDisplay(c, schools).specificLabel ?? candidateSchoolDisplay(c, schools).label);
                  }
                  return Array.from(byKey, ([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
                };
                const satRaw = rawRows("satellite");
                const bonRaw = rawRows("bonus");
                return (
                  <>
                    {core.map((s) => row(s.id, s.name, "core", [s.id], s.color_primary ?? C.navy2, { logo: s.logo_url }))}
                    {sat.length > 0 && row("g-sat", "Satellite School", `${sat.length + satRaw.length} schools`, [...sat.map((s) => s.id), "tier:satellite", ...satRaw.map((r) => r.key)], C.navy2, { expandKey: "satellite" })}
                    {obExpand.satellite && row("g-sat-general", "Satellite School", "group-routed", ["tier:satellite"], C.navy2, { indent: true })}
                    {obExpand.satellite && sat.map((s) => row(s.id, s.name, "satellite", [s.id], s.color_primary ?? C.navy2, { logo: s.logo_url, indent: true }))}
                    {obExpand.satellite && satRaw.map((s) => row(s.key, s.name, "satellite", [s.key], C.navy2, { indent: true }))}
                    {bon.length > 0 && row("g-bon", "Bonus School", `${bon.length + bonRaw.length} schools`, [...bon.map((s) => s.id), "tier:bonus", ...bonRaw.map((r) => r.key)], C.navy2, { expandKey: "bonus" })}
                    {obExpand.bonus && row("g-bon-general", "Bonus School", "group-routed", ["tier:bonus"], C.navy2, { indent: true })}
                    {obExpand.bonus && bon.map((s) => row(s.id, s.name, "bonus", [s.id], s.color_primary ?? C.navy2, { logo: s.logo_url, indent: true }))}
                    {obExpand.bonus && bonRaw.map((s) => row(s.key, s.name, "bonus", [s.key], C.navy2, { indent: true }))}
                  </>
                );
              })()}
            </div>
          </>
        )}

        {/* ---- APPLICANTS ---- */}
        {tab === "applicants" && (() => {
          // Rows are filtered/sorted/paginated by the server (loadAppPage); the
          // dropdowns + full-set widgets read the facets/slim list passed in.
          const distinctMajors = candidateFacets.majors;
          const distinctStages = candidateFacets.stages;
          const unroutedCount = candidateFacets.unroutedCount;
          const slimCandidateRows = candidateFacets.slim;
          const visible = appRows;
          const toggleSort = (key: typeof appSort.key) =>
            setAppSort((p) => p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
          const arrow = (key: typeof appSort.key) => appSort.key === key ? (appSort.dir === "asc" ? " ▲" : " ▼") : "";
          const SortHead = ({ k, label }: { k: typeof appSort.key; label: string }) => (
            <div onClick={() => toggleSort(k)} style={{ cursor: "pointer", userSelect: "none", color: appSort.key === k ? C.navy : C.grayMute }}>{label}{arrow(k)}</div>
          );
          const filtersActive = appSearch.trim() !== "" || appMajor !== "All majors" || appStage !== "All stages" || appFavOnly || appMinGpa.trim() !== "" || appSchool !== "all" || appCreator !== "anyone";

          // Pagination control — rendered both above and below the table.
          const pager = (where: "top" | "bottom") => <div style={{ marginTop: where === "top" ? 8 : 0 }}><PaginationControls page={appPage} pageSize={APP_PAGE_SIZE} total={appTotal} loading={appLoading}
            onPageChange={loadAppPage} onPageSizeChange={(size) => { setAppPage(0); setAppPageSize(size); }} /></div>;

          return (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
              <div>
                <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Candidates</h1>
                <p style={{ color: C.grayMute, margin: "4px 0 0" }}>
                  {appTotal.toLocaleString()} candidate{appTotal !== 1 ? "s" : ""}{appLoading ? " · loading…" : ""}
                  {unroutedCount > 0 && !showUnrouted && <span style={{ color: C.orange }}> · {unroutedCount} unrouted</span>}
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button onClick={() => setAddOpen(true)} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: C.navy, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" }}>+ Add</button>
                <button onClick={() => setBulkOpen(true)} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 700, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" }}>Bulk import</button>
                <button onClick={() => setInfoOpen(true)} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 700, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" }}>Import info</button>
                {adminPlus && <button onClick={() => setBulkDelOpen(true)} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.orange}`, background: "#fff", color: C.orange, fontWeight: 700, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" }}>Bulk delete</button>}
              </div>
            </div>

            {/* JazzHR match review — applicants that may be an existing sourced candidate */}
            {adminPlus && reviews.length > 0 && (
              <>
                <ReviewLaunchCard accent={C.orange} title="Match review"
                  count={`${reviews.length} need${reviews.length === 1 ? "s" : ""} a decision`}
                  blurb="JazzHR applicants that may already be sourced"
                  onOpen={() => setReviewOpen(true)} />
                <MatchReview reviews={reviews} candidates={slimCandidateRows} schools={schools} open={reviewOpen} onClose={() => setReviewOpen(false)} />
              </>
            )}

            {/* School match review — intake text the matcher couldn't place */}
            {adminPlus && schoolReviews.length > 0 && (
              <>
                <ReviewLaunchCard accent={C.gold} title="School match review"
                  count={`${schoolReviews.length} unplaced`}
                  blurb="Typed school names that need a decision"
                  onOpen={() => setSmrOpen(true)} />
                <SchoolMatchReview reviews={schoolReviews} schools={schools} open={smrOpen} onClose={() => setSmrOpen(false)} />
              </>
            )}

            {/* Duplicate candidates — any source (manual, import, JazzHR) */}
            {adminPlus && (() => {
              const dupCount = findDuplicateGroups(slimCandidateRows).length;
              if (dupCount === 0) return null;
              return (
                <>
                  <ReviewLaunchCard accent={C.orange} title="Potential duplicates"
                    count={`${dupCount} group${dupCount === 1 ? "" : "s"}`}
                    blurb="Same name or email · any source"
                    onOpen={() => setDupOpen(true)} />
                  <DuplicateReview candidates={slimCandidateRows} schools={schools} open={dupOpen} onClose={() => setDupOpen(false)} onDeleted={handleCandidateDeleted} />
                </>
              );
            })()}

            {/* School routing review — imported school text that routes elsewhere */}
            {adminPlus && (() => {
              const misroutedCount = findMisrouted(slimCandidateRows, schools).length;
              if (misroutedCount === 0) return null;
              return (
                <>
                  <ReviewLaunchCard accent={C.navy} title="School routing review"
                    count={`${misroutedCount} candidate${misroutedCount === 1 ? "" : "s"}`}
                    blurb="Imported school text routes to a different school"
                    onOpen={() => setRoutingOpen(true)} />
                  <RoutingReview candidates={slimCandidateRows} schools={schools} open={routingOpen} onClose={() => setRoutingOpen(false)} onMoved={handleRoutingMoved} />
                </>
              );
            })()}

            {/* Filter bar */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
              <input value={appSearch} onChange={(e) => setAppSearch(e.target.value)} placeholder="Search name, email, major…"
                style={{ flex: "1 1 200px", minWidth: 160, padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
              <SchoolFilter schools={schools} value={appSchool} onChange={(v) => { setAppSchool(v); setShowUnrouted(false); }} />
              <select value={appMajor} onChange={(e) => setAppMajor(e.target.value)} style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, background: "#fff", color: C.gray, fontWeight: 600, maxWidth: 200 }}>
                <option>All majors</option>
                {distinctMajors.map((m) => <option key={m}>{m}</option>)}
              </select>
              <select value={appStage} onChange={(e) => setAppStage(e.target.value)} style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, background: "#fff", color: C.gray, fontWeight: 600 }}>
                <option>All stages</option>
                {distinctStages.map((s) => <option key={s}>{s}</option>)}
              </select>
              <select value={appCreator} onChange={(e) => setAppCreator(e.target.value)} title="Added by" style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, background: "#fff", color: C.gray, fontWeight: 600, maxWidth: 180 }}>
                <option value="anyone">Added by: anyone</option>
                <option value="jazzhr">JazzHR sync</option>
                {team.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
              <input value={appMinGpa} onChange={(e) => setAppMinGpa(e.target.value)} type="number" step="0.1" min="0" max="4" placeholder="Min GPA"
                style={{ width: 96, padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
              <button onClick={() => setAppFavOnly((v) => !v)}
                style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${appFavOnly ? C.gold : C.line}`, fontSize: 13.5, background: appFavOnly ? "#FBF3D6" : "#fff", color: appFavOnly ? "#8A6D0E" : C.grayMute, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                {appFavOnly ? "★ Favorites" : "☆ Favorites"}
              </button>
              <button onClick={() => setShowUnrouted((v) => !v)}
                style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${showUnrouted ? C.orange : C.line}`, fontSize: 13.5, background: showUnrouted ? "#FBE7DF" : "#fff", color: showUnrouted ? C.orange : C.grayMute, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                {showUnrouted ? "✕ Unrouted only" : `Unrouted (${unroutedCount})`}
              </button>
              {(filtersActive || showUnrouted) && (
                <button onClick={() => { setAppSearch(""); setAppMajor("All majors"); setAppStage("All stages"); setAppMinGpa(""); setAppFavOnly(false); setShowUnrouted(false); setAppSchool("all"); setAppCreator("anyone"); }}
                  style={{ padding: "9px 12px", borderRadius: 9, border: "none", background: "transparent", color: C.navy2, fontSize: 13, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                  Clear
                </button>
              )}
            </div>

            {pager("top")}

            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16, ...(isMobile ? { overflowX: "auto" } : {}) }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 0.6fr 1fr 40px", minWidth: isMobile ? 640 : undefined, padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                <SortHead k="name" label="Candidate" /><SortHead k="school" label="School" /><SortHead k="major" label="Major" /><SortHead k="gpa" label="GPA" /><SortHead k="stage" label="Stage" /><div></div>
              </div>
              {visible.map((c) => {
                  const schoolDisplay = candidateSchoolDisplay(c, schools);
                  return (
                    <div key={c.id} onClick={() => setOpenId(c.id)}
                      style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 0.6fr 1fr 40px", minWidth: isMobile ? 640 : undefined, padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", cursor: "pointer", opacity: c.not_interested ? 0.5 : 1 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F4FA")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.gray }}><ContactPopover name={c.name} email={c.email} /></div>
                        <div style={{ fontSize: 12, color: C.grayMute }}>{c.email}</div>
                      </div>
                      <div style={{ fontSize: 13.5 }} onClick={(e) => e.stopPropagation()}>
                        {adminPlus ? (
                          <select
                            value={schoolOptionValue(schools, c.school_id)}
                            onChange={(e) => { const v = e.target.value || null; reassignSchool(c.id, v).then(() => loadAppPage(appPage)); }}
                            title={schoolDisplay.label}
                            style={{ fontSize: 12, fontWeight: 600, color: c.school_id ? C.navy2 : C.orange, border: `1px solid ${c.school_id ? C.line : C.orange}`, borderRadius: 7, padding: "4px 6px", background: "#fff", maxWidth: "100%", cursor: "pointer" }}>
                            <option value="">— Unrouted —</option>
                            {schoolSelectOptions(schools).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          !schoolDisplay.isUnrouted
                            ? <span style={{ color: C.navy2, fontWeight: 600 }}>{schoolDisplay.label}</span>
                            : <span style={{ color: C.orange, fontStyle: "italic", fontSize: 12 }}>{schoolDisplay.label}</span>
                        )}
                        {adminPlus && schoolDisplay.isGrouped && schoolDisplay.specificLabel && (
                          <div style={{ marginTop: 3, fontSize: 11, color: C.grayMute, fontWeight: 500 }}>{schoolDisplay.specificLabel}</div>
                        )}
                      </div>
                      <div style={{ fontSize: 13.5 }}>{c.area_of_study}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.gpa}</div>
                      <div><StagePill stage={c.stage} /></div>
                      <div style={{ fontSize: 18, color: c.is_favorite ? C.gold : "#D8DCE5", textAlign: "center" }}>{c.is_favorite ? "★" : "☆"}</div>
                    </div>
                  );
                })}
              {visible.length === 0 && (
                <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>{appLoading ? "Loading…" : filtersActive ? "No candidates match these filters." : showUnrouted ? "No unrouted candidates — routing is complete!" : "No candidates yet — run a sync."}</div>
              )}
            </div>

            {pager("bottom")}
          </>
        );})()}

        {/* ---- STANDINGS ---- */}
        {tab === "standings" && (
          <StandingsClient
            schools={schools}
            candidates={stageCounts.map((r) => ({ school_id: r.school_id, stage: r.stage, n: r.n }))}
            goals={goals}
            mySchoolId={null}
          />
        )}

        {/* ---- CALENDAR ---- */}
        {tab === "calendar" && (
          <>
            <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Recruiting Calendar</h1>
            <p style={{ color: C.grayMute, margin: "4px 0 20px" }}>
              Organization-wide events show on everyone&apos;s Weekly Snapshot; school events show on that school&apos;s.
            </p>
            <RecruitingCalendar
              events={events}
              canEdit={adminPlus}
              profileId={profile.id}
              schoolId={null}
              team={people}
              schools={schoolPickOptions}
              scopePicker
              canManageNotes={adminPlus}
            />
          </>
        )}

        {/* ---- BUDGET ---- */}
        {tab === "budget" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
              <div>
                <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Budget</h1>
                <p style={{ color: C.grayMute, margin: "4px 0 0" }}>You set allocations; team leads log expenses with receipts.</p>
              </div>
              <div style={{ display: "flex", gap: 4, background: C.canvas, borderRadius: 10, padding: 4 }}>
                {([["analysis", "Overview"], ["manage", "Manage"]] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setBudgetView(v)}
                    style={{ border: "none", background: budgetView === v ? "#fff" : "transparent", color: budgetView === v ? C.navy : C.grayMute, fontWeight: 700, fontSize: 13, padding: "7px 16px", borderRadius: 8, cursor: "pointer", boxShadow: budgetView === v ? "0 1px 4px rgba(17,18,62,.1)" : "none" }}>{label}</button>
                ))}
              </div>
            </div>
            {budgetView === "manage"
              ? <BudgetPanel entries={budgetEntries} schools={schoolPickOptions} meId={profile.id} scopePicker canAllocate={adminPlus} canManage={adminPlus} guidance={budgetGuidance} />
              : <BudgetAnalysis entries={budgetEntries} schools={schoolPickOptions} />}
          </>
        )}

        {/* ---- PLAYBOOK ---- */}
        {tab === "playbook" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
              <div>
                <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Team Tasks</h1>
                <p style={{ color: C.grayMute, margin: "4px 0 0" }}>
                  Assign and track each fellow&apos;s tasks for {playbookLabel}{playbookGrouped ? " (shared across this group)" : ""}. Changes save automatically.
                </p>
              </div>
              <select value={playbookSchool} onChange={(e) => setPlaybookSchool(e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 600 }}>
                {schoolSelectOptions(schools).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Dates + due-date filter */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 16, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 14px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 0.5 }}>Dates</span>
              {playbookPhases.map((p) => (
                <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 4px 3px 10px", background: C.canvas }}>
                  <button onClick={() => { const v = prompt("Rename date", p.title); if (v && v.trim() && v.trim() !== p.title) startTransition(() => { updatePhase(p.id, v.trim(), v.trim()); }); }}
                    style={{ border: "none", background: "none", color: C.navy, fontWeight: 600, fontSize: 12.5, cursor: "pointer", padding: 0 }}>{p.title}</button>
                  <button onClick={() => { if (confirm(`Delete the date "${p.title}" and all its tasks?`)) startTransition(() => { deletePhase(p.id); }); }} title="Delete date"
                    style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>×</button>
                </span>
              ))}
              <button onClick={() => { const v = prompt("New date (e.g. July, or a deadline)"); if (v && v.trim()) startTransition(() => { addPhase(playbookSchool, "", v.trim(), playbookPhases.length); }); }}
                style={{ border: `1px dashed ${C.line}`, background: "transparent", color: C.navy2, fontWeight: 600, fontSize: 12.5, padding: "4px 12px", borderRadius: 999, cursor: "pointer" }}>+ Add date</button>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12.5, color: C.grayMute }}>Due</span>
              <input type="date" value={pbFrom} onChange={(e) => setPbFrom(e.target.value)} style={{ padding: "6px 9px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 12.5 }} />
              <span style={{ fontSize: 12.5, color: C.grayMute }}>to</span>
              <input type="date" value={pbTo} onChange={(e) => setPbTo(e.target.value)} style={{ padding: "6px 9px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 12.5 }} />
              {(pbFrom || pbTo) && (
                <button onClick={() => { setPbFrom(""); setPbTo(""); }} style={{ border: "none", background: "transparent", color: C.navy2, fontSize: 12.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Clear</button>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              {playbookPhases.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: C.grayMute, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14 }}>No dates yet — add the first date above to start building this team&apos;s tasks.</div>
              ) : (
                <PlaybookBoard
                  phases={playbookPhaseOpts}
                  members={playbookTeam.map((m) => ({ id: m.id, full_name: m.full_name }))}
                  tasks={playbookTasks}
                  meId={profile.id}
                  accent={C.orange}
                  onAddTask={(assigneeId, phaseId) => startTransition(() => { upsertTask({ phase_id: phaseId, text: "New task", assignee_id: assigneeId, assignee_label: null, month_label: null, notes: null, due_date: null, done: false }); })}
                  onUpdateTask={updatePlaybookTask}
                  onDeleteTask={(id) => startTransition(() => { deleteTask(id); })}
                />
              )}
            </div>
          </>
        )}

        {/* ---- SCHOOLS ---- */}
        {tab === "schools" && adminPlus && (() => {
          // Group schools by tier: core → individual; satellite/bonus → grouped then expandable
          const tierGroups = ["core", "satellite", "bonus"];
          const schoolsByTier = tierGroups.map((tier) => ({
            tier,
            schools: schools.filter((s) => s.tier === tier),
          })).filter((g) => g.schools.length > 0);

          const renderSchoolCard = (s: typeof schools[0], showGoalForm = true) => {
            const accent = s.color_primary ?? C.navy2;
            const sc = stageCounts.filter((r) => r.school_id === s.id);
            const teamSize = users.filter((u) => u.is_active && u.school_id === s.id).length;
            const g = goals.find((g) => g.school_id === s.id);
            const draft = goalDraft(s.id);
            const sourced = countStages(sc, SOURCED);
            const applied = countStages(sc, APPLIED);
            return (
              <div key={s.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${accent}`, borderRadius: 14, padding: "18px 22px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: showGoalForm ? 14 : 0 }}>
                  {s.logo_url && <img src={s.logo_url} alt="" style={{ height: 28, width: 28, objectFit: "contain", borderRadius: 4 }} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: C.gray }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: C.grayMute, textTransform: "capitalize" }}>{s.tier} · {teamSize} teammate{teamSize !== 1 ? "s" : ""}</div>
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    {([["Sourced", sourced, g?.goal_sourced], ["Applied", applied, g?.goal_applied]] as [string, number, number | undefined][]).map(([lbl, act, goal]) => {
                      const hasGoal = (goal ?? 0) > 0;
                      const pct = hasGoal ? Math.round((act / (goal as number)) * 100) : 0;
                      const tone = pct >= 100 ? C.good : pct >= 70 ? C.gold : C.orange;
                      return (
                        <div key={lbl} style={{ textAlign: "center" }}>
                          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 20, color: hasGoal ? tone : C.navy2 }}>{nf(act)}</div>
                          <div style={{ fontSize: 10, color: C.grayMute, fontWeight: 600 }}>{lbl}{hasGoal ? ` · ${pct}%` : ""}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {showGoalForm && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: C.grayMute, fontWeight: 600 }}>Goals:</span>
                    {(["sourced", "applied"] as const).map((field) => (
                      <label key={field} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 12, color: C.grayMute, textTransform: "capitalize" }}>{field}</span>
                        <input type="number" min={0} value={draft[field]}
                          onChange={(e) => setGoalField(s.id, field, e.target.value)}
                          style={{ width: 60, padding: "5px 8px", borderRadius: 7, border: `1px solid ${C.line}`, fontSize: 13, fontWeight: 700, color: C.navy, textAlign: "center" }} />
                      </label>
                    ))}
                    <button title={goalErr[s.id] || undefined} onClick={async () => {
                      const result = await upsertGoal(s.id, Number(draft.sourced) || 0, Number(draft.contacted) || 0, Number(draft.applied) || 0);
                      const status = result.error ? "error" : "saved";
                      setGoalSaved((prev) => ({ ...prev, [s.id]: status }));
                      setGoalErr((prev) => ({ ...prev, [s.id]: result.error ?? "" }));
                      if (!result.error) setTimeout(() => setGoalSaved((prev) => { const n = { ...prev }; delete n[s.id]; return n; }), 2500);
                    }} style={{ border: "none", background: goalSaved[s.id] === "saved" ? C.good : goalSaved[s.id] === "error" ? C.orange : C.navy, color: "#fff", fontWeight: 700, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, transition: "background .2s", minWidth: 90 }}>
                      {goalSaved[s.id] === "saved" ? "Saved ✓" : goalSaved[s.id] === "error" ? "Error ✕" : "Save goals"}
                    </button>
                    {goalSaved[s.id] === "error" && goalErr[s.id] && (
                      <span style={{ fontSize: 12, color: C.orange, maxWidth: 320 }}>{goalErr[s.id]}</span>
                    )}
                  </div>
                )}
              </div>
            );
          };

          return (
            <>
              <h1 style={{ fontSize: 30, color: C.navy, margin: "0 0 6px" }}>Schools & Goals</h1>
              <p style={{ color: C.grayMute, margin: "0 0 20px" }}>Pipeline stats and goals per school. Satellite and bonus schools are grouped.</p>
              {schoolsByTier.map(({ tier, schools: tierSchools }) => {
                const isGrouped = tier === "satellite" || tier === "bonus";
                const tierSchoolIds = tierSchools.map((s) => s.id);
                const groupRows = stageCounts.filter((r) => r.school_id && tierSchoolIds.includes(r.school_id));
                const groupSourced = countStages(groupRows, SOURCED);
                const groupApplied = countStages(groupRows, APPLIED);
                // All schools in a group share the same goal value — read from any one
                const repGoal = goals.find((g) => tierSchoolIds.includes(g.school_id));
                const groupGoalActual = { sourced: repGoal?.goal_sourced ?? 0, applied: repGoal?.goal_applied ?? 0 };
                const gDraft = isGrouped ? groupGoalDraft(tier, tierSchoolIds) : null;

                return (
                  <div key={tier} style={{ marginBottom: 28 }}>
                    <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 1, marginBottom: 10 }}>
                      {tier === "core" ? "Core Schools" : tier === "satellite" ? "Satellite School" : "Bonus School"}
                    </div>
                    {isGrouped && gDraft ? (
                      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.navy2}`, borderRadius: 14, padding: "18px 22px" }}>
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: C.gray, marginBottom: 6 }}>{tier === "satellite" ? "Satellite School" : "Bonus School"} ({tierSchools.length} schools)</div>
                          <div style={{ display: "flex", gap: 16 }}>
                            {([["Sourced", groupSourced, groupGoalActual.sourced], ["Applied", groupApplied, groupGoalActual.applied]] as [string, number, number][]).map(([lbl, act, goal]) => {
                              const hasGoal = goal > 0;
                              const pct = hasGoal ? Math.round((act / goal) * 100) : 0;
                              const tone = pct >= 100 ? C.good : pct >= 70 ? C.gold : C.orange;
                              return (
                                <span key={lbl} style={{ fontSize: 13, color: C.grayMute }}>
                                  {lbl}: <b style={{ color: hasGoal ? tone : C.navy2 }}>{nf(act)}</b>{hasGoal ? <span style={{ fontSize: 11, color: tone }}> ({pct}%)</span> : ""}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
                          <span style={{ fontSize: 12, color: C.grayMute, fontWeight: 600 }}>Goals:</span>
                          {(["sourced", "applied"] as const).map((field) => (
                            <label key={field} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <span style={{ fontSize: 12, color: C.grayMute, textTransform: "capitalize" }}>{field}</span>
                              <input type="number" min={0} value={gDraft[field]}
                                onChange={(e) => setGroupGoalField(tier, tierSchoolIds, field, e.target.value)}
                                style={{ width: 60, padding: "5px 8px", borderRadius: 7, border: `1px solid ${C.line}`, fontSize: 13, fontWeight: 700, color: C.navy, textAlign: "center" }} />
                            </label>
                          ))}
                          <button title={groupGoalErr[tier] || undefined} onClick={async () => {
                            const result = await upsertGroupGoal(tierSchoolIds, Number(gDraft.sourced) || 0, Number(gDraft.contacted) || 0, Number(gDraft.applied) || 0);
                            const status = result.error ? "error" : "saved";
                            setGroupGoalSaved((prev) => ({ ...prev, [tier]: status }));
                            setGroupGoalErr((prev) => ({ ...prev, [tier]: result.error ?? "" }));
                            if (!result.error) setTimeout(() => setGroupGoalSaved((prev) => { const n = { ...prev }; delete n[tier]; return n; }), 2500);
                          }} style={{ border: "none", background: groupGoalSaved[tier] === "saved" ? C.good : groupGoalSaved[tier] === "error" ? C.orange : C.navy, color: "#fff", fontWeight: 700, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, transition: "background .2s", minWidth: 90 }}>
                            {groupGoalSaved[tier] === "saved" ? "Saved ✓" : groupGoalSaved[tier] === "error" ? "Error ✕" : "Save goals"}
                          </button>
                          {groupGoalSaved[tier] === "error" && groupGoalErr[tier] && (
                            <span style={{ fontSize: 12, color: C.orange, maxWidth: 320 }}>{groupGoalErr[tier]}</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        {tierSchools.map((s) => renderSchoolCard(s))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          );
        })()}

        {/* ---- USERS ---- */}
        {tab === "users" && adminPlus && (() => {
          const roleRank: Record<string, number> = { super_admin: 0, admin: 1, team_lead: 2, fellow: 3 };
          const uq = usrSearch.trim().toLowerCase();
          const schoolNm = (id: string | null) => (id ? (schools.find((s) => s.id === id)?.name ?? "~") : "~");
          const filtered = users.filter((u) => {
            if (uq && !(`${u.full_name} ${u.email ?? ""}`.toLowerCase().includes(uq))) return false;
            if (usrRole !== "all" && u.role !== usrRole) return false;
            if (!matchesSchoolFilter(usrSchool, u.school_id, schools)) return false;
            if (usrStatus === "active" && !u.is_active) return false;
            if (usrStatus === "inactive" && u.is_active) return false;
            return true;
          });
          const udir = usrSort.dir === "asc" ? 1 : -1;
          const visibleUsers = [...filtered].sort((a, b) => {
            let av: number | string, bv: number | string;
            switch (usrSort.key) {
              case "email":  av = (a.email ?? "~").toLowerCase(); bv = (b.email ?? "~").toLowerCase(); break;
              case "role":   av = roleRank[a.role] ?? 9; bv = roleRank[b.role] ?? 9; break;
              case "school": av = schoolNm(a.school_id).toLowerCase(); bv = schoolNm(b.school_id).toLowerCase(); break;
              case "signin": av = a.last_sign_in_at ? Date.parse(a.last_sign_in_at) : -1; bv = b.last_sign_in_at ? Date.parse(b.last_sign_in_at) : -1; break;
              default:       av = a.full_name.toLowerCase(); bv = b.full_name.toLowerCase();
            }
            if (av < bv) return -1 * udir;
            if (av > bv) return 1 * udir;
            return 0;
          });
          const toggleUsr = (k: typeof usrSort.key) => setUsrSort((p) => p.key === k ? { key: k, dir: p.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" });
          const uarrow = (k: typeof usrSort.key) => usrSort.key === k ? (usrSort.dir === "asc" ? " ▲" : " ▼") : "";
          const UH = ({ k, label, center }: { k: typeof usrSort.key; label: string; center?: boolean }) => (
            <div onClick={() => toggleUsr(k)} style={{ cursor: "pointer", userSelect: "none", textAlign: center ? "center" : "left", color: usrSort.key === k ? C.navy : C.grayMute }}>{label}{uarrow(k)}</div>
          );
          const usrFiltersActive = !!uq || usrRole !== "all" || usrSchool !== "all" || usrStatus !== "all";
          const usrSel: React.CSSProperties = { padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, background: "#fff", color: C.gray, fontWeight: 600, textTransform: "capitalize" };
          return (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
              <div>
                <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>User Management</h1>
                <p style={{ color: C.grayMute, margin: "4px 0 0" }}>{visibleUsers.length} of {users.length} user{users.length !== 1 ? "s" : ""} · Role and school changes take effect immediately.</p>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setBulkInviteOpen(true)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 700, fontSize: 13.5, padding: "10px 18px", borderRadius: 10, cursor: "pointer" }}>Bulk invite</button>
                <button onClick={() => setInviteOpen(true)} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, fontSize: 13.5, padding: "10px 18px", borderRadius: 10, cursor: "pointer" }}>+ Invite User</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
              <input value={usrSearch} onChange={(e) => setUsrSearch(e.target.value)} placeholder="Search name or email…" style={{ flex: "1 1 200px", minWidth: 160, padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
              <select value={usrRole} onChange={(e) => setUsrRole(e.target.value)} style={usrSel}>
                <option value="all">All roles</option>
                {ALL_ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
              </select>
              <SchoolFilter schools={schools} value={usrSchool} onChange={setUsrSchool} />
              <select value={usrStatus} onChange={(e) => setUsrStatus(e.target.value as "all" | "active" | "inactive")} style={usrSel}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              {usrFiltersActive && <button onClick={() => { setUsrSearch(""); setUsrRole("all"); setUsrSchool("all"); setUsrStatus("all"); }} style={{ border: "none", background: "transparent", color: C.navy2, fontSize: 13, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Clear</button>}
            </div>
            {resendInviteMessage && (
              <div style={{ marginTop: 12, background: resendInviteMessage.kind === "success" ? "#E8F5EE" : "#FBE7DF", border: `1px solid ${resendInviteMessage.kind === "success" ? C.good : C.orange}`, borderRadius: 10, padding: "10px 13px", fontSize: 13, color: resendInviteMessage.kind === "success" ? "#1B5E3F" : "#8A3A1E" }}>
                {resendInviteMessage.kind === "success" ? "✓ " : ""}{resendInviteMessage.text}
              </div>
            )}
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.5fr 0.9fr 1.2fr 0.9fr 76px 190px", gap: 12, padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", background: "#FAFBFE" }}>
                <UH k="name" label="Name" /><UH k="email" label="Email" /><UH k="role" label="Role" /><UH k="school" label="School" /><UH k="signin" label="Last sign-in" center /><div></div><div></div>
              </div>
              {visibleUsers.map((u) => (
                <div key={u.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1.5fr 0.9fr 1.2fr 0.9fr 76px 190px", gap: 12, padding: "12px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", opacity: u.is_active ? 1 : 0.45 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input defaultValue={u.full_name}
                      onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== u.full_name) startTransition(() => { updateUserName(u.id, n); }); }}
                      style={{ fontWeight: 700, fontSize: 13.5, color: C.gray, border: "none", background: "transparent", outline: "none", borderBottom: `1px solid ${C.line}`, flex: 1, padding: "2px 0", minWidth: 0 }} />
                    {u.id === profile.id && <span style={{ fontSize: 11, color: C.navy2, background: `${C.navy2}22`, padding: "1px 6px", borderRadius: 99, flexShrink: 0 }}>you</span>}
                  </div>
                  <div style={{ fontSize: 13, color: C.grayMute, overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</div>
                  <select defaultValue={u.role}
                    onChange={(e) => startTransition(() => { updateUser(u.id, e.target.value, u.school_id); })}
                    disabled={u.id === profile.id}
                    style={{ width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", fontSize: 12.5, fontWeight: 600, color: C.navy, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 7px", background: "#fff" }}>
                    {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select value={schoolOptionValue(schools, u.school_id)}
                    onChange={(e) => startTransition(() => { updateUser(u.id, u.role, e.target.value || null); })}
                    style={{ width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", fontSize: 12.5, fontWeight: 600, color: u.school_id ? C.navy : C.grayMute, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 7px", background: "#fff" }}>
                    <option value="">— No school —</option>
                    {schoolSelectOptions(schools).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <div style={{ fontSize: 12, textAlign: "center", color: u.last_sign_in_at ? "#000" : C.grayMute }}>
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Never"}
                  </div>
                  {u.role === "fellow" || u.role === "team_lead"
                    ? <button onClick={() => setSnapshotUser(u)} title="View their Weekly Snapshot"
                        style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy2, fontWeight: 600, fontSize: 11.5, padding: "5px 8px", borderRadius: 7, cursor: "pointer" }}>Snapshot</button>
                    : <div />}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 9 }}>
                    {superUser && (!u.last_sign_in_at || u.role === "super_admin") && (
                      <button
                        onClick={() => handleResendInvite(u)}
                        disabled={resendingInviteId === u.id || !u.is_active}
                        title={!u.is_active ? "Reactivate this user before resending" : "Send a new account setup email"}
                        style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy2, fontWeight: 700, fontSize: 10.5, padding: "5px 7px", borderRadius: 7, cursor: resendingInviteId === u.id || !u.is_active ? "default" : "pointer", whiteSpace: "nowrap", opacity: resendingInviteId === u.id || !u.is_active ? 0.55 : 1 }}>
                        {resendingInviteId === u.id ? "Sending…" : "Resend invite"}
                      </button>
                    )}
                    <button
                      disabled={u.id === profile.id || updatingActiveId === u.id}
                      onClick={() => handleUserActiveChange(u)}
                      title={u.id === profile.id ? "Cannot deactivate yourself" : u.is_active ? "Deactivate while preserving assignments and history" : "Reactivate user"}
                      style={{ border: `1px solid ${u.is_active ? "#F0C8BE" : C.line}`, background: "#fff", color: u.id === profile.id ? C.grayMute : u.is_active ? "#A7432B" : C.good, fontWeight: 700, fontSize: 10.5, padding: "5px 7px", borderRadius: 7, cursor: u.id === profile.id || updatingActiveId === u.id ? "default" : "pointer", whiteSpace: "nowrap", opacity: u.id === profile.id || updatingActiveId === u.id ? 0.55 : 1 }}>
                      {updatingActiveId === u.id ? "Saving…" : u.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                </div>
              ))}
              {visibleUsers.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>{usrFiltersActive ? "No users match these filters." : "No users found."}</div>}
            </div>
          </>
          );
        })()}

        {/* ---- SYNC ---- */}
        {tab === "sync" && superUser && (
          <>
            <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>JazzHR Sync</h1>
            <p style={{ color: C.grayMute, maxWidth: 620 }}>Pull candidates from JazzHR. The API key lives server-side and is never exposed to the browser.</p>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 24, marginTop: 16, maxWidth: 620 }}>
              <h3 style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: C.navy }}>Step 1 — Check the connection</h3>
              <p style={{ fontSize: 13, color: C.grayMute, margin: "0 0 12px" }}>Lists the jobs in your JazzHR account. Read-only — writes nothing.</p>
              <button onClick={listJobs} disabled={listing} style={{ border: `1px solid ${C.navy}`, background: listing ? C.canvas : "#fff", color: C.navy, fontWeight: 700, padding: "11px 18px", borderRadius: 10, cursor: listing ? "default" : "pointer", fontSize: 14 }}>
                {listing ? "Loading jobs…" : "List JazzHR jobs"}
              </button>
              {jobs && (
                <div style={{ marginTop: 14, border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
                  {jobs.length === 0 ? <div style={{ padding: 16, fontSize: 13.5, color: C.grayMute }}>Connected, but no jobs returned.</div>
                    : jobs.map((j) => (
                      <div key={j.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${C.line}` }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13.5, color: C.gray }}>{j.title}</div>
                          <div style={{ fontSize: 12, color: C.grayMute }}>{j.city ?? "—"} · {j.status ?? "—"}</div>
                        </div>
                        <code style={{ fontSize: 12, color: C.navy2, background: C.canvas, padding: "3px 8px", borderRadius: 6 }}>{j.id}</code>
                      </div>
                    ))}
                </div>
              )}
            </div>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 24, marginTop: 16, maxWidth: 620 }}>
              <h3 style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 700, margin: "0 0 12px", color: C.navy }}>Step 2 — Pull candidates</h3>
              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={() => runSync("full")} disabled={syncing} style={{ border: "none", background: syncing ? C.navy3 : C.orange, color: "#fff", fontWeight: 700, padding: "12px 20px", borderRadius: 10, cursor: syncing ? "default" : "pointer", fontSize: 14 }}>
                  {syncing ? "Syncing… (paging through JazzHR)" : "Run full sync"}
                </button>
                <button onClick={() => runSync("refresh")} disabled={syncing} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 600, padding: "12px 20px", borderRadius: 10, cursor: syncing ? "default" : "pointer", fontSize: 14 }}>Refresh</button>
              </div>
              {syncResult && <div style={{ marginTop: 16, background: "#E8F5EE", border: `1px solid ${C.good}`, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, color: "#1B5E3F" }}>✓ {syncResult}</div>}
              {syncError && <div style={{ marginTop: 16, background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, color: "#8A3A1E", wordBreak: "break-word" }}>Sync error: {syncError}</div>}
            </div>

            <div style={{ background: "#fff", border: `1px solid ${reviews.length ? C.orange : C.line}`, borderRadius: 14, padding: 24, marginTop: 16, maxWidth: 820 }}>
              <h3 style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: C.navy }}>
                Match review {reviews.length > 0 && <span style={{ color: C.orange }}>· {reviews.length} pending</span>}
              </h3>
              <p style={{ fontSize: 13, color: C.grayMute, margin: "0 0 14px" }}>
                Applicants that look like an existing sourced candidate but couldn't be auto-linked (different email, nickname). <b>Match</b> links them (keeping notes & owner); <b>Add as new candidate</b> imports them separately.
              </p>
              {reviews.length > 0 ? (
                <button onClick={() => setSyncMatchOpen(true)} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, padding: "10px 18px", borderRadius: 10, cursor: "pointer", fontSize: 13.5 }}>
                  Review {reviews.length} match{reviews.length === 1 ? "" : "es"} →
                </button>
              ) : (
                <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>Nothing to review — all matches were confident.</div>
              )}
              <MatchReview reviews={reviews} candidates={candidates} schools={schools} open={syncMatchOpen} onClose={() => setSyncMatchOpen(false)} />
            </div>

            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 24, marginTop: 16, maxWidth: 620 }}>
              <h3 style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: C.navy }}>Step 3 — Fix unrouted candidates</h3>
              <p style={{ fontSize: 13, color: C.grayMute, margin: "0 0 12px" }}>
                Re-runs school routing on every candidate whose university is set but school is missing.
                Run this after updating the routing table or after improving questionnaire matching.
              </p>
              <button onClick={runReroute} disabled={rerouting}
                style={{ border: `1px solid ${C.navy}`, background: rerouting ? C.canvas : "#fff", color: C.navy, fontWeight: 700, padding: "11px 18px", borderRadius: 10, cursor: rerouting ? "default" : "pointer", fontSize: 14 }}>
                {rerouting ? "Re-routing…" : "Re-route unrouted candidates"}
              </button>
              {rerouteResult && <div style={{ marginTop: 14, background: "#E8F5EE", border: `1px solid ${C.good}`, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, color: "#1B5E3F" }}>✓ {rerouteResult}</div>}
            </div>

            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 24, marginTop: 16, maxWidth: 620 }}>
              <h3 style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: C.navy }}>Step 4 — Remove duplicates</h3>
              <p style={{ fontSize: 13, color: C.grayMute, margin: "0 0 12px" }}>
                Deduplicates candidates by email. Keeps JazzHR-sourced records and deletes extra copies.
              </p>
              <button
                onClick={async () => {
                  setDeduping(true); setDedupMsg(null);
                  const r = await deduplicateCandidates();
                  setDedupMsg("error" in r && r.error ? `Error: ${r.error}` : `Removed ${"removed" in r ? r.removed : 0} duplicate${("removed" in r ? r.removed : 0) !== 1 ? "s" : ""}.`);
                  setDeduping(false);
                }}
                disabled={deduping}
                style={{ border: `1px solid ${C.navy}`, background: deduping ? C.canvas : "#fff", color: C.navy, fontWeight: 700, padding: "11px 18px", borderRadius: 10, cursor: deduping ? "default" : "pointer", fontSize: 14 }}>
                {deduping ? "Removing duplicates…" : "Remove duplicates"}
              </button>
              {dedupMsg && <div style={{ marginTop: 14, background: dedupMsg.startsWith("Error") ? "#FBE7DF" : "#E8F5EE", border: `1px solid ${dedupMsg.startsWith("Error") ? C.orange : C.good}`, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, color: dedupMsg.startsWith("Error") ? "#8A3A1E" : "#1B5E3F" }}>{dedupMsg}</div>}
            </div>

            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 24, marginTop: 16, maxWidth: 620 }}>
              <h3 style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: C.navy }}>Step 5 — Sync résumé IDs</h3>
              <p style={{ fontSize: 13, color: C.grayMute, margin: "0 0 12px", lineHeight: 1.5 }}>
                Builds the JazzHR prospect ID bridge so résumés can be fetched and shown inline. Run once after setup,
                then re-run after a big candidate sync to pick up new applicants. Requires the JazzHR session ticket env var.
              </p>
              <button onClick={syncResumeIds} disabled={syncingIds}
                style={{ border: `1px solid ${C.navy}`, background: syncingIds ? C.canvas : "#fff", color: C.navy, fontWeight: 700, padding: "11px 18px", borderRadius: 10, cursor: syncingIds ? "default" : "pointer", fontSize: 14 }}>
                {syncingIds ? "Mapping prospects…" : "Sync résumé IDs"}
              </button>
              {syncIdsMsg && <div style={{ marginTop: 14, background: syncIdsMsg.startsWith("Error") ? "#FBE7DF" : "#E8F5EE", border: `1px solid ${syncIdsMsg.startsWith("Error") ? C.orange : C.good}`, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, color: syncIdsMsg.startsWith("Error") ? "#8A3A1E" : "#1B5E3F", wordBreak: "break-word" }}>{syncIdsMsg}</div>}
            </div>

            <div style={{ background: "#fff", border: `1px solid ${C.orange}`, borderRadius: 14, padding: 24, marginTop: 16, maxWidth: 620 }}>
              <h3 style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: C.orange }}>Danger zone — clear all candidates</h3>
              <p style={{ fontSize: 13, color: C.grayMute, margin: "0 0 12px", lineHeight: 1.5 }}>Deletes every candidate and their notes, favorites, and AI rows. Schools, users, playbook, and goals are kept. Type <b style={{ color: C.gray }}>{CONFIRM}</b> to confirm.</p>
              <div style={{ display: "flex", gap: 10 }}>
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={CONFIRM} style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, fontFamily: "monospace" }} />
                <button onClick={clearData} disabled={clearing || confirmText !== CONFIRM} style={{ border: "none", background: confirmText === CONFIRM && !clearing ? C.orange : "#E4B5A6", color: "#fff", fontWeight: 700, padding: "11px 18px", borderRadius: 10, cursor: confirmText === CONFIRM && !clearing ? "pointer" : "not-allowed", fontSize: 14, whiteSpace: "nowrap" }}>
                  {clearing ? "Clearing…" : "Clear data"}
                </button>
              </div>
              {clearMsg && <div style={{ marginTop: 14, background: clearMsg.startsWith("Error") ? "#FBE7DF" : "#E8F5EE", border: `1px solid ${clearMsg.startsWith("Error") ? C.orange : C.good}`, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, color: clearMsg.startsWith("Error") ? "#8A3A1E" : "#1B5E3F" }}>{clearMsg}</div>}
            </div>
          </>
        )}

        {tab === "resources" && (
          <ResourcesPanel resources={resources} canManage={canManageResources(profile.role)} />
        )}

        {/* ---- REVIEW SYNC (admin "Review Sync" route) ---- */}
        {tab === "review" && (
          <>
            <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Review Sync</h1>
            <p style={{ color: C.grayMute, margin: "4px 0 18px" }}>JazzHR applicants that may match an existing sourced candidate. Match to link them, or add as a new candidate.</p>
            {reviews.length > 0 ? (
              <button onClick={() => setReviewSyncOpen(true)} style={{ border: "none", background: C.orange, color: "#fff", fontWeight: 700, padding: "12px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14 }}>
                Review {reviews.length} possible match{reviews.length === 1 ? "" : "es"} →
              </button>
            ) : (
              <div style={{ fontSize: 13.5, color: C.grayMute, fontStyle: "italic" }}>Nothing to review — all matches were confident.</div>
            )}
            <MatchReview reviews={reviews} candidates={candidates} schools={schools} open={reviewSyncOpen} onClose={() => setReviewSyncOpen(false)} />
          </>
        )}
      </div>

      {open && (
        <CandidateDrawer c={open} profile={profile} team={team} schools={schools} onClose={() => { setOpenId(null); if (tab === "applicants") loadAppPage(appPage); }} onSaved={() => loadAppPage(appPage)} startTransition={startTransition} superUser={superUser} />
      )}
      {addOpen && (
        <AddCandidateModal schools={schools} team={team} meId={profile.id} existingEmails={new Set(candidateFacets.slim.map((c) => c.email?.toLowerCase() ?? "").filter(Boolean))} existingNames={new Set(candidateFacets.slim.filter((c) => c.name?.trim()).map((c) => nameSchoolKey(c.name, c.school_id)))} onClose={() => { setAddOpen(false); loadAppPage(0); }} startTransition={startTransition} />
      )}
      {bulkOpen && (
        <BulkImportModal schools={schools} team={team} canAssignPointPerson existingEmails={new Set(candidateFacets.slim.map((c) => c.email?.toLowerCase() ?? "").filter(Boolean))} existingNames={new Set(candidateFacets.slim.filter((c) => c.name?.trim()).map((c) => nameSchoolKey(c.name, c.school_id)))} onClose={() => { setBulkOpen(false); loadAppPage(0); }} />
      )}
      {infoOpen && (
        <ImportInfoModal onClose={() => { setInfoOpen(false); loadAppPage(appPage); }} />
      )}
      {bulkDelOpen && (
        <BulkDeleteCandidatesModal schools={schools.map((s) => ({ id: s.id, name: s.name }))} onClose={() => { setBulkDelOpen(false); loadAppPage(appPage); }} />
      )}
      {inviteOpen && (
        <InviteUserModal schools={schools} onClose={() => setInviteOpen(false)} startTransition={startTransition} />
      )}
      {bulkInviteOpen && (
        <BulkInviteModal schools={schools} onClose={() => setBulkInviteOpen(false)} />
      )}
      {snapshotUser && (
        <UserSnapshotModal user={snapshotUser} onClose={() => setSnapshotUser(null)} />
      )}
    </>
  );
}

// ---- User Weekly Snapshot (read-only, for User Management) ----
function UserSnapshotModal({ user, onClose }: { user: UserProfile; onClose: () => void }) {
  const [data, setData] = useState<{ name: string; isAdmin: boolean; queue: { name: string; email: string | null; why: string }[]; tasksDone: number; tasksTotal: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  useEffect(() => {
    let active = true;
    getUserSnapshot(user.id).then((r) => { if (!active) return; if ("ok" in r && r.ok) setData(r as any); else setError(("error" in r ? r.error : null) ?? "Could not load snapshot."); });
    return () => { active = false; };
  }, [user.id]);
  const taskPct = data && data.tasksTotal > 0 ? Math.round((data.tasksDone / data.tasksTotal) * 100) : 0;
  const shownQueue = data?.queue.slice(page * pageSize, (page + 1) * pageSize) ?? [];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 26, width: 480, maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <h2 style={{ fontFamily: HEAD, fontSize: 20, color: C.navy, margin: 0 }}>{user.full_name}'s Weekly Snapshot</h2>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, color: C.grayMute, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: C.grayMute, textTransform: "capitalize", marginBottom: 16 }}>{user.role.replace("_", " ")}</div>
        {error && <div style={{ fontSize: 13, color: C.orange }}>{error}</div>}
        {!error && !data && <div style={{ fontSize: 13, color: C.grayMute }}>Loading…</div>}
        {data && data.isAdmin && <div style={{ fontSize: 13.5, color: C.grayMute, fontStyle: "italic" }}>Admins don't have a Weekly Snapshot.</div>}
        {data && !data.isAdmin && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, background: C.canvas, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute }}>Action queue</div>
                <div style={{ fontFamily: HEAD, fontSize: 24, fontWeight: 700, color: C.navy }}>{data.queue.length}</div>
              </div>
              <div style={{ flex: 1, background: C.canvas, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute }}>Tasks done</div>
                <div style={{ fontFamily: HEAD, fontSize: 24, fontWeight: 700, color: C.navy }}>{data.tasksDone}/{data.tasksTotal} <span style={{ fontSize: 13, color: C.grayMute }}>· {taskPct}%</span></div>
              </div>
            </div>
            <div style={{ fontFamily: HEAD, fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, marginBottom: 8 }}>Needs their attention</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <PaginationControls page={page} pageSize={pageSize} total={data.queue.length} onPageChange={setPage} onPageSizeChange={(size) => { setPage(0); setPageSize(size); }} />
              {shownQueue.map((q, i) => (
                <div key={i} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 12px" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: C.gray }}><ContactPopover name={q.name} email={q.email} /></div>
                  <div style={{ fontSize: 12, color: C.grayMute }}>{q.why}</div>
                </div>
              ))}
              {data.queue.length === 0 && <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>All clear — nothing queued.</div>}
              <PaginationControls page={page} pageSize={pageSize} total={data.queue.length} onPageChange={setPage} onPageSizeChange={(size) => { setPage(0); setPageSize(size); }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type Connection = { id: string; fellow_id: string; name: string; relationship: string };
const REL_QUICK = ["Knows personally", "Went to school together", "Worked together", "Alumni connection", "Mutual friend"];

// ---- Candidate Drawer ----
function CandidateDrawer({ c, profile, team, schools, onClose, onSaved, startTransition, superUser }: {
  c: Cand; profile: Profile; team: TeamMember[]; schools: School[];
  onClose: () => void; onSaved?: () => void; startTransition: (cb: () => void) => void;
  superUser: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<{ id: string; body: string; created_at: string }[] | null>(null);
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [relDraft, setRelDraft] = useState("");
  const [resumeOpen, setResumeOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState("");
  const QUICK = ["Called — left voicemail", "Emailed", "Met in person", "Scheduled follow-up"];
  const schoolDisplay = candidateSchoolDisplay(c, schools);

  // ---- Edit details ----
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const blankEdit = {
    name: c.name, email: c.email ?? "", school_id: schoolOptionValue(schools, c.school_id),
    university_raw: c.university_raw ?? "", gpa: c.gpa ?? "", grad_date: c.grad_date ?? "",
    area_of_study: c.area_of_study ?? "", linkedin: c.linkedin ?? "",
  };
  const [edit, setEdit] = useState(blankEdit);
  const startEdit = () => { setEdit(blankEdit); setEditing(true); };
  const setEf = (k: keyof typeof blankEdit, v: string) => setEdit((p) => ({ ...p, [k]: v }));
  const saveEdit = () => {
    if (!edit.name.trim()) return;
    setSaving(true);
    startTransition(() => {
      updateCandidate(c.id, {
        name: edit.name, email: edit.email, school_id: edit.school_id || null,
        university_raw: edit.university_raw, gpa: edit.gpa, grad_date: edit.grad_date,
        area_of_study: edit.area_of_study, linkedin: edit.linkedin,
      }).then((r: any) => {
        setSaving(false);
        if (r?.error) alert(r.error);
        else { setEditing(false); if (onSaved) onSaved(); else router.refresh(); }
      });
    });
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      getOutreach(c.id),
      getConnections(c.id),
    ]).then(([outreach, connections]) => {
      if (!active) return;
      setLog((("log" in outreach ? outreach.log : []) as any) ?? []);
      setConns(("connections" in connections ? connections.connections : []) as Connection[]);
    });
    return () => { active = false; };
  }, [c.id]);

  const doAddConn = (rel: string) => {
    if (!rel.trim()) return;
    startTransition(() => {
      addConnection(c.id, rel.trim());
      setConns((prev) => [{ id: Math.random().toString(), fellow_id: profile.id, name: "You", relationship: rel.trim() }, ...(prev ?? [])]);
      setRelDraft("");
    });
  };

  const doDelConn = (id: string) => {
    startTransition(() => {
      deleteConnection(id);
      setConns((prev) => (prev ?? []).filter((cn) => cn.id !== id));
    });
  };

  const doLog = (body: string) => startTransition(() => {
    logOutreach(c.id, body);
    setLog((prev) => [{ id: Math.random().toString(), body, created_at: new Date().toISOString() }, ...(prev ?? [])]);
  });

  const doDelLog = (id: string) => {
    startTransition(() => {
      deleteOutreach(id);
      setLog((prev) => (prev ?? []).filter((n) => n.id !== id));
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", width: 440, maxWidth: "93vw", background: C.canvas, height: "100%", overflowY: "auto" }}>
        <div style={{ background: C.navy, color: "#fff", padding: "24px 24px 20px", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,.14)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 16 }}>×</button>
          {!editing && c.created_by === profile.id && (
            <button onClick={startEdit} title="Edit candidate details" style={{ position: "absolute", top: 14, right: 54, background: C.orange, border: "none", color: "#fff", height: 32, padding: "0 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700, boxShadow: "0 2px 8px rgba(221,84,52,.4)" }}>✎ Edit details</button>
          )}
          <h2 style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 24, margin: "0 0 2px", paddingRight: 96 }}><ContactPopover name={c.name} email={c.email} /></h2>
          <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.72)" }}>{c.area_of_study}</div>
          <div style={{ marginTop: 12 }}><StagePill stage={c.stage} /></div>
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <button onClick={() => startTransition(() => { toggleFavorite(c.id, !c.is_favorite); })}
              style={{ flex: 1, border: `1px solid ${c.is_favorite ? C.gold : C.line}`, background: c.is_favorite ? "#FBF3D6" : "#fff", color: c.is_favorite ? "#8A6D0E" : C.gray, fontWeight: 700, padding: 10, borderRadius: 9, cursor: "pointer", fontSize: 13 }}>
              {c.is_favorite ? "★ Favorited" : "☆ Favorite"}
            </button>
            <button onClick={() => startTransition(() => { setNotInterested(c.id, !c.not_interested); })}
              style={{ flex: 1, border: `1px solid ${C.line}`, background: c.not_interested ? "#EFEFF2" : "#fff", color: C.gray, fontWeight: 700, padding: 10, borderRadius: 9, cursor: "pointer", fontSize: 13 }}>
              {c.not_interested ? "Unflag" : "Flag not interested"}
            </button>
          </div>

          {editing ? (
            <EditCandidateForm edit={edit} setEf={setEf} schools={schools} saving={saving} onSave={saveEdit} onCancel={() => setEditing(false)} />
          ) : (
            ([["Email", c.email], ["GPA", c.gpa], ["Grad Date", c.grad_date], ["School", schoolDisplay.label], ["University", schoolDisplay.isGrouped ? null : c.university_raw], ["Added by", c.created_by ? (team.find((t) => t.id === c.created_by)?.full_name ?? "Team member") : (c.source === "jazzhr" ? "JazzHR sync" : "—")]] as [string, string | null][]).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
                <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>{k}</span>
                <span style={{ fontSize: 13, color: C.gray, fontWeight: 600 }}>{v ?? "—"}</span>
              </div>
            ))
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>Point person</span>
            <div style={{ minWidth: 180 }}>
              <PersonPicker value={c.point_person_id} options={team} meId={profile.id}
                onChange={(v) => startTransition(() => { reassignPointPerson(c.id, v); })} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, margin: "16px 0 20px" }}>
            <a href={c.linkedin ?? "#"} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, textAlign: "center", textDecoration: "none", border: `1px solid ${C.line}`, background: "#fff", color: c.linkedin ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, pointerEvents: c.linkedin ? "auto" : "none" }}>
              LinkedIn ↗
            </a>
            <button
              onClick={() => { if (c.jazz_id) setResumeOpen(true); }}
              disabled={!c.jazz_id}
              style={{ flex: 1, textAlign: "center", border: `1px solid ${C.line}`, background: "#fff", color: c.jazz_id ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, cursor: c.jazz_id ? "pointer" : "not-allowed" }}>
              Résumé
            </button>
          </div>

          {superUser && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}`, marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>
                JazzHR {c.jazz_id ? <span style={{ color: C.good }}>· linked</span> : <span style={{ color: C.grayMute }}>· not linked</span>}
              </span>
              {c.jazz_id && (
                <button onClick={() => { if (confirm("Unlink this candidate from JazzHR? Their stage will stop auto-updating until re-linked.")) startTransition(() => { unlinkJazzCandidate(c.id); }); }}
                  style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.orange, fontWeight: 700, fontSize: 12, padding: "5px 10px", borderRadius: 7, cursor: "pointer" }}>Unlink</button>
              )}
            </div>
          )}


          {/* Warm intro finder */}
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
            <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, marginBottom: 10, letterSpacing: 0.8 }}>Warm Intros</div>
            {conns === null ? (
              <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>Loading…</div>
            ) : conns.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {conns.map((cn) => (
                  <div key={cn.id} style={{ fontSize: 13, color: C.gray, display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 16 }}>●</span>
                    <span style={{ flex: 1 }}><b>{cn.name}</b> — <span style={{ color: C.grayMute }}>{cn.relationship}</span></span>
                    <button onClick={() => doDelConn(cn.id)} title="Remove" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }}>×</button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic", marginBottom: 10 }}>No connections logged yet.</div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {REL_QUICK.map((r) => (
                <button key={r} onClick={() => doAddConn(r)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 600, fontSize: 11.5, padding: "4px 10px", borderRadius: 999, cursor: "pointer" }}>+ {r}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <input value={relDraft} onChange={(e) => setRelDraft(e.target.value)} placeholder="Custom relationship…"
                style={{ flex: 1, padding: "8px 11px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 13 }} />
              <button onClick={() => doAddConn(relDraft)} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 600, padding: "0 13px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Add</button>
            </div>
          </div>

          <div style={{ fontFamily: HEAD, fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, marginBottom: 10 }}>Outreach log</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {QUICK.map((q) => (
              <button key={q} onClick={() => doLog(q)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 600, fontSize: 12, padding: "6px 11px", borderRadius: 999, cursor: "pointer" }}>+ {q}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a note…" style={{ flex: 1, padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
            <button onClick={() => { if (draft.trim()) { doLog(draft.trim()); setDraft(""); } }} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 600, padding: "0 16px", borderRadius: 9, cursor: "pointer" }}>Log</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(log ?? []).map((n) => (
              <div key={n.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 13px", fontSize: 13, color: C.gray, display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ flex: 1 }}>{n.body}</span>
                <button onClick={() => doDelLog(n.id)} title="Remove" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 15, lineHeight: 1, flexShrink: 0, padding: "0 2px" }}>×</button>
              </div>
            ))}
            {(log ?? []).length === 0 && <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>No outreach logged yet.</div>}
          </div>

          {/* Danger zone — delete candidate (type the name to confirm) */}
          <div style={{ marginTop: 24, borderTop: `1px solid ${C.line}`, paddingTop: 16 }}>
            {!delOpen ? (
              <button onClick={() => setDelOpen(true)} style={{ border: `1px solid ${C.orange}`, background: "#fff", color: C.orange, fontWeight: 700, fontSize: 13, padding: "8px 14px", borderRadius: 9, cursor: "pointer" }}>Delete candidate</button>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: C.gray, marginBottom: 8 }}>This permanently deletes <b>{c.name}</b> and their outreach &amp; warm intros. Type the candidate&apos;s name to confirm:</div>
                <input value={delText} onChange={(e) => setDelText(e.target.value)} placeholder={c.name}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box", marginBottom: 8 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setDelOpen(false); setDelText(""); }} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "8px 14px", borderRadius: 9, cursor: "pointer" }}>Cancel</button>
                  <button disabled={delText.trim() !== c.name.trim()}
                    onClick={() => startTransition(() => { deleteCandidate(c.id).then((r: any) => { if (r?.error) alert(r.error); else { onClose(); router.refresh(); } }); })}
                    style={{ border: "none", background: delText.trim() === c.name.trim() ? C.orange : "#E6A892", color: "#fff", fontWeight: 700, padding: "8px 16px", borderRadius: 9, cursor: delText.trim() === c.name.trim() ? "pointer" : "not-allowed" }}>Delete permanently</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {resumeOpen && c.jazz_id && (
        <ResumeModal jazzId={c.jazz_id} name={c.name} onClose={() => setResumeOpen(false)} />
      )}
    </div>
  );
}

// ---- Edit Candidate form (inline in the drawer) ----
type EditFields = { name: string; email: string; school_id: string; university_raw: string; gpa: string; grad_date: string; area_of_study: string; linkedin: string };
function EditCandidateForm({ edit, setEf, schools, saving, onSave, onCancel }: {
  edit: EditFields;
  setEf: (k: keyof EditFields, v: string) => void;
  schools: School[]; saving: boolean; onSave: () => void; onCancel: () => void;
}) {
  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, boxSizing: "border-box" };
  const field = (label: string, k: keyof EditFields, placeholder?: string) => (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      <input value={edit[k]} onChange={(e) => setEf(k, e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: 16, margin: "4px 0 20px" }}>
      <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, marginBottom: 12, letterSpacing: 0.8 }}>Edit details</div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Name *</label>
        <input value={edit.name} onChange={(e) => setEf("name", e.target.value)} style={{ ...inputStyle, borderColor: edit.name.trim() ? C.line : C.orange }} />
      </div>
      {field("Email", "email", "email@example.com")}
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>School</label>
        <SearchableSelect options={schoolSelectOptions(schools)} value={edit.school_id} onChange={(v) => setEf("school_id", v)} placeholder="Search schools…" />
      </div>
      {field("University", "university_raw", "e.g. University of Kentucky")}
      {field("GPA", "gpa")}
      {field("Grad date", "grad_date")}
      {field("Area of study", "area_of_study")}
      {field("LinkedIn", "linkedin", "https://linkedin.com/in/…")}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <button onClick={onCancel} disabled={saving} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "9px 16px", borderRadius: 9, cursor: saving ? "default" : "pointer" }}>Cancel</button>
        <button onClick={onSave} disabled={saving || !edit.name.trim()} style={{ border: "none", background: edit.name.trim() ? C.navy : "#9AA0B5", color: "#fff", fontWeight: 700, padding: "9px 18px", borderRadius: 9, cursor: saving || !edit.name.trim() ? "default" : "pointer" }}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

// ---- Searchable dropdown (single-select with a filter box) ----
function SearchableSelect({ options, value, onChange, placeholder }: {
  options: { value: string; label: string }[];
  value: string; onChange: (value: string) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const filtered = q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input value={open ? q : (selected?.label ?? "")} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { setQ(""); setOpen(true); }} placeholder={placeholder}
        style={{ width: "100%", padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box", cursor: "pointer" }} />
      {open && (
        <div style={{ position: "absolute", zIndex: 5, top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(17,18,62,.12)", maxHeight: 240, overflowY: "auto" }}>
          {filtered.length === 0 && <div style={{ padding: "10px 13px", fontSize: 13, color: C.grayMute }}>No matches</div>}
          {filtered.map((o) => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}
              style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: `1px solid ${C.line}`, background: o.value === value ? C.canvas : "#fff", padding: "10px 13px", fontSize: 14, color: C.gray, cursor: "pointer" }}>{o.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Add Candidate Modal ----
function AddCandidateModal({ schools, team, meId, existingEmails, existingNames, onClose, startTransition }: {
  schools: School[]; team: TeamMember[]; meId: string; existingEmails: Set<string>; existingNames: Set<string>;
  onClose: () => void; startTransition: (cb: () => void) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [schoolValue, setSchoolValue] = useState("");
  const [specificSchool, setSpecificSchool] = useState("");
  const [pointPerson, setPointPerson] = useState<string | null>(null);
  const [linkedin, setLinkedin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);

  const options = schoolSelectOptions(schools);
  const selectedSchool = schools.find((s) => s.id === schoolValue) ?? null;
  const isGroup = selectedSchool?.tier === "satellite" || selectedSchool?.tier === "bonus";

  const dupeEmail = !!email.trim() && existingEmails.has(email.trim().toLowerCase());
  const dupeName = !!name.trim() && existingNames.has(nameSchoolKey(name, schoolValue || null));
  // Preview the email-domain auto-routing the server applies when no school is set.
  const emailRoutedSchool = routeToSchoolNameByEmail(email.trim() || null);

  const submit = () => {
    if (!name.trim()) { setError("Name is required."); return; }
    setError(null);
    // Satellite/Bonus pick the tier group; the specific school they typed is kept
    // in university_raw (shown on the Candidates page) while the candidate counts
    // toward that group everywhere else.
    const university_raw = isGroup ? (specificSchool.trim() || null) : null;
    startTransition(() => {
      addCandidate({
        name: name.trim(),
        email: email.trim() || null,
        school_id: schoolValue || null,
        university_raw,
        point_person_id: pointPerson,
        linkedin: linkedin.trim() || null,
        // Stage / GPA / major are filled in later from JazzHR — not part of sourcing.
        stage: null, gpa: null, area_of_study: null,
      }).then((r) => {
        if ("error" in r && r.error) setError(r.error);
        else { setSaved(true); setNeedsReview("needsReview" in r && !!r.needsReview); setTimeout(onClose, ("needsReview" in r && r.needsReview) ? 1600 : 800); }
      });
    });
  };

  const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 28, width: 440, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ fontFamily: HEAD, fontSize: 22, color: C.navy, margin: "0 0 20px" }}>Add Candidate</h2>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, borderColor: dupeName ? C.orange : C.line }} />
          {dupeName && <div style={{ fontSize: 12, color: C.orange, marginTop: 4 }}>⚠ A candidate with this name already exists — a duplicate will be created if you continue.</div>}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" style={{ ...inputStyle, borderColor: dupeEmail ? C.orange : C.line }} />
          {dupeEmail && <div style={{ fontSize: 12, color: C.orange, marginTop: 4 }}>⚠ A candidate with this email already exists — a duplicate will be created if you continue.</div>}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>School</label>
          <SearchableSelect options={options} value={schoolValue} onChange={(v) => { setSchoolValue(v); setSpecificSchool(""); }} placeholder="Search schools…" />
          {isGroup && (
            <input value={specificSchool} onChange={(e) => setSpecificSchool(e.target.value)} placeholder="Which school? (e.g. University of Kentucky)"
              style={{ ...inputStyle, marginTop: 8 }} />
          )}
          {!schoolValue && emailRoutedSchool && (
            <div style={{ fontSize: 12, color: C.navy2, marginTop: 6 }}>↪ No school picked — they&apos;ll be routed to <b>{emailRoutedSchool}</b> from their email.</div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>Point person</label>
          <PersonPicker value={pointPerson} options={team} meId={meId} placeholder="Search team…" onChange={(v) => setPointPerson(v)} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>LinkedIn URL</label>
          <input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" style={inputStyle} />
        </div>

        <div style={{ background: "#EEF1F7", borderRadius: 9, padding: "9px 12px", marginBottom: 14, fontSize: 12, color: C.grayMute }}>
          Stage, GPA, and major are added automatically once the candidate applies through JazzHR.
        </div>
        {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#8A3A1E", marginBottom: 14 }}>{error}</div>}
        {saved && <div style={{ background: "#E8F5EE", border: `1px solid ${C.good}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#1B5E3F", marginBottom: 14 }}>✓ Candidate added!{needsReview ? " The typed school couldn't be matched — it's queued in School Match Review." : ""}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "11px 18px", borderRadius: 10, cursor: "pointer" }}>Cancel</button>
          <button onClick={submit} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, padding: "11px 20px", borderRadius: 10, cursor: "pointer" }}>Add Candidate</button>
        </div>
      </div>
    </div>
  );
}

// ---- Bulk Import Modal ----
function parseCSVRows(text: string): string[][] {
  return text.trim().split("\n").filter((l) => l.trim()).map((line) =>
    line.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim())
  );
}


// ---- Invite User Modal ----
const INVITE_EMPTY = { email: "", full_name: "", role: "fellow", school_id: "" };
function InviteUserModal({ schools, onClose, startTransition }: {
  schools: School[];
  onClose: () => void; startTransition: (cb: () => void) => void;
}) {
  const [form, setForm] = useState(INVITE_EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof INVITE_EMPTY, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const submit = () => {
    if (!form.email.trim() || !form.full_name.trim()) { setError("Email and name are required."); return; }
    setError(null);
    startTransition(() => {
      inviteUser(form.email.trim(), form.full_name.trim(), form.role, form.school_id || null).then((r) => {
        if ("error" in r && r.error) setError(r.error);
        else { setSent(true); setTimeout(onClose, 1500); }
      });
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 28, width: 440, maxWidth: "95vw" }}>
        <h2 style={{ fontFamily: HEAD, fontSize: 22, color: C.navy, margin: "0 0 20px" }}>Invite User</h2>
        <p style={{ fontSize: 13, color: C.grayMute, margin: "-12px 0 20px" }}>An invite email will be sent. They set their own password on first login.</p>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>Full name *</label>
          <input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Jane Smith"
            style={{ width: "100%", padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>Email *</label>
          <input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="jane@example.com" type="email"
            style={{ width: "100%", padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>Role</label>
          <select value={form.role} onChange={(e) => set("role", e.target.value)}
            style={{ width: "100%", padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff" }}>
            {(["super_admin", "admin", "team_lead", "fellow"] as const).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>School</label>
          <select value={form.school_id} onChange={(e) => set("school_id", e.target.value)}
            style={{ width: "100%", padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff" }}>
            <option value="">— No school —</option>
            {schoolSelectOptions(schools).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#8A3A1E", marginBottom: 14 }}>{error}</div>}
        {sent && <div style={{ background: "#E8F5EE", border: `1px solid ${C.good}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#1B5E3F", marginBottom: 14 }}>✓ Invite sent!</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "11px 18px", borderRadius: 10, cursor: "pointer" }}>Cancel</button>
          <button onClick={submit} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, padding: "11px 20px", borderRadius: 10, cursor: "pointer" }}>Send invite</button>
        </div>
      </div>
    </div>
  );
}

// ---- Bulk Invite Modal ----
function BulkInviteModal({ schools, onClose }: { schools: School[]; onClose: () => void }) {
  const [text, setText] = useState("");
  const [defaultRole, setDefaultRole] = useState<string>("fellow");
  const [defaultSchool, setDefaultSchool] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ invited: number; failures: { email: string; error: string }[] } | null>(null);

  const schoolByName = new Map(schools.map((s) => [s.name.toLowerCase(), s.id]));
  const validRoles = new Set(ALL_ROLES as readonly string[]);

  const parsed = (() => {
    if (!text.trim()) return [];
    const rows = parseCSVRows(text);
    const header = rows[0]?.map((h) => h.toLowerCase()) ?? [];
    const hasHeader = header.includes("email") || header.includes("name");
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const iEmail = hasHeader ? header.indexOf("email") : 0;
    const iName = hasHeader ? header.indexOf("name") : 1;
    const iRole = hasHeader ? header.indexOf("role") : 2;
    const iSchool = hasHeader ? header.indexOf("school") : 3;
    return dataRows.map((r) => {
      const email = (r[iEmail] ?? "").trim();
      const full_name = (iName >= 0 ? r[iName] ?? "" : "").trim() || email.split("@")[0];
      const roleRaw = (iRole >= 0 ? r[iRole] ?? "" : "").trim().toLowerCase();
      const role = validRoles.has(roleRaw) ? roleRaw : defaultRole;
      const schoolRaw = (iSchool >= 0 ? r[iSchool] ?? "" : "").trim();
      const school_id = schoolRaw ? (schoolByName.get(schoolRaw.toLowerCase()) ?? null) : (defaultSchool || null);
      return { email, full_name, role, school_id };
    }).filter((r) => r.email.includes("@"));
  })();

  const submit = async () => {
    if (parsed.length === 0) { setError("No valid rows — each needs at least an email."); return; }
    setError(null); setBusy(true);
    const r = await bulkInviteUsers(parsed);
    setBusy(false);
    if ("error" in r && r.error) setError(r.error);
    else if ("invited" in r) setResult({ invited: r.invited ?? 0, failures: r.failures ?? [] });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 28, width: 560, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ fontFamily: HEAD, fontSize: 22, color: C.navy, margin: "0 0 8px" }}>Bulk Invite Users</h2>
        <p style={{ fontSize: 13, color: C.grayMute, margin: "0 0 16px" }}>
          Paste one per line as <code style={{ background: C.canvas, padding: "1px 5px", borderRadius: 4 }}>Email, Name, Role, School</code>. Header row is auto-detected. Role and School are optional — missing values use the defaults below. Each person gets an invite email and sets their own password.
        </p>
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>Default role</label>
            <select value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}
              style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff" }}>
              {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>Default school</label>
            <select value={defaultSchool} onChange={(e) => setDefaultSchool(e.target.value)}
              style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff" }}>
              <option value="">— No school —</option>
              {schoolSelectOptions(schools).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setResult(null); setError(null); }}
          placeholder={"Email,Name,Role,School\njane@example.com,Jane Smith,fellow,Purdue\njohn@example.com,John Doe"}
          rows={8} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 13, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
        {text.trim() && (
          <div style={{ margin: "12px 0", padding: "10px 14px", background: C.canvas, borderRadius: 9, fontSize: 13 }}>
            <b style={{ color: C.navy }}>{parsed.length}</b> valid row{parsed.length !== 1 ? "s" : ""} ready to invite
          </div>
        )}
        {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#8A3A1E", marginBottom: 14 }}>{error}</div>}
        {result && (
          <div style={{ background: "#E8F5EE", border: `1px solid ${C.good}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#1B5E3F", marginBottom: 14 }}>
            ✓ Invited {result.invited} user{result.invited !== 1 ? "s" : ""}.
            {result.failures.length > 0 && (
              <div style={{ marginTop: 8, color: "#8A3A1E" }}>
                {result.failures.length} failed:
                {result.failures.map((f) => <div key={f.email} style={{ fontSize: 12 }}>· {f.email}: {f.error}</div>)}
              </div>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "11px 18px", borderRadius: 10, cursor: "pointer" }}>{result ? "Done" : "Cancel"}</button>
          <button onClick={submit} disabled={busy || parsed.length === 0} style={{ border: "none", background: busy || parsed.length === 0 ? C.navy3 : C.navy, color: "#fff", fontWeight: 700, padding: "11px 20px", borderRadius: 10, cursor: busy || parsed.length === 0 ? "default" : "pointer" }}>
            {busy ? "Inviting…" : `Invite ${parsed.length || ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
