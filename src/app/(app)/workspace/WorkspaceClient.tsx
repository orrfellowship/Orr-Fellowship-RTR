"use client";

import { useState, useMemo, useTransition, useEffect, useRef } from "react";
import type { Profile, Resource } from "@/lib/types";
import { canReassign, canEditPlaybook, canManageResources, canEditEvents } from "@/lib/types";
import {
  toggleFavorite, setNotInterested, logOutreach, reassignPointPerson,
  getOutreach, addConnection, getConnections, upsertTask, deleteTask, addPhase,
  deleteOutreach, deleteConnection, updatePhase, deletePhase,
  requestTaskComplete, confirmTaskComplete, setTaskAssignees,
} from "./actions";
import { listCandidates } from "@/app/(app)/console/actions";
import { phaseOf } from "@/lib/stages";
import { evaluateCandidate } from "@/lib/triggers";
import StandingsClient from "@/components/StandingsClient";
import ResumeModal from "@/components/ResumeModal";
import BulkImportModal from "@/components/BulkImportModal";
import ResourcesPanel from "@/components/ResourcesPanel";
import PersonPicker from "@/components/PersonPicker";
import RecruitingCalendar, { type CalEvent } from "@/components/RecruitingCalendar";
import BudgetPanel, { type BudgetEntry, type Guidance } from "@/components/BudgetPanel";
import SchoolFilter, { matchesSchoolFilter } from "@/components/SchoolFilter";
import { useIsMobile } from "@/lib/useIsMobile";

const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD",
  orange: "#DD5434", orangeSoft: "#FBE7DF", blue: "#8AB9E2", blueSoft: "#E1E9F4",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", gold: "#C9A227", good: "#2F8F6B",
};
const HEAD = "'Cabin', sans-serif";

type Cand = {
  id: string; jazz_id: string | null; name: string; email: string | null; stage: string | null;
  gpa: string | null; area_of_study: string | null; linkedin: string | null;
  resume_link: string | null; point_person_id: string | null;
  not_interested: boolean; is_favorite: boolean;
  source: string | null; created_by: string | null;
};
type School      = { id: string; name: string; color_primary: string | null; logo_url: string | null };
type AllSchool   = { id: string; name: string; tier: string; color_primary: string | null; logo_url: string | null };
type AllCand     = { id: string; name: string; email: string | null; school_id: string | null; stage: string | null; gpa: string | null; area_of_study: string | null; jazz_id: string | null; linkedin: string | null; point_person_id: string | null; not_interested: boolean; resume_link: string | null; is_favorite: boolean };
type AllGoal     = { school_id: string; goal_sourced: number; goal_contacted: number; goal_applied: number };
type TeamMember  = { id: string; full_name: string; role?: string | null };
type Completion  = { profile_id: string; state: string; updated_at?: string };
type Task        = {
  id: string; text: string; assignee_id: string | null; assignee_label: string | null;
  month_label: string | null; notes: string | null; due_date: string | null; done: boolean;
  pending_review?: boolean; assignees?: string[]; completions?: Completion[];
};
type Phase       = { id: string; label: string; title: string; sort_order: number; playbook_tasks: Task[] };

const PHASE_OF: Record<string, string> = { new: "Sourced", contacted: "Contacted", applied: "Applied", bmi: "Advanced", finalist: "Finalist", fellow: "Fellow" };
const phaseTone: Record<string, string> = { Sourced: C.navy3, Contacted: C.blue, Applied: C.navy2, Advanced: C.orange, Finalist: C.gold, Fellow: C.good };
function StagePill({ stage }: { stage: string | null }) {
  const ph = stage ? PHASE_OF[stage] ?? "Sourced" : "Sourced";
  const tone = phaseTone[ph];
  return <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: tone, background: `${tone}22`, padding: "4px 9px", borderRadius: 999 }}>{stage ?? "—"}</span>;
}

// Effective assignees for a task: explicit multi-assignees, else the legacy single owner.
const effAssignees = (t: Task): string[] => (t.assignees && t.assignees.length) ? t.assignees : (t.assignee_id ? [t.assignee_id] : []);
const compStateOf = (t: Task, pid: string): "confirmed" | "pending_review" | undefined =>
  ((t.completions ?? []).find((c) => c.profile_id === pid)?.state as any) ?? undefined;
// When the task became fully confirmed (latest confirm time) — for on-time/late.
const taskDoneAt = (t: Task): string | null => {
  const conf = (t.completions ?? []).filter((c) => c.state === "confirmed" && c.updated_at).map((c) => c.updated_at!);
  return conf.length ? conf.reduce((m, v) => (v > m ? v : m)) : null;
};
const TODAY_STR = () => new Date().toISOString().slice(0, 10);
// Classify a task's timeliness for the lead progress panel.
const dueClass = (t: Task, today: string): "on_time" | "late" | "overdue" | "none" => {
  if (t.done) {
    if (!t.due_date) return "on_time";
    const at = taskDoneAt(t);
    const doneDay = at ? at.slice(0, 10) : null;
    return doneDay && doneDay > t.due_date ? "late" : "on_time";
  }
  if (t.due_date && t.due_date < today) return "overdue";
  return "none";
};
const fmtDue = (d: string): string => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const SOURCED  = new Set(["new", "contacted", "applied", "bmi", "finalist", "fellow"]);
const CONTACTD = new Set(["contacted", "applied", "bmi", "finalist", "fellow"]);
const APPLIED  = new Set(["applied", "bmi", "finalist", "fellow"]);

export default function WorkspaceClient({
  profile, initialSection, school, candidates, team, phases, allSchools, allCandidates, allGoals, groupName, lastContactByCand, resources, events, allProfiles,
  budgetEntries = [], budgetSchoolId = null, budgetGuidance = [],
  allCandidatesTotal, candidatesPageSize = 500, facetMajors = [], facetStages = [], slimCandidates = [],
}: {
  profile: Profile; initialSection: string; school: School | null; candidates: Cand[]; team: TeamMember[]; phases: Phase[];
  allSchools: AllSchool[]; allCandidates: AllCand[]; allGoals: AllGoal[]; groupName?: string | null;
  lastContactByCand: Record<string, string>; resources: Resource[]; events: CalEvent[];
  allProfiles: { id: string; full_name: string }[];
  budgetEntries?: BudgetEntry[]; budgetSchoolId?: string | null; budgetGuidance?: Guidance[];
  // Candidates tab (S === "all") is server-paginated: `allCandidates` is the
  // first page; these carry the total + facet dropdowns + slim dedupe list.
  allCandidatesTotal?: number; candidatesPageSize?: number;
  facetMajors?: string[]; facetStages?: string[];
  slimCandidates?: { id: string; name: string; email: string | null }[];
}) {
  const isMobile = useIsMobile();
  const [tab] = useState<"plan" | "board" | "playbook" | "standings" | "all" | "resources" | "budget">(initialSection as any);
  const [breakdownScope, setBreakdownScope] = useState<"team" | "org">("team");
  const [allSchool, setAllSchool] = useState<string>("all"); // SchoolFilter value
  const [allSearch, setAllSearch] = useState("");
  const [allMajor, setAllMajor] = useState("All majors");
  const [allStage, setAllStage] = useState("All stages");
  const [allMinGpa, setAllMinGpa] = useState("");
  const [allFavOnly, setAllFavOnly] = useState(false);
  const [allMineOnly, setAllMineOnly] = useState(false);
  const [boardSearch, setBoardSearch] = useState("");
  const [boardStage, setBoardStage] = useState("All stages");
  const [boardFavOnly, setBoardFavOnly] = useState(false);
  const [boardOwner, setBoardOwner] = useState("");
  const [allSort, setAllSort] = useState<{ key: "name" | "school" | "major" | "gpa" | "stage"; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  // Server-paginated Candidates tab (S === "all"). `allCandidates` is page 0.
  const [allRows, setAllRows] = useState<AllCand[]>(allCandidates);
  const [allTotal, setAllTotal] = useState<number>(allCandidatesTotal ?? allCandidates.length);
  const [allPageNum, setAllPageNum] = useState(0);
  const [allLoading, setAllLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [resumeFor, setResumeFor] = useState<{ jazzId: string; name: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const canEdit = canEditPlaybook(profile.role);
  const canAssign = canReassign(profile.role);

  const accent = school?.color_primary ?? C.orange;

  const nameOf = (id: string | null, label?: string | null): string => {
    if (label === "team") return "Team";
    if (!id) return "Unassigned";
    if (id === profile.id) return "You";
    return team.find((t) => t.id === id)?.full_name ?? "—";
  };
  // Everyone can OPEN any candidate and read its notes/warm-intros. Editing
  // (logging outreach, flags, warm intros) is limited to the assigned point
  // person — or team leads/admins, who manage their whole school.
  const openFromSchool = candidates.find((c) => c.id === openId) ?? null;
  const openFromAll = allRows.find((c) => c.id === openId) ?? null;
  const open: Cand | null = openFromSchool ?? (openFromAll as Cand | null);
  const openCanEdit = open ? (canAssign || open.point_person_id === profile.id) : false;

  // Fetch one page of the org-wide Candidates list with current filters applied.
  const ALL_PAGE_SIZE = candidatesPageSize;
  const loadAllPage = async (page: number) => {
    setAllLoading(true);
    const res = await listCandidates({
      variant: "workspace", page, pageSize: ALL_PAGE_SIZE,
      scope: allSchool, q: allSearch, major: allMajor, stage: allStage, minGpa: allMinGpa,
      favOnly: allFavOnly, mineOnly: allMineOnly,
      sortKey: allSort.key, sortDir: allSort.dir,
    });
    setAllRows(res.rows as AllCand[]);
    setAllTotal(res.total);
    setAllPageNum(page);
    setAllLoading(false);
  };
  const allMounted = useRef(false);
  useEffect(() => {
    if (tab !== "all") return;
    if (!allMounted.current) { allMounted.current = true; return; }
    const t = setTimeout(() => { loadAllPage(0); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSearch, allSchool, allMajor, allStage, allMinGpa, allFavOnly, allMineOnly, allSort]);

  const PHASE_ORDER_PIPELINE = ["sourced", "contacted", "applied"] as const;
  const PHASE_LABEL: Record<string, string> = { sourced: "Sourced", contacted: "Contacted", applied: "Applied" };
  const PHASE_TONE: Record<string, string> = { sourced: C.navy3, contacted: C.blue, applied: C.navy2 };

  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    candidates.forEach((c) => {
      if (c.not_interested) return;
      const ph = phaseOf(c.stage);
      if (ph && ph !== "rejected" && ph !== "moved") counts[ph] = (counts[ph] ?? 0) + 1;
    });
    return counts;
  }, [candidates]);

  const totalActive = PHASE_ORDER_PIPELINE.reduce((s, ph) => s + (phaseCounts[ph] ?? 0), 0);

  // Goal-aware pipeline stats for the school
  const schoolGoal = useMemo(() => {
    if (!school) return null;
    return allGoals.find((g) => g.school_id === school.id) ?? null;
  }, [allGoals, school]);

  const pipelineBoard = useMemo(() => {
    const sourced   = candidates.filter((c) => c.stage && SOURCED.has(c.stage)).length;
    const contacted = candidates.filter((c) => c.stage && CONTACTD.has(c.stage)).length;
    const applied   = candidates.filter((c) => c.stage && APPLIED.has(c.stage)).length;
    return [
      { label: "Sourced",   actual: sourced,   goal: schoolGoal?.goal_sourced   ?? 0 },
      { label: "Contacted", actual: contacted, goal: schoolGoal?.goal_contacted ?? 0 },
      { label: "Applied",   actual: applied,   goal: schoolGoal?.goal_applied   ?? 0 },
    ];
  }, [candidates, schoolGoal]);

  // Org-wide breakdown (toggle on the Weekly Snapshot).
  const orgPipelineBoard = useMemo(() => {
    const sourced   = allCandidates.filter((c) => c.stage && SOURCED.has(c.stage)).length;
    const contacted = allCandidates.filter((c) => c.stage && CONTACTD.has(c.stage)).length;
    const applied   = allCandidates.filter((c) => c.stage && APPLIED.has(c.stage)).length;
    const sum = (k: "goal_sourced" | "goal_contacted" | "goal_applied") => allGoals.reduce((s, g) => s + (g[k] ?? 0), 0);
    return [
      { label: "Sourced",   actual: sourced,   goal: sum("goal_sourced") },
      { label: "Contacted", actual: contacted, goal: sum("goal_contacted") },
      { label: "Applied",   actual: applied,   goal: sum("goal_applied") },
    ];
  }, [allCandidates, allGoals]);

  const activeBoard = breakdownScope === "team" ? pipelineBoard : orgPipelineBoard;

  // Action queue — next moves on candidates you own (or unclaimed ones to grab).
  const plan = useMemo(() => {
    const now = Date.now();
    const out: { id: string; type: string; cand: Cand; why: string; rank: number }[] = [];
    for (const c of candidates) {
      const t = evaluateCandidate(c, { profileId: profile.id, lastContactISO: lastContactByCand[c.id], now });
      if (t) out.push({ id: `${t.kind}-${c.id}`, type: t.type, cand: c, why: t.why, rank: t.rank });
    }
    return out.sort((a, b) => a.rank - b.rank);
  }, [candidates, lastContactByCand, profile.id]);

  // Team-lead review: each assignee's submission awaiting confirmation.
  const pendingReviewTasks = useMemo(() => {
    if (!canEdit) return [] as { task: Task; roleTitle: string; profileId: string }[];
    const out: { task: Task; roleTitle: string; profileId: string }[] = [];
    for (const p of phases) for (const t of p.playbook_tasks) {
      for (const c of t.completions ?? []) {
        if (c.state === "pending_review") out.push({ task: t, roleTitle: p.title, profileId: c.profile_id });
      }
      // Legacy fallback: pending_review flag with no per-assignee rows yet.
      if ((t.completions ?? []).length === 0 && t.pending_review && !t.done && t.assignee_id) {
        out.push({ task: t, roleTitle: p.title, profileId: t.assignee_id });
      }
    }
    return out;
  }, [phases, canEdit]);

  const onFav = (c: Cand) => startTransition(() => { toggleFavorite(c.id, !c.is_favorite); });

  // Weekly snapshot shows ONLY tasks assigned to this specific person. Team
  // leads manage the full set (team / unassigned tasks) in the Playbook tab.
  const myTasks = useMemo(() => {
    const results: { task: Task; roleTitle: string }[] = [];
    for (const p of phases) {
      for (const t of p.playbook_tasks) {
        if (effAssignees(t).includes(profile.id)) results.push({ task: t, roleTitle: p.title });
      }
    }
    return results;
  }, [phases, profile.id]);

  const MONTHS = ["July", "August", "September", "Oct/Nov"];

  return (
    <>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "20px 14px 60px" : "30px 28px 80px", opacity: pending ? 0.7 : 1 }}>

        {/* ---- WEEKLY SNAPSHOT ---- */}
        {tab === "plan" && (
          <>
            <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Weekly Snapshot</h1>
            <p style={{ color: C.grayMute, margin: "4px 0 0" }}>{plan.length} move{plan.length !== 1 ? "s" : ""} queued · {totalActive} active candidates</p>

            {/* Pipeline breakdown — toggle between your team and the whole org */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <div style={{ display: "inline-flex", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 9, padding: 3, gap: 3 }}>
                {(["team", "org"] as const).map((s) => (
                  <button key={s} onClick={() => setBreakdownScope(s)}
                    style={{ border: "none", borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: breakdownScope === s ? C.navy : "transparent", color: breakdownScope === s ? "#fff" : C.grayMute }}>
                    {s === "team" ? (groupName ?? school?.name ?? "My team") : "Org-wide"}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 8 }}>
              {activeBoard.map((b) => {
                const hasGoal = b.goal > 0;
                const pct = hasGoal ? (b.actual / b.goal) * 100 : 0;
                const tone = pct >= 100 ? C.good : pct >= 70 ? C.gold : C.orange;
                return (
                  <div key={b.label} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
                    <div style={{ background: C.navy, color: "#fff", padding: "12px 18px", textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", opacity: 0.8 }}>{b.label}</div>
                      <div style={{ fontFamily: HEAD, fontSize: 32, fontWeight: 700, marginTop: 2, lineHeight: 1 }}>{b.actual}</div>
                    </div>
                    {hasGoal ? (
                      <div style={{ padding: "8px 18px", textAlign: "center", background: `${tone}14` }}>
                        <div style={{ fontSize: 11, color: C.grayMute, fontWeight: 600 }}>Goal {b.goal} · {Math.round(pct)}%</div>
                        <div style={{ marginTop: 5, height: 5, borderRadius: 99, background: C.line, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: tone, borderRadius: 99 }} />
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding: "8px 18px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: C.grayMute }}>No goal set</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Action Queue + My Tasks, side by side */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20, marginTop: 26, alignItems: "start" }}>

              {/* Action Queue */}
              <div>
                <h2 style={{ fontSize: 20, color: C.navy, margin: "0 0 12px", fontFamily: HEAD }}>Action Queue</h2>

                {/* Team-lead review of completed tasks */}
                {pendingReviewTasks.length > 0 && (
                  <div style={{ background: "#fff", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
                    <div style={{ fontFamily: HEAD, fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#8A6D0E", marginBottom: 10 }}>Review completed work · {pendingReviewTasks.length}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {pendingReviewTasks.map(({ task: t, roleTitle, profileId }) => (
                        <div key={`${t.id}:${profileId}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13.5, color: C.gray, fontWeight: 600 }}>{t.text}</div>
                            <div style={{ fontSize: 11, color: C.grayMute }}>{team.find((m) => m.id === profileId)?.full_name ?? "Someone"} · {roleTitle}</div>
                          </div>
                          <button onClick={() => startTransition(() => { confirmTaskComplete(t.id, true, profileId); })}
                            style={{ border: "none", background: C.good, color: "#fff", fontWeight: 700, fontSize: 12, padding: "6px 11px", borderRadius: 7, cursor: "pointer", flexShrink: 0 }}>Confirm</button>
                          <button onClick={() => startTransition(() => { confirmTaskComplete(t.id, false, profileId); })}
                            title="Send back to the fellow" style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.grayMute, fontWeight: 700, fontSize: 12, padding: "6px 9px", borderRadius: 7, cursor: "pointer", flexShrink: 0 }}>↩</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {plan.map((a) => (
                    <div key={a.id} onClick={() => setOpenId(a.cand.id)} style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${accent}`, borderRadius: 12, padding: "15px 18px", display: "flex", alignItems: "center", gap: 16, cursor: "pointer" }}>
                      <span style={{ width: 92, fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: accent, flexShrink: 0 }}>{a.type}</span>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, color: C.gray }}>{a.cand.name}</div><div style={{ fontSize: 13, color: C.grayMute }}>{a.why}</div></div>
                      <StagePill stage={a.cand.stage} />
                    </div>
                  ))}
                  {plan.length === 0 && pendingReviewTasks.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12 }}>All clear — nothing needs you right now.</div>}
                </div>
              </div>

              {/* My Tasks */}
              <div>
                <h2 style={{ fontSize: 20, color: C.navy, margin: "0 0 12px", fontFamily: HEAD }}>
                  My Tasks
                  <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 600, color: C.grayMute }}>{myTasks.filter((m) => compStateOf(m.task, profile.id) === "confirmed").length}/{myTasks.length} done</span>
                </h2>
                {myTasks.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: C.grayMute, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12 }}>No tasks assigned to you.</div>
                ) : MONTHS.map((month) => {
                  const monthTasks = myTasks.filter((m) => m.task.month_label === month);
                  if (!monthTasks.length) return null;
                  return (
                    <div key={month} style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 0.8, marginBottom: 8 }}>{month}</div>
                      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
                        {monthTasks.map(({ task: t, roleTitle }) => {
                          const myState = compStateOf(t, profile.id);
                          const confirmed = myState === "confirmed";
                          const pending = myState === "pending_review";
                          const onToggle = (val: boolean) => startTransition(() => {
                            if (canEdit) confirmTaskComplete(t.id, val, profile.id);  // leads confirm their own directly
                            else requestTaskComplete(t.id, val);                       // fellows send for review
                          });
                          return (
                            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${C.line}`, opacity: confirmed ? 0.55 : 1 }}>
                              <CompletionBubble state={myState} accent={accent}
                                disabled={confirmed && !canEdit}
                                onToggle={() => onToggle(!(confirmed || pending))} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: 13.5, color: C.gray, textDecoration: confirmed ? "line-through" : "none" }}>{t.text}</span>
                                {pending && <div style={{ fontSize: 11, color: "#8A6D0E", fontWeight: 600 }}>Completed · waiting on team-lead review to count</div>}
                              </div>
                              <span style={{ fontSize: 11, color: C.grayMute, flexShrink: 0 }}>{roleTitle}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recruiting calendar */}
            <div style={{ marginTop: 30 }}>
              <h2 style={{ fontSize: 20, color: C.navy, margin: "0 0 12px", fontFamily: HEAD }}>Recruiting Calendar</h2>
              <RecruitingCalendar events={events} canEdit={canEditEvents(profile.role)} profileId={profile.id} schoolId={school?.id ?? null} team={team} accent={accent} />
            </div>
          </>
        )}

        {/* ---- MY SCHOOL BOARD ---- */}
        {tab === "board" && (() => {
          const boardQ = boardSearch.trim().toLowerCase();
          const boardDistinctStages = Array.from(new Set(candidates.map((c) => c.stage).filter((s): s is string => !!s))).sort((a, b) => a.localeCompare(b));
          const boardVisible = candidates.filter((c) => {
            if (boardQ && !(`${c.name} ${c.email ?? ""} ${c.area_of_study ?? ""}`.toLowerCase().includes(boardQ))) return false;
            if (boardStage !== "All stages" && c.stage !== boardStage) return false;
            if (boardFavOnly && !c.is_favorite) return false;
            if (boardOwner && c.point_person_id !== (boardOwner === "__me__" ? profile.id : boardOwner)) return false;
            return true;
          });
          const boardFiltersActive = boardQ || boardStage !== "All stages" || boardFavOnly || boardOwner;
          return (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
              <div>
                <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>My School Board</h1>
                <p style={{ color: C.grayMute, margin: "4px 0 0" }}>{boardVisible.length}{boardFiltersActive ? ` of ${candidates.length}` : ""} candidate{candidates.length !== 1 ? "s" : ""}.</p>
              </div>
              {canAssign && team.length > 0 && (
                <button onClick={() => setAssignOpen(true)}
                  style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: accent, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                  ⚡ Assign Point People
                </button>
              )}
            </div>

            {/* Search bar */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
              <input value={boardSearch} onChange={(e) => setBoardSearch(e.target.value)} placeholder="Search name, email, major…"
                style={{ flex: "1 1 200px", minWidth: 160, padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
              <select value={boardStage} onChange={(e) => setBoardStage(e.target.value)} style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, background: "#fff", color: C.gray, fontWeight: 600 }}>
                <option>All stages</option>
                {boardDistinctStages.map((s) => <option key={s}>{s}</option>)}
              </select>
              <select value={boardOwner} onChange={(e) => setBoardOwner(e.target.value)} style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${boardOwner ? accent : C.line}`, fontSize: 13.5, background: boardOwner ? `${accent}10` : "#fff", color: boardOwner ? accent : C.gray, fontWeight: 600 }}>
                <option value="">All owners</option>
                <option value="__me__">Mine</option>
                {team.filter((t) => t.id !== profile.id).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
              <button onClick={() => setBoardFavOnly((v) => !v)}
                style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${boardFavOnly ? C.gold : C.line}`, fontSize: 13.5, background: boardFavOnly ? "#FBF3D6" : "#fff", color: boardFavOnly ? "#8A6D0E" : C.grayMute, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                {boardFavOnly ? "★ Favorites" : "☆ Favorites"}
              </button>
              <button onClick={() => { setBoardSearch(""); setBoardStage("All stages"); setBoardFavOnly(false); setBoardOwner(""); }}
                disabled={!boardFiltersActive}
                style={{ padding: "9px 12px", borderRadius: 9, border: "none", background: "transparent", color: boardFiltersActive ? C.navy2 : C.grayMute, fontSize: 13, fontWeight: 700, cursor: boardFiltersActive ? "pointer" : "default", textDecoration: boardFiltersActive ? "underline" : "none", opacity: boardFiltersActive ? 1 : 0.45 }}>
                Clear
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 240px", gap: 18, marginTop: 16, alignItems: "start" }}>
              {/* Candidate table */}
              <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", ...(isMobile ? { overflowX: "auto" } : {}) }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 0.6fr 1fr 1.2fr 40px", minWidth: isMobile ? 560 : undefined, padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#ececec" }}>
                  <div>Candidate</div><div>Major</div><div>GPA</div><div>Stage</div><div>Owner</div><div></div>
                </div>
                {boardVisible.map((c) => (
                  <div key={c.id} onClick={() => setOpenId(c.id)} onMouseEnter={() => setHoveredId(c.id)} onMouseLeave={() => setHoveredId(null)} style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 0.6fr 1fr 1.2fr 40px", minWidth: isMobile ? 560 : undefined, padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", opacity: c.not_interested ? 0.5 : 1, cursor: "pointer", background: hoveredId === c.id ? C.canvas : "#ececec", transition: "background 0.1s" }}>
                    <div><div style={{ fontWeight: 700, fontSize: 14, color: C.gray }}>{c.name}</div><div style={{ fontSize: 12, color: C.grayMute }}>{c.email}</div></div>
                    <div style={{ fontSize: 13.5 }}>{c.area_of_study}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.gpa}</div>
                    <div><StagePill stage={c.stage} /></div>
                    <div onClick={(e) => e.stopPropagation()}>
                      {canAssign ? (
                        <PersonPicker value={c.point_person_id} options={team} meId={profile.id} accent={accent} compact
                          placeholder="Search your school…"
                          onChange={(v) => startTransition(() => { reassignPointPerson(c.id, v); })} />
                      ) : (
                        <span style={{ fontSize: 13, color: c.point_person_id ? C.grayMute : C.orange, fontWeight: 600 }}>{nameOf(c.point_person_id)}</span>
                      )}
                    </div>
                    <div onClick={(e) => { e.stopPropagation(); onFav(c); }} style={{ cursor: "pointer", fontSize: 18, color: c.is_favorite ? C.gold : "#D8DCE5", textAlign: "center" }}>{c.is_favorite ? "★" : "☆"}</div>
                  </div>
                ))}
                {boardVisible.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>{boardFiltersActive ? "No candidates match your search." : "No candidates yet — run a sync or add one."}</div>}
              </div>

              {/* Team panel — click a member to see only their applicants */}
              <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, background: "#FAFBFE", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, letterSpacing: 0.5 }}>Team · {team.length}</div>
                  {boardOwner && <button onClick={() => setBoardOwner("")} style={{ border: "none", background: "none", color: C.navy2, fontSize: 11, fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: 0 }}>Show all</button>}
                </div>
                {team.map((t) => {
                  const owned = candidates.filter((c) => c.point_person_id === t.id && !c.not_interested).length;
                  const isMe = t.id === profile.id;
                  const ownerVal = isMe ? "__me__" : t.id;
                  const selected = boardOwner === ownerVal;
                  return (
                    <div key={t.id} onClick={() => setBoardOwner(selected ? "" : ownerVal)} title={`Show ${isMe ? "your" : `${t.full_name}'s`} applicants`}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${C.line}`, cursor: "pointer",
                        background: selected ? `${accent}14` : "#fff", borderLeft: `3px solid ${selected ? accent : "transparent"}` }}
                      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = C.canvas; }}
                      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "#fff"; }}>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: isMe ? accent : C.navy, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                        {t.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: selected ? accent : C.gray, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {t.full_name}{isMe ? " (you)" : ""}
                          </div>
                          {t.role === "team_lead" && <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: accent, background: `${accent}18`, padding: "1px 5px", borderRadius: 4, flexShrink: 0 }}>Lead</span>}
                        </div>
                        <div style={{ fontSize: 11, color: C.grayMute }}>{owned} candidate{owned !== 1 ? "s" : ""}</div>
                      </div>
                    </div>
                  );
                })}
                {team.length === 0 && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: C.grayMute }}>No team members yet.</div>}
              </div>
            </div>
          </>
          );
        })()}

        {/* ---- PLAYBOOK ---- */}
        {tab === "playbook" && (
          <PlaybookTab phases={phases} profile={profile} canEdit={canEdit} team={team} nameOf={nameOf} accent={accent} startTransition={startTransition} />
        )}

        {/* ---- STANDINGS ---- */}
        {tab === "standings" && (
          <StandingsClient schools={allSchools} candidates={allCandidates} goals={allGoals} mySchoolId={school?.id ?? null} />
        )}

        {/* ---- APPLICANTS ---- */}
        {tab === "all" && (() => {
          // Server provides the filtered/sorted page; dropdowns read the facets.
          const distinctMajors = facetMajors;
          const distinctStages = facetStages;
          const visible = allRows;
          const totalPages = Math.max(1, Math.ceil(allTotal / ALL_PAGE_SIZE));

          const toggleSort = (key: typeof allSort.key) =>
            setAllSort((p) => p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
          const arrow = (key: typeof allSort.key) => allSort.key === key ? (allSort.dir === "asc" ? " ▲" : " ▼") : "";
          const SortHead = ({ k, label }: { k: typeof allSort.key; label: string }) => (
            <div onClick={() => toggleSort(k)} style={{ cursor: "pointer", userSelect: "none", color: allSort.key === k ? C.navy : C.grayMute }}>{label}{arrow(k)}</div>
          );
          const filtersActive = allSearch.trim() !== "" || allMajor !== "All majors" || allStage !== "All stages" || allFavOnly || allMineOnly || allMinGpa.trim() !== "" || allSchool !== "all";

          return (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
                <div>
                  <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Candidates</h1>
                  <p style={{ color: C.grayMute, margin: "4px 0 0" }}>{allTotal.toLocaleString()} candidate{allTotal !== 1 ? "s" : ""}{allLoading ? " · loading…" : ""} · click a row to view details</p>
                </div>
                <button onClick={() => setBulkOpen(true)} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 700, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" }}>Bulk import</button>
              </div>

              {/* Filter bar */}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
                <input value={allSearch} onChange={(e) => setAllSearch(e.target.value)} placeholder="Search name, email, major…"
                  style={{ flex: "1 1 200px", minWidth: 160, padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
                <SchoolFilter schools={allSchools} value={allSchool} onChange={setAllSchool} />
                <select value={allMajor} onChange={(e) => setAllMajor(e.target.value)} style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, background: "#fff", color: C.gray, fontWeight: 600, maxWidth: 200 }}>
                  <option>All majors</option>
                  {distinctMajors.map((m) => <option key={m}>{m}</option>)}
                </select>
                <select value={allStage} onChange={(e) => setAllStage(e.target.value)} style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, background: "#fff", color: C.gray, fontWeight: 600 }}>
                  <option>All stages</option>
                  {distinctStages.map((s) => <option key={s}>{s}</option>)}
                </select>
                <input value={allMinGpa} onChange={(e) => setAllMinGpa(e.target.value)} type="number" step="0.1" min="0" max="4" placeholder="Min GPA"
                  style={{ width: 96, padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
                <button onClick={() => setAllFavOnly((v) => !v)}
                  style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${allFavOnly ? C.gold : C.line}`, fontSize: 13.5, background: allFavOnly ? "#FBF3D6" : "#fff", color: allFavOnly ? "#8A6D0E" : C.grayMute, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {allFavOnly ? "★ Favorites" : "☆ Favorites"}
                </button>
                <button onClick={() => setAllMineOnly((v) => !v)}
                  style={{ padding: "9px 14px", borderRadius: 9, border: `1px solid ${allMineOnly ? accent : C.line}`, fontSize: 13.5, background: allMineOnly ? `${accent}18` : "#fff", color: allMineOnly ? accent : C.grayMute, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  Assigned to me
                </button>
                {filtersActive && (
                  <button onClick={() => { setAllSearch(""); setAllMajor("All majors"); setAllStage("All stages"); setAllMinGpa(""); setAllFavOnly(false); setAllMineOnly(false); setAllSchool("all"); }}
                    style={{ padding: "9px 12px", borderRadius: 9, border: "none", background: "transparent", color: C.navy2, fontSize: 13, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                    Clear
                  </button>
                )}
              </div>

              <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16, ...(isMobile ? { overflowX: "auto" } : {}) }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 0.6fr 1fr 80px", minWidth: isMobile ? 620 : undefined, padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                  <SortHead k="name" label="Candidate" /><SortHead k="school" label="School" /><SortHead k="major" label="Major" /><SortHead k="gpa" label="GPA" /><SortHead k="stage" label="Stage" /><div></div>
                </div>
                {visible.map((c) => {
                  const sc = allSchools.find((s) => s.id === c.school_id);
                  const schoolAccent = sc?.color_primary ?? C.navy2;
                  const mine = c.point_person_id === profile.id;
                  return (
                    <div key={c.id} onClick={() => setOpenId(c.id)}
                      style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 0.6fr 1fr 80px", minWidth: isMobile ? 620 : undefined, padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", cursor: "pointer", opacity: c.not_interested ? 0.5 : 1 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F4FA")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.gray }}>
                          {c.is_favorite && <span style={{ color: C.gold, marginRight: 5 }}>★</span>}{c.name}
                          {mine && <span style={{ fontSize: 10, fontWeight: 700, color: accent, background: `${accent}18`, padding: "1px 6px", borderRadius: 99, marginLeft: 6 }}>Mine</span>}
                        </div>
                        <div style={{ fontSize: 12, color: C.grayMute }}>{c.email}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: schoolAccent }}>{sc?.name ?? <span style={{ color: C.grayMute, fontStyle: "italic" }}>Unrouted</span>}</div>
                      <div style={{ fontSize: 13 }}>{c.area_of_study ?? "—"}</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{c.gpa ?? "—"}</div>
                      <div><StagePill stage={c.stage} /></div>
                      <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                        {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: C.navy2, textDecoration: "none", border: `1px solid ${C.line}`, borderRadius: 6, padding: "4px 8px" }}>in</a>}
                        {c.jazz_id && <button onClick={() => setResumeFor({ jazzId: c.jazz_id!, name: c.name })}
                          style={{ fontSize: 11, fontWeight: 700, color: C.navy2, border: `1px solid ${C.line}`, borderRadius: 6, padding: "4px 8px", background: "#fff", cursor: "pointer" }}>CV</button>}
                      </div>
                    </div>
                  );
                })}
                {visible.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>{allLoading ? "Loading…" : filtersActive ? "No candidates match these filters." : "No candidates yet."}</div>}
              </div>

              {/* Pagination */}
              {allTotal > ALL_PAGE_SIZE && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 16 }}>
                  <button onClick={() => loadAllPage(allPageNum - 1)} disabled={allPageNum <= 0 || allLoading}
                    style={{ padding: "8px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: "#fff", color: allPageNum <= 0 ? C.grayMute : C.navy, fontWeight: 700, fontSize: 13.5, cursor: allPageNum <= 0 || allLoading ? "default" : "pointer" }}>← Prev</button>
                  <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>
                    Page {allPageNum + 1} of {totalPages} · {(allPageNum * ALL_PAGE_SIZE + 1).toLocaleString()}–{Math.min((allPageNum + 1) * ALL_PAGE_SIZE, allTotal).toLocaleString()} of {allTotal.toLocaleString()}
                  </span>
                  <button onClick={() => loadAllPage(allPageNum + 1)} disabled={allPageNum >= totalPages - 1 || allLoading}
                    style={{ padding: "8px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: "#fff", color: allPageNum >= totalPages - 1 ? C.grayMute : C.navy, fontWeight: 700, fontSize: 13.5, cursor: allPageNum >= totalPages - 1 || allLoading ? "default" : "pointer" }}>Next →</button>
                </div>
              )}
            </>
          );
        })()}

        {/* ---- RESOURCES ---- */}
        {tab === "resources" && (
          <ResourcesPanel resources={resources} canManage={canManageResources(profile.role)} accent={accent} />
        )}

        {/* ---- BUDGET (team lead: view allocations, log expenses) ---- */}
        {tab === "budget" && (
          <>
            <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Budget</h1>
            <p style={{ color: C.grayMute, margin: "4px 0 20px" }}>Your school&apos;s budget. Admins set allocations; you log expenses with a receipt.</p>
            <BudgetPanel entries={budgetEntries} schoolId={budgetSchoolId} accent={accent} meId={profile.id} canExpense guidance={budgetGuidance} />
          </>
        )}
      </div>

      {open && (
        <CandidateDrawer c={open} canEdit={openCanEdit} profile={profile} team={team} allProfiles={allProfiles} onClose={() => { setOpenId(null); if (tab === "all") loadAllPage(allPageNum); }} startTransition={startTransition} onResume={(jazzId, name) => setResumeFor({ jazzId, name })} />
      )}
      {resumeFor && (
        <ResumeModal jazzId={resumeFor.jazzId} name={resumeFor.name} onClose={() => setResumeFor(null)} />
      )}
      {bulkOpen && (
        <BulkImportModal
          schools={allSchools}
          team={team}
          canAssignPointPerson={canAssign}
          existingEmails={new Set(slimCandidates.map((c) => c.email?.toLowerCase() ?? "").filter(Boolean))}
          existingNames={new Set(slimCandidates.map((c) => c.name?.trim().toLowerCase() ?? "").filter(Boolean))}
          onClose={() => { setBulkOpen(false); if (tab === "all") loadAllPage(0); }}
        />
      )}
      {assignOpen && (
        <AssignPointPeopleModal
          candidates={candidates}
          team={team}
          meId={profile.id}
          accent={accent}
          onClose={() => setAssignOpen(false)}
          startTransition={startTransition}
        />
      )}
    </>
  );
}

// ---- Assign Point People — a flashcard deck for quickly distributing candidates ----
// Pick one team member, then go card-by-card: "Skip" or "Assign to <person>".
// The deck is snapshotted when you start so it doesn't shift as you assign.
function AssignPointPeopleModal({ candidates, team, meId, accent, onClose, startTransition }: {
  candidates: Cand[]; team: TeamMember[]; meId: string; accent: string;
  onClose: () => void; startTransition: (cb: () => void) => void;
}) {
  const [phase, setPhase] = useState<"pick" | "deck" | "done">("pick");
  const [personId, setPersonId] = useState<string | null>(null);
  const [unassignedOnly, setUnassignedOnly] = useState(true);
  const [deck, setDeck] = useState<Cand[]>([]);
  const [idx, setIdx] = useState(0);
  const [assigned, setAssigned] = useState(0);

  const personName = team.find((t) => t.id === personId)?.full_name ?? "this person";
  const nameOf = (id: string | null) => (id === meId ? "You" : team.find((t) => t.id === id)?.full_name ?? "Unassigned");
  const poolFor = (pid: string) =>
    candidates.filter((c) => !c.not_interested && (unassignedOnly ? !c.point_person_id : c.point_person_id !== pid));

  const start = () => {
    if (!personId) return;
    const pool = poolFor(personId);
    setDeck(pool); setIdx(0); setAssigned(0);
    setPhase(pool.length ? "deck" : "done");
  };

  const current = deck[idx] ?? null;
  const advance = () => { if (idx + 1 >= deck.length) setPhase("done"); else setIdx((i) => i + 1); };
  const assign = () => {
    if (!current || !personId) return;
    const id = current.id, pid = personId;
    startTransition(() => { reassignPointPerson(id, pid); });
    setAssigned((n) => n + 1);
    advance();
  };

  // Keyboard: ← skip, → assign, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (phase !== "deck") return;
      if (e.key === "ArrowRight") { e.preventDefault(); assign(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); advance(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, idx, deck, personId]); // eslint-disable-line react-hooks/exhaustive-deps

  const card: React.CSSProperties = { position: "relative", background: "#fff", borderRadius: 18, padding: 28, width: 480, maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(11,12,42,.28)" };
  const btn = (bg: string, color = "#fff"): React.CSSProperties => ({ border: "none", background: bg, color, fontWeight: 700, padding: "12px 18px", borderRadius: 11, cursor: "pointer", fontSize: 14 });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.5)" }} />

      {phase === "pick" && (
        <div style={card}>
          <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, border: "none", background: "none", fontSize: 22, color: C.grayMute, cursor: "pointer", lineHeight: 1 }}>×</button>
          <h2 style={{ fontFamily: HEAD, fontSize: 24, color: C.navy, margin: "0 0 4px" }}>Assign Point People</h2>
          <p style={{ fontSize: 13.5, color: C.grayMute, margin: "0 0 18px" }}>Pick a team member, then go through candidates one at a time.</p>

          <label style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16, cursor: "pointer", fontSize: 13.5, color: C.gray, fontWeight: 600 }}>
            <input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} style={{ width: 16, height: 16, accentColor: accent }} />
            Only show unassigned candidates
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            {team.map((t) => {
              const count = poolFor(t.id).length;
              const sel = personId === t.id;
              return (
                <button key={t.id} onClick={() => setPersonId(t.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                    border: `1.5px solid ${sel ? accent : C.line}`, background: sel ? `${accent}12` : "#fff" }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: sel ? accent : C.navy, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                    {t.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: sel ? accent : C.gray, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.id === meId ? `${t.full_name} (you)` : t.full_name}</div>
                    <div style={{ fontSize: 11.5, color: C.grayMute }}>{count} to review</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ ...btn(C.line, C.gray), background: "#fff", border: `1px solid ${C.line}` }}>Cancel</button>
            <button onClick={start} disabled={!personId} style={{ ...btn(personId ? C.navy : C.navy3), cursor: personId ? "pointer" : "not-allowed" }}>Start →</button>
          </div>
        </div>
      )}

      {phase === "deck" && current && (
        <div style={card}>
          <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, border: "none", background: "none", fontSize: 22, color: C.grayMute, cursor: "pointer", lineHeight: 1 }}>×</button>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, color: C.grayMute, fontWeight: 600 }}>Assigning to <b style={{ color: accent }}>{personName}</b></div>
            <div style={{ fontSize: 12.5, color: C.grayMute, fontWeight: 700 }}>{idx + 1} / {deck.length}</div>
          </div>
          {/* Progress bar */}
          <div style={{ height: 6, borderRadius: 99, background: C.line, overflow: "hidden", marginBottom: 22 }}>
            <div style={{ height: "100%", width: `${(idx / deck.length) * 100}%`, background: accent, transition: "width .2s" }} />
          </div>

          {/* The card */}
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "26px 22px", textAlign: "center", marginBottom: 22, background: C.canvas }}>
            <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 26, color: C.navy, marginBottom: 8 }}>{current.name}</div>
            <div style={{ marginBottom: 12 }}><StagePill stage={current.stage} /></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5, color: C.gray }}>
              {current.email && <div>{current.email}</div>}
              {(current.area_of_study || current.gpa) && <div style={{ color: C.grayMute }}>{[current.area_of_study, current.gpa ? `GPA ${current.gpa}` : null].filter(Boolean).join(" · ")}</div>}
              <div style={{ marginTop: 6, fontSize: 12.5, color: current.point_person_id ? C.grayMute : C.orange, fontWeight: 600 }}>
                {current.point_person_id ? `Currently: ${nameOf(current.point_person_id)}` : "Currently unassigned"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={advance} style={{ ...btn("#fff", C.gray), flex: 1, border: `1.5px solid ${C.line}` }}>Skip →</button>
            <button onClick={assign} style={{ ...btn(accent), flex: 2 }}>Assign to {personName}</button>
          </div>
          <div style={{ textAlign: "center", marginTop: 12, fontSize: 11.5, color: C.grayMute }}>← skip · → assign · {assigned} assigned so far</div>
        </div>
      )}

      {phase === "done" && (
        <div style={card}>
          <h2 style={{ fontFamily: HEAD, fontSize: 24, color: C.navy, margin: "0 0 6px" }}>All done</h2>
          <p style={{ fontSize: 14, color: C.gray, margin: "0 0 22px" }}>
            {deck.length === 0
              ? `No candidates to review for ${personName}.`
              : <>Assigned <b style={{ color: C.good }}>{assigned}</b> candidate{assigned !== 1 ? "s" : ""} to <b>{personName}</b>.</>}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={() => { setPersonId(null); setPhase("pick"); }} style={{ ...btn("#fff", C.navy), border: `1px solid ${C.line}` }}>Assign someone else</button>
            <button onClick={onClose} style={btn(C.navy)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// A task-completion bubble with three states: empty (not done), half-filled gold
// (submitted, awaiting team-lead review), and full green (confirmed). The half
// state shows a popup so fellows know it isn't a rendering glitch.
function CompletionBubble({ state, accent, disabled, onToggle, size = 19 }: {
  state: "confirmed" | "pending_review" | undefined; accent: string;
  disabled?: boolean; onToggle: () => void; size?: number;
}) {
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);
  const confirmed = state === "confirmed";
  const pending = state === "pending_review";
  const bg = confirmed ? C.good : pending ? `linear-gradient(90deg, ${C.gold} 0 50%, #fff 50% 100%)` : "#fff";
  const border = confirmed ? C.good : pending ? C.gold : C.navy3;
  // Fixed-position tooltip anchored to the bubble's rect so it can't be clipped
  // by an ancestor card's overflow:hidden (which was cutting it off before).
  const showTip = (e: { currentTarget: HTMLButtonElement }) => {
    if (!pending) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ top: r.top - 8, left: r.left + r.width / 2 });
  };
  return (
    <div style={{ flexShrink: 0, display: "flex" }}>
      <button type="button" onClick={onToggle} disabled={disabled}
        onMouseEnter={showTip} onMouseLeave={() => setTip(null)}
        aria-label={confirmed ? "Confirmed" : pending ? "Submitted — awaiting review" : "Mark complete"}
        style={{ width: size, height: size, borderRadius: "50%", border: `2px solid ${border}`, background: bg,
          cursor: disabled ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: 11, fontWeight: 800, padding: 0, lineHeight: 1 }}>
        {confirmed ? "✓" : ""}
      </button>
      {pending && tip && (
        <div style={{ position: "fixed", top: tip.top, left: tip.left, transform: "translate(-50%, -100%)", zIndex: 1000,
          width: 220, pointerEvents: "none", background: C.navy, color: "#fff", fontSize: 11.5, lineHeight: 1.4, fontWeight: 500,
          padding: "8px 10px", borderRadius: 8, boxShadow: "0 6px 18px rgba(11,12,42,.3)" }}>
          Submitted — your team lead reviews this before it counts as fully complete.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, background: `${tone}12`, border: `1px solid ${tone}40`, borderRadius: 9, padding: "6px 12px" }}>
      <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: tone }}>{value}</span>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: C.grayMute, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</span>
    </div>
  );
}

// ---- PLAYBOOK TAB ----
const MONTHS = ["July", "August", "September", "Oct/Nov"] as const;

function PlaybookTab({ phases, profile, canEdit, team, nameOf, accent, startTransition }: {
  phases: { id: string; label: string; title: string; sort_order: number; playbook_tasks: Task[] }[];
  profile: Profile; canEdit: boolean; team: { id: string; full_name: string }[];
  nameOf: (id: string | null, label?: string | null) => string;
  accent: string;
  startTransition: (cb: () => void) => void;
}) {
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set(phases.map((p) => p.id)));
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [filterAssignee, setFilterAssignee] = useState<string>("all"); // "all" | "unassigned" | "team" | profileId
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");
  const filtersActive = filterAssignee !== "all" || filterFrom !== "" || filterTo !== "";

  const matchesFilter = (t: Task): boolean => {
    if (filterAssignee === "team" && t.assignee_label !== "team") return false;
    if (filterAssignee === "unassigned" && (t.assignee_id || t.assignee_label === "team")) return false;
    if (filterAssignee !== "all" && filterAssignee !== "team" && filterAssignee !== "unassigned" && t.assignee_id !== filterAssignee) return false;
    if ((filterFrom || filterTo) && !t.due_date) return false;
    if (filterFrom && t.due_date && t.due_date < filterFrom) return false;
    if (filterTo && t.due_date && t.due_date > filterTo) return false;
    return true;
  };

  const toggleRole = (id: string) => setExpandedRoles((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleNote = (id: string) => setExpandedNotes((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Completion overview
  const allTasks = phases.flatMap((p) => p.playbook_tasks);
  const totalTasks = allTasks.length;
  const doneTasks  = allTasks.filter((t) => t.done).length;
  const overallPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // Lead progress: on-time vs late completions, overdue, and per-person rollup.
  const progress = useMemo(() => {
    const today = TODAY_STR();
    let onTime = 0, late = 0, overdue = 0;
    for (const t of allTasks) {
      const k = dueClass(t, today);
      if (k === "on_time" && t.done) onTime++;
      else if (k === "late") late++;
      else if (k === "overdue") overdue++;
    }
    const perPerson = team.map((m) => {
      const mine = allTasks.filter((t) => effAssignees(t).includes(m.id));
      const done = mine.filter((t) => compStateOf(t, m.id) === "confirmed").length;
      return { id: m.id, name: m.full_name, total: mine.length, done };
    }).filter((p) => p.total > 0).sort((a, b) => b.total - a.total);
    return { onTime, late, overdue, perPerson };
  }, [allTasks, team]);

  function makeTask(phaseId: string, monthLabel: string) {
    startTransition(() => {
      upsertTask({ phase_id: phaseId, text: "New task", assignee_id: null, assignee_label: null, month_label: monthLabel, notes: null, due_date: null, done: false });
    });
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14, marginBottom: 6 }}>
        <div>
          <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Playbook</h1>
          <p style={{ color: C.grayMute, margin: "4px 0 0" }}>{canEdit ? "Role-based recruitment plan. Edit inline — changes save automatically." : "Your team's recruitment plan."}</p>
        </div>
        {canEdit && (
          <button onClick={() => startTransition(() => { addPhase(profile.school_id ?? "", "Role", `New Role ${phases.length + 1}`, phases.length); })}
            style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 600, padding: "10px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13.5 }}>+ Add role</button>
        )}
      </div>

      {/* Completion overview */}
      {totalTasks > 0 && (
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 20px", marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: C.navy }}>{doneTasks} / {totalTasks} tasks complete</div>
            <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 22, color: overallPct >= 80 ? C.good : overallPct >= 50 ? C.gold : C.orange }}>{overallPct}%</div>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: C.line, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${overallPct}%`, background: overallPct >= 80 ? C.good : overallPct >= 50 ? C.gold : C.orange, borderRadius: 99, transition: "width .6s" }} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", marginTop: 12 }}>
            {phases.map((p) => {
              const total = p.playbook_tasks.length;
              const done  = p.playbook_tasks.filter((t) => t.done).length;
              const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180 }}>
                  <div style={{ fontSize: 12, color: C.grayMute, fontWeight: 600, flex: 1 }}>{p.title}</div>
                  <div style={{ width: 60, height: 4, borderRadius: 99, background: C.line, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: pct >= 80 ? C.good : pct >= 50 ? C.gold : C.orange, borderRadius: 99 }} />
                  </div>
                  <div style={{ fontSize: 11, color: C.grayMute, width: 30, textAlign: "right" }}>{pct}%</div>
                </div>
              );
            })}
          </div>

          {/* Lead progress: timeliness + per-person rollup */}
          {canEdit && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <Stat label="On time" value={progress.onTime} tone={C.good} />
                <Stat label="Late" value={progress.late} tone={C.gold} />
                <Stat label="Overdue" value={progress.overdue} tone={C.orange} />
              </div>
              {progress.perPerson.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
                  {progress.perPerson.map((p) => {
                    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
                    return (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 200 }}>
                        <div style={{ fontSize: 12, color: C.gray, fontWeight: 600, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                        <div style={{ width: 60, height: 4, borderRadius: 99, background: C.line, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: pct >= 80 ? C.good : pct >= 50 ? C.gold : C.orange, borderRadius: 99 }} />
                        </div>
                        <div style={{ fontSize: 11, color: C.grayMute, width: 48, textAlign: "right" }}>{p.done}/{p.total}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      {phases.length > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 0.5 }}>Filter</span>
          <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}
            style={{ padding: "8px 11px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13, background: "#fff", color: C.gray, fontWeight: 600 }}>
            <option value="all">Anyone</option>
            <option value="team">Whole team</option>
            <option value="unassigned">Unassigned</option>
            {team.map((t) => <option key={t.id} value={t.id}>{t.id === profile.id ? `${t.full_name} (me)` : t.full_name}</option>)}
          </select>
          <span style={{ fontSize: 12.5, color: C.grayMute }}>Due</span>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13 }} />
          <span style={{ fontSize: 12.5, color: C.grayMute }}>to</span>
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13 }} />
          {filtersActive && (
            <button onClick={() => { setFilterAssignee("all"); setFilterFrom(""); setFilterTo(""); }}
              style={{ padding: "8px 12px", borderRadius: 9, border: "none", background: "transparent", color: C.navy2, fontSize: 13, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Clear</button>
          )}
        </div>
      )}

      {/* Roles */}
      {phases.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 2 }}>
          <button onClick={() => {
            const allExpanded = phases.every((p) => expandedRoles.has(p.id));
            setExpandedRoles(allExpanded ? new Set() : new Set(phases.map((p) => p.id)));
          }} style={{ border: "none", background: "none", color: C.grayMute, fontWeight: 600, fontSize: 12, cursor: "pointer", padding: "4px 2px" }}>
            {phases.every((p) => expandedRoles.has(p.id)) ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {phases.map((p) => {
          if (filtersActive && !p.playbook_tasks.some(matchesFilter)) return null;
          const isExpanded = expandedRoles.has(p.id);
          const roleDone  = p.playbook_tasks.filter((t) => t.done).length;
          return (
            <div key={p.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14 }}>
              {/* Role header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: isExpanded ? `1px solid ${C.line}` : "none", cursor: "pointer" }}
                onClick={() => toggleRole(p.id)}>
                {canEdit ? (
                  <input defaultValue={p.title} onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { if (e.target.value.trim() !== p.title) startTransition(() => { updatePhase(p.id, p.label, e.target.value.trim() || p.title); }); }}
                    style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: C.navy, border: "none", background: "transparent", flex: 1, outline: "none", cursor: "text" }} />
                ) : (
                  <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: C.navy, flex: 1 }}>{p.title}</div>
                )}
                <span style={{ fontSize: 12, color: C.grayMute, fontWeight: 600 }}>{roleDone}/{p.playbook_tasks.length}</span>
                {canEdit && (
                  <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete role "${p.title}" and all its tasks?`)) startTransition(() => { deletePhase(p.id); }); }}
                    style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 13, padding: "2px 6px", borderRadius: 6 }}>Delete</button>
                )}
                <span style={{ color: C.grayMute, fontSize: 16 }}>{isExpanded ? "▲" : "▼"}</span>
              </div>

              {/* Month groups */}
              {isExpanded && (
                <div style={{ padding: "0 18px 14px" }}>
                  {MONTHS.map((month) => {
                    const mTasks = p.playbook_tasks.filter((t) => (t.month_label ?? "July") === month && matchesFilter(t));
                    if (!mTasks.length && (!canEdit || filtersActive)) return null;
                    return (
                      <div key={month} style={{ marginTop: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: accent, letterSpacing: 0.8, flex: 1 }}>{month}</div>
                          {canEdit && (
                            <button onClick={() => makeTask(p.id, month)}
                              style={{ border: `1px dashed ${C.line}`, background: "transparent", color: C.navy2, fontWeight: 600, fontSize: 11, padding: "3px 10px", borderRadius: 7, cursor: "pointer" }}>+ Add task</button>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {mTasks.map((t) => (
                            <TaskRow key={t.id} task={t} phase={p} canEdit={canEdit} team={team} profile={profile}
                              noteOpen={expandedNotes.has(t.id)} onToggleNote={() => toggleNote(t.id)}
                              accent={accent} startTransition={startTransition} />
                          ))}
                          {mTasks.length === 0 && (
                            <div style={{ fontSize: 12, color: C.grayMute, fontStyle: "italic", padding: "4px 0" }}>No tasks for {month} — add one above.</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {phases.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>
            {canEdit ? "No roles yet — add the first role above." : "No playbook yet."}
          </div>
        )}
      </div>
    </>
  );
}

function TaskRow({ task: t, phase, canEdit, team, profile, noteOpen, onToggleNote, accent, startTransition }: {
  task: Task; phase: { id: string; title: string };
  canEdit: boolean; team: { id: string; full_name: string; role?: string | null }[];
  profile: Profile; noteOpen: boolean; onToggleNote: () => void;
  accent: string;
  startTransition: (cb: () => void) => void;
}) {
  const [noteText, setNoteText] = useState(t.notes ?? "");

  const save = (patch: Partial<Task>) => startTransition(() => {
    upsertTask({ id: t.id, phase_id: phase.id, text: t.text, assignee_id: t.assignee_id, assignee_label: t.assignee_label, month_label: t.month_label, notes: t.notes, due_date: t.due_date, done: t.done, ...patch });
  });

  const assignees = effAssignees(t);
  const isTeam = t.assignee_label === "team";
  const iAmAssignee = assignees.includes(profile.id);
  const myState = compStateOf(t, profile.id);
  const addable = team.filter((tm) => !assignees.includes(tm.id));

  const toggleMine = () => startTransition(() => {
    const on = myState === "confirmed" || myState === "pending_review";
    if (canEdit) confirmTaskComplete(t.id, !on, profile.id);
    else requestTaskComplete(t.id, !on);
  });
  const toggleAssignee = (id: string) => startTransition(() => {
    const st = compStateOf(t, id);
    confirmTaskComplete(t.id, st !== "confirmed", id); // leads confirm / un-confirm a person
  });

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${C.line}`, background: t.done ? "#FAFBFE" : "#fff", marginBottom: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px" }}>
        {canEdit ? (
          <input type="checkbox" checked={t.done} title="Mark the whole task complete"
            onChange={(e) => startTransition(() => { confirmTaskComplete(t.id, e.target.checked); })}
            style={{ accentColor: "#11123E", flexShrink: 0, width: 16, height: 16 }} />
        ) : (
          <CompletionBubble state={iAmAssignee ? myState : (t.done ? "confirmed" : undefined)} accent={C.navy}
            disabled={!iAmAssignee} onToggle={toggleMine} size={18} />
        )}

        {canEdit ? (
          <input defaultValue={t.text}
            onBlur={(e) => { if (e.target.value.trim() !== t.text) save({ text: e.target.value.trim() || t.text }); }}
            style={{ flex: 1, border: "none", background: "transparent", fontSize: 13.5, color: t.done ? C.grayMute : C.gray, textDecoration: t.done ? "line-through" : "none", outline: "none", minWidth: 0 }} />
        ) : (
          <span style={{ flex: 1, fontSize: 13.5, color: t.done ? C.grayMute : C.gray, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
        )}

        {(() => {
          const overdue = !t.done && !!t.due_date && t.due_date < TODAY_STR();
          if (canEdit) {
            return (
              <input type="date" value={t.due_date ?? ""} title="Due date"
                onChange={(e) => save({ due_date: e.target.value || null })}
                style={{ fontSize: 11.5, color: overdue ? C.orange : (t.due_date ? C.navy2 : C.grayMute), border: `1px solid ${overdue ? C.orange : C.line}`, borderRadius: 6, padding: "3px 5px", background: "#fff", flexShrink: 0 }} />
            );
          }
          return t.due_date ? (
            <span title="Due date" style={{ fontSize: 11.5, fontWeight: 700, color: overdue ? C.orange : C.navy2, flexShrink: 0, whiteSpace: "nowrap" }}>
              {overdue ? "⚠ " : ""}{fmtDue(t.due_date)}
            </span>
          ) : null;
        })()}

        <button onClick={onToggleNote} title={noteOpen ? "Hide notes" : "Show notes"}
          style={{ border: "none", background: "none", cursor: "pointer", fontSize: 15, color: (t.notes?.trim()) ? C.navy2 : C.grayMute, flexShrink: 0, padding: "0 4px" }}>
          {noteOpen ? "▲" : "📝"}
        </button>

        {canEdit && (
          <button onClick={() => startTransition(() => { deleteTask(t.id); })}
            style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 16, flexShrink: 0, padding: "0 2px" }}>×</button>
        )}
      </div>

      {/* Assignees row — chips with per-person completion bubbles */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "0 12px 9px 34px" }}>
        {isTeam ? (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.navy2, background: `${C.navy2}14`, padding: "3px 9px", borderRadius: 999 }}>Whole team</span>
        ) : assignees.length === 0 ? (
          <span style={{ fontSize: 11.5, color: C.orange, fontWeight: 600 }}>Unassigned</span>
        ) : assignees.map((id) => {
          const st = compStateOf(t, id);
          const me = id === profile.id;
          const name = me ? "You" : (team.find((m) => m.id === id)?.full_name ?? "—");
          const interactive = canEdit || me;
          return (
            <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: C.gray, background: C.canvas, border: `1px solid ${C.line}`, padding: "2px 7px 2px 4px", borderRadius: 999 }}>
              <CompletionBubble state={st} accent={accent} size={15} disabled={!interactive}
                onToggle={() => { if (canEdit) toggleAssignee(id); else if (me) toggleMine(); }} />
              {name}
              {canEdit && (
                <button onClick={() => startTransition(() => { setTaskAssignees(t.id, assignees.filter((x) => x !== id)); })}
                  title="Remove" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 1px" }}>×</button>
              )}
            </span>
          );
        })}
        {canEdit && !isTeam && addable.length > 0 && (
          <div style={{ minWidth: 130 }}>
            <PersonPicker value={null} options={addable} meId={profile.id} accent={accent} compact
              placeholder="Add person…" unassignedLabel="+ Assign person"
              onChange={(v) => { if (v) startTransition(() => { setTaskAssignees(t.id, [...assignees, v]); }); }} />
          </div>
        )}
        {canEdit && (
          <button onClick={() => startTransition(() => {
            if (isTeam) { save({ assignee_label: null }); }
            else { setTaskAssignees(t.id, []); save({ assignee_label: "team" }); }
          })}
            style={{ border: `1px solid ${isTeam ? C.navy2 : C.line}`, background: isTeam ? `${C.navy2}14` : "#fff", color: isTeam ? C.navy2 : C.grayMute, fontWeight: 600, fontSize: 11, padding: "3px 9px", borderRadius: 999, cursor: "pointer" }}>
            {isTeam ? "✓ Team" : "Team"}
          </button>
        )}
      </div>

      {noteOpen && (
        <div style={{ padding: "0 12px 10px 36px" }}>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
            onBlur={() => { if (noteText !== (t.notes ?? "")) save({ notes: noteText || null }); }}
            placeholder="Add notes…" disabled={!canEdit}
            style={{ width: "100%", minHeight: 60, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 13, color: C.gray, resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", background: canEdit ? "#fff" : "#F7F8FB" }} />
        </div>
      )}
    </div>
  );
}

type Connection = { id: string; fellow_id: string; name: string; relationship: string; tagged_profile_id?: string | null };
const REL_QUICK = ["Knows personally", "Went to school together", "Worked together", "Alumni connection", "Mutual friend"];

function CandidateDrawer({ c, canEdit, profile, team, allProfiles, onClose, startTransition, onResume }: {
  c: Cand; canEdit: boolean; profile: Profile; team: TeamMember[];
  allProfiles: { id: string; full_name: string }[];
  onClose: () => void; startTransition: (cb: () => void) => void;
  onResume: (jazzId: string, name: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<{ id: string; body: string; created_at: string; author_id: string | null }[] | null>(null);
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [relDraft, setRelDraft] = useState("");
  const [tagId, setTagId] = useState<string | null>(null); // optional person to tag on a warm intro
  const profileName = (id: string | null) => (id === profile.id ? "You" : allProfiles.find((p) => p.id === id)?.full_name ?? "Someone");
  const QUICK = ["Called — left voicemail", "Emailed", "Met in person", "Scheduled follow-up"];

  useEffect(() => {
    let active = true;
    Promise.all([getOutreach(c.id), getConnections(c.id)]).then(([outreach, connections]) => {
      if (!active) return;
      setLog((("log" in outreach ? outreach.log : []) as any) ?? []);
      setConns(("connections" in connections ? connections.connections : []) as Connection[]);
    });
    return () => { active = false; };
  }, [c.id]);

  const doAddConn = (rel: string) => {
    if (!rel.trim()) return;
    const tagged = tagId;
    const tempId = `temp-${Math.random()}`;
    setConns((prev) => [{ id: tempId, fellow_id: profile.id, name: "You", relationship: rel.trim(), tagged_profile_id: tagged }, ...(prev ?? [])]);
    setRelDraft("");
    setTagId(null);
    addConnection(c.id, rel.trim(), tagged).then((res) => {
      if (res && "error" in res && res.error) {
        setConns((prev) => (prev ?? []).filter((cn) => cn.id !== tempId)); // revert
        alert(`Couldn't save warm intro: ${res.error}`);
      }
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
    setLog((prev) => [{ id: Math.random().toString(), body, created_at: new Date().toISOString(), author_id: profile.id }, ...(prev ?? [])]);
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
          <h2 style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 24, margin: "0 0 2px" }}>{c.name}</h2>
          <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.72)" }}>{c.area_of_study}</div>
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.6)", marginTop: 3 }}>Added by {c.created_by ? profileName(c.created_by) : (c.source === "jazzhr" ? "JazzHR sync" : "—")}</div>
          <div style={{ marginTop: 12 }}><StagePill stage={c.stage} /></div>
        </div>
        <div style={{ padding: 24 }}>
          {!canEdit && (
            <div style={{ background: "#EEF1F7", borderRadius: 9, padding: "8px 12px", marginBottom: 14, fontSize: 12.5, color: C.grayMute }}>
              You can log a warm intro for anyone. Editing candidate info and outreach is limited to the assigned point person.
            </div>
          )}
          {canEdit && (
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <button onClick={() => startTransition(() => { toggleFavorite(c.id, !c.is_favorite); })} style={{ flex: 1, border: `1px solid ${c.is_favorite ? C.gold : C.line}`, background: c.is_favorite ? "#FBF3D6" : "#fff", color: c.is_favorite ? "#8A6D0E" : C.gray, fontWeight: 700, padding: 10, borderRadius: 9, cursor: "pointer", fontSize: 13 }}>{c.is_favorite ? "★ Favorited" : "☆ Favorite"}</button>
              <button onClick={() => startTransition(() => { setNotInterested(c.id, !c.not_interested); })} style={{ flex: 1, border: `1px solid ${C.line}`, background: c.not_interested ? "#EFEFF2" : "#fff", color: C.gray, fontWeight: 700, padding: 10, borderRadius: 9, cursor: "pointer", fontSize: 13 }}>{c.not_interested ? "Unflag" : "Flag not interested"}</button>
            </div>
          )}

          {[["Email", c.email], ["GPA", c.gpa]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>{k}</span><span style={{ fontSize: 13, color: C.gray, fontWeight: 600 }}>{v ?? "—"}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, margin: "16px 0 20px" }}>
            <a href={c.linkedin ?? "#"} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, textAlign: "center", textDecoration: "none", border: `1px solid ${C.line}`, background: "#fff", color: c.linkedin ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, pointerEvents: c.linkedin ? "auto" : "none" }}>LinkedIn ↗</a>
            <button
              onClick={() => { if (c.jazz_id) onResume(c.jazz_id, c.name); }}
              disabled={!c.jazz_id}
              style={{ flex: 1, textAlign: "center", border: `1px solid ${C.line}`, background: "#fff", color: c.jazz_id ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, cursor: c.jazz_id ? "pointer" : "not-allowed" }}>Résumé</button>
          </div>

          {/* warm-intro finder */}
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
            <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, marginBottom: 10, letterSpacing: 0.8 }}>Warm Intros</div>
            {conns === null ? (
              <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>Loading…</div>
            ) : conns.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {conns.map((cn) => {
                  const creator = cn.fellow_id === profile.id ? "You" : (cn.name || profileName(cn.fellow_id));
                  const tagged = cn.tagged_profile_id ? profileName(cn.tagged_profile_id) : null;
                  return (
                    <div key={cn.id} style={{ fontSize: 13, color: C.gray, display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 16, color: tagged ? C.gold : C.gray, lineHeight: 1.3 }}>●</span>
                      <span style={{ flex: 1 }}>
                        {tagged
                          ? <><b>{creator}</b> tagged <b>{tagged}</b> to reach out</>
                          : <><b>{creator}</b> knows this candidate</>}
                        {cn.relationship && <span style={{ color: C.grayMute }}> · {cn.relationship}</span>}
                      </span>
                      {(cn.fellow_id === profile.id || canEdit) && <button onClick={() => doDelConn(cn.id)} title="Remove" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }}>×</button>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic", marginBottom: 10 }}>No connections logged yet.</div>
            )}
            {/* Anyone can log a warm intro — even for a candidate they don't own.
                Optionally tag a person (anyone, any school); they get notified. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, color: C.grayMute, fontWeight: 600, flexShrink: 0 }}>Who knows them?</span>
              <div style={{ flex: 1 }}>
                <PersonPicker value={tagId} options={allProfiles} meId={profile.id} accent={C.gold} compact
                  unassignedLabel="You" placeholder="Tag anyone…"
                  onChange={(v) => setTagId(v)} />
              </div>
            </div>
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
          {canEdit && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {QUICK.map((q) => <button key={q} onClick={() => doLog(q)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 600, fontSize: 12, padding: "6px 11px", borderRadius: 999, cursor: "pointer" }}>+ {q}</button>)}
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a note…" style={{ flex: 1, padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
                <button onClick={() => { if (draft.trim()) { doLog(draft.trim()); setDraft(""); } }} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 600, padding: "0 16px", borderRadius: 9, cursor: "pointer" }}>Log</button>
              </div>
            </>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(log ?? []).map((n) => {
              const authorName = n.author_id === profile.id ? "You" : (team.find((t) => t.id === n.author_id)?.full_name ?? "Someone");
              const dateStr = new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              return (
              <div key={n.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 13px", fontSize: 13, color: C.gray, display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div>{n.body}</div>
                  <div style={{ fontSize: 11, color: C.grayMute, marginTop: 4 }}>{authorName} · {dateStr}</div>
                </div>
                {canEdit && <button onClick={() => doDelLog(n.id)} title="Remove" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 15, lineHeight: 1, flexShrink: 0, padding: "0 2px" }}>×</button>}
              </div>
              );
            })}
            {(log ?? []).length === 0 && <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>No outreach logged yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
