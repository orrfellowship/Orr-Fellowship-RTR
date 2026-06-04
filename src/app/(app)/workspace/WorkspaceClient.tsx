"use client";

import { useState, useMemo, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { canReassign, canEditPlaybook } from "@/lib/types";
import {
  toggleFavorite, setNotInterested, logOutreach, reassignPointPerson,
  getOutreach, addConnection, getConnections, upsertTask, deleteTask, addPhase,
  deleteOutreach, deleteConnection, updatePhase, deletePhase,
  requestTaskComplete, confirmTaskComplete,
} from "./actions";
import { phaseOf } from "@/lib/stages";
import StandingsClient from "@/components/StandingsClient";
import ResumeModal from "@/components/ResumeModal";
import BulkImportModal from "@/components/BulkImportModal";

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
};
type School      = { id: string; name: string; color_primary: string | null; logo_url: string | null };
type AllSchool   = { id: string; name: string; tier: string; color_primary: string | null; logo_url: string | null };
type AllCand     = { id: string; name: string; email: string | null; school_id: string | null; stage: string | null; gpa: string | null; area_of_study: string | null; jazz_id: string | null; linkedin: string | null; point_person_id: string | null; not_interested: boolean; resume_link: string | null; is_favorite: boolean };
type AllGoal     = { school_id: string; goal_sourced: number; goal_contacted: number; goal_applied: number };
type TeamMember  = { id: string; full_name: string; role?: string | null };
type Task        = {
  id: string; text: string; assignee_id: string | null; assignee_label: string | null;
  month_label: string | null; notes: string | null; due_date: string | null; done: boolean;
  pending_review?: boolean;
};
type Phase       = { id: string; label: string; title: string; sort_order: number; playbook_tasks: Task[] };

const PHASE_OF: Record<string, string> = { new: "Sourced", contacted: "Contacted", applied: "Applied", bmi: "Advanced", finalist: "Finalist", fellow: "Fellow" };
const phaseTone: Record<string, string> = { Sourced: C.navy3, Contacted: C.blue, Applied: C.navy2, Advanced: C.orange, Finalist: C.gold, Fellow: C.good };
function StagePill({ stage }: { stage: string | null }) {
  const ph = stage ? PHASE_OF[stage] ?? "Sourced" : "Sourced";
  const tone = phaseTone[ph];
  return <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: tone, background: `${tone}22`, padding: "4px 9px", borderRadius: 999 }}>{stage ?? "—"}</span>;
}

const SOURCED  = new Set(["new", "contacted", "applied", "bmi", "finalist", "fellow"]);
const CONTACTD = new Set(["contacted", "applied", "bmi", "finalist", "fellow"]);
const APPLIED  = new Set(["applied", "bmi", "finalist", "fellow"]);

export default function WorkspaceClient({
  profile, school, candidates, team, phases, allSchools, allCandidates, allGoals, groupName, lastContactByCand,
}: {
  profile: Profile; school: School | null; candidates: Cand[]; team: TeamMember[]; phases: Phase[];
  allSchools: AllSchool[]; allCandidates: AllCand[]; allGoals: AllGoal[]; groupName?: string | null;
  lastContactByCand: Record<string, string>;
}) {
  const [tab, setTab] = useState<"plan" | "board" | "playbook" | "standings" | "all">("plan");
  const [breakdownScope, setBreakdownScope] = useState<"team" | "org">("team");
  const [allFilter, setAllFilter] = useState<string>("All schools");
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [resumeFor, setResumeFor] = useState<{ jazzId: string; name: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const canEdit = canEditPlaybook(profile.role);
  const canAssign = canReassign(profile.role);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
  }
  const accent = school?.color_primary ?? C.orange;

  const nameOf = (id: string | null, label?: string | null): string => {
    if (label === "team") return "Team";
    if (!id) return "Unassigned";
    if (id === profile.id) return "You";
    return team.find((t) => t.id === id)?.full_name ?? "—";
  };
  // The drawer can open a candidate from the user's school (always editable) or
  // from the org-wide Applicants tab (editable only if assigned to this user).
  const openFromSchool = candidates.find((c) => c.id === openId) ?? null;
  const openFromAll = allCandidates.find((c) => c.id === openId) ?? null;
  const open: Cand | null = openFromSchool ?? (openFromAll as Cand | null);
  const openCanEdit = openFromSchool ? true : (openFromAll ? openFromAll.point_person_id === profile.id : false);

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
    const out: { id: string; type: string; cand: Cand; why: string; rank: number }[] = [];
    const now = Date.now();
    const DAY = 86400000;
    for (const c of candidates) {
      if (c.not_interested) continue;
      const mine = c.point_person_id === profile.id;
      const ph = phaseOf(c.stage);
      if (ph === "rejected" || ph === "moved") continue;
      const last = lastContactByCand[c.id];
      const days = last ? Math.floor((now - new Date(last).getTime()) / DAY) : Infinity;

      if (ph === "applied" && mine) {
        out.push({ id: `a${c.id}`, type: "Applied", cand: c, why: "They applied — anything needed from you?", rank: 0 });
      } else if (ph === "finalist" && mine) {
        out.push({ id: `f${c.id}`, type: "Finalist prep", cand: c, why: "Confirm logistics", rank: 1 });
      } else if (ph === "sourced" && !c.point_person_id) {
        out.push({ id: `u${c.id}`, type: "Claim", cand: c, why: "New & unclaimed", rank: 4 });
      } else if (mine && (ph === "sourced" || ph === "contacted")) {
        if (!last) out.push({ id: `x${c.id}`, type: "Next step", cand: c, why: "You claimed them — log your first outreach", rank: 3 });
        else if (days >= 10) out.push({ id: `t${c.id}`, type: "Follow up", cand: c, why: `No contact in ${days} days`, rank: 2 });
        else if (days >= 3) out.push({ id: `r${c.id}`, type: "Rapport", cand: c, why: "Warm now — quick intro message?", rank: 3 });
      }
    }
    return out.sort((a, b) => a.rank - b.rank);
  }, [candidates, lastContactByCand, profile.id]);

  // Team-lead review: tasks fellows marked done, awaiting confirmation.
  const pendingReviewTasks = useMemo(() => {
    if (!canEdit) return [] as { task: Task; roleTitle: string }[];
    const out: { task: Task; roleTitle: string }[] = [];
    for (const p of phases) for (const t of p.playbook_tasks) {
      if (t.pending_review && !t.done) out.push({ task: t, roleTitle: p.title });
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
        if (t.assignee_id === profile.id) results.push({ task: t, roleTitle: p.title });
      }
    }
    return results;
  }, [phases, profile.id]);

  const MONTHS = ["July", "August", "September", "Oct/Nov"];

  return (
    <div style={{ minHeight: "100vh", background: C.canvas }}>
      <div style={{ background: C.navy, padding: "0 28px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
            <div style={{ padding: "14px 0", display: "flex", alignItems: "center", gap: 10 }}>
              {school?.logo_url && (
                <img src={school.logo_url} alt={school.name} style={{ height: 32, width: 32, objectFit: "contain", borderRadius: 6, background: "rgba(255,255,255,.12)", padding: 3 }} />
              )}
              <div>
                <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16, color: "#fff" }}>{groupName ?? school?.name ?? "Orr Recruiting"}</div>
                <div style={{ fontSize: 10, letterSpacing: 1.5, color: "rgba(255,255,255,.45)", textTransform: "uppercase" }}>{profile.role === "team_lead" ? "Team Lead" : "Fellow"} Workspace</div>
              </div>
            </div>
            {([
              ["plan",      `Weekly Snapshot`],
              ["board",     "My School"],
              ["playbook",  "Playbook"],
              ["standings", "Standings"],
              ["all",       "Applicants"],
            ] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k as any)} style={{ border: "none", background: "none", cursor: "pointer", padding: "15px 0", fontFamily: HEAD, fontSize: 14.5, fontWeight: tab === k ? 700 : 600, color: tab === k ? "#fff" : "rgba(255,255,255,.55)", borderBottom: tab === k ? `3px solid ${accent}` : "3px solid transparent" }}>{l}</button>
            ))}
            <a href="/how-to" style={{ padding: "15px 0", fontFamily: HEAD, fontSize: 14.5, fontWeight: 600, color: "rgba(255,255,255,.55)", textDecoration: "none" }}>How-To</a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{profile.full_name}</div>
            <button onClick={signOut} style={{ border: "1px solid rgba(255,255,255,.3)", background: "transparent", color: "rgba(255,255,255,.75)", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 8, cursor: "pointer" }}>Sign out</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 28px 80px", opacity: pending ? 0.7 : 1 }}>

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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 26, alignItems: "start" }}>

              {/* Action Queue */}
              <div>
                <h2 style={{ fontSize: 20, color: C.navy, margin: "0 0 12px", fontFamily: HEAD }}>Action Queue</h2>

                {/* Team-lead review of completed tasks */}
                {pendingReviewTasks.length > 0 && (
                  <div style={{ background: "#fff", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
                    <div style={{ fontFamily: HEAD, fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#8A6D0E", marginBottom: 10 }}>Review completed work · {pendingReviewTasks.length}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {pendingReviewTasks.map(({ task: t, roleTitle }) => (
                        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.line}` }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13.5, color: C.gray, fontWeight: 600 }}>{t.text}</div>
                            <div style={{ fontSize: 11, color: C.grayMute }}>{team.find((m) => m.id === t.assignee_id)?.full_name ?? "Someone"} · {roleTitle}</div>
                          </div>
                          <button onClick={() => startTransition(() => { confirmTaskComplete(t.id, true); })}
                            style={{ border: "none", background: C.good, color: "#fff", fontWeight: 700, fontSize: 12, padding: "6px 11px", borderRadius: 7, cursor: "pointer", flexShrink: 0 }}>Confirm</button>
                          <button onClick={() => startTransition(() => { requestTaskComplete(t.id, false); })}
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
                  <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 600, color: C.grayMute }}>{myTasks.filter((m) => m.task.done).length}/{myTasks.length} done</span>
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
                          const pending = !!t.pending_review && !t.done;
                          const checked = t.done || pending;
                          const onToggle = (val: boolean) => startTransition(() => {
                            if (canEdit) confirmTaskComplete(t.id, val);   // leads confirm directly
                            else requestTaskComplete(t.id, val);            // fellows send for review
                          });
                          return (
                            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${C.line}`, opacity: t.done ? 0.55 : 1 }}>
                              <input type="checkbox" checked={checked} disabled={!canEdit && t.done}
                                onChange={(e) => onToggle(e.target.checked)}
                                style={{ accentColor: pending ? C.gold : accent, flexShrink: 0, cursor: !canEdit && t.done ? "default" : "pointer" }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: 13.5, color: C.gray, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
                                {pending && <div style={{ fontSize: 11, color: "#8A6D0E", fontWeight: 600 }}>Completed · sent to team lead for review</div>}
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 18, marginTop: 16, alignItems: "start" }}>
              {/* Candidate table */}
              <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 0.6fr 1fr 1.2fr 40px", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#ececec" }}>
                  <div>Candidate</div><div>Major</div><div>GPA</div><div>Stage</div><div>Owner</div><div></div>
                </div>
                {boardVisible.map((c) => (
                  <div key={c.id} onClick={() => setOpenId(c.id)} onMouseEnter={() => setHoveredId(c.id)} onMouseLeave={() => setHoveredId(null)} style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 0.6fr 1fr 1.2fr 40px", padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", opacity: c.not_interested ? 0.5 : 1, cursor: "pointer", background: hoveredId === c.id ? C.canvas : "#ececec", transition: "background 0.1s" }}>
                    <div><div style={{ fontWeight: 700, fontSize: 14, color: C.gray }}>{c.name}</div><div style={{ fontSize: 12, color: C.grayMute }}>{c.email}</div></div>
                    <div style={{ fontSize: 13.5 }}>{c.area_of_study}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.gpa}</div>
                    <div><StagePill stage={c.stage} /></div>
                    <div onClick={(e) => e.stopPropagation()}>
                      {canAssign ? (
                        <select value={c.point_person_id ?? ""} onChange={(e) => startTransition(() => { reassignPointPerson(c.id, e.target.value || null); })}
                          style={{ fontSize: 12.5, fontWeight: 600, color: c.point_person_id ? C.navy : C.orange, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 7px", background: "#fff", cursor: "pointer" }}>
                          <option value="">Unassigned</option>
                          {team.map((t) => <option key={t.id} value={t.id}>{t.id === profile.id ? `${t.full_name} (me)` : t.full_name}</option>)}
                        </select>
                      ) : (
                        <span style={{ fontSize: 13, color: c.point_person_id ? C.grayMute : C.orange, fontWeight: 600 }}>{nameOf(c.point_person_id)}</span>
                      )}
                    </div>
                    <div onClick={(e) => { e.stopPropagation(); onFav(c); }} style={{ cursor: "pointer", fontSize: 18, color: c.is_favorite ? C.gold : "#D8DCE5", textAlign: "center" }}>{c.is_favorite ? "★" : "☆"}</div>
                  </div>
                ))}
                {boardVisible.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>{boardFiltersActive ? "No candidates match your search." : "No candidates yet — run a sync or add one."}</div>}
              </div>

              {/* Team panel */}
              <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, background: "#FAFBFE" }}>
                  <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, letterSpacing: 0.5 }}>Team · {team.length}</div>
                </div>
                {team.map((t) => {
                  const owned = candidates.filter((c) => c.point_person_id === t.id && !c.not_interested).length;
                  const isMe = t.id === profile.id;
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${C.line}` }}>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: isMe ? accent : C.navy, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                        {t.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: C.gray, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
          const schoolNameOf = (c: AllCand) => allSchools.find((s) => s.id === c.school_id)?.name ?? "";
          const stageRank: Record<string, number> = { Sourced: 0, Contacted: 1, Applied: 2, Advanced: 3, Finalist: 4, Fellow: 5 };
          const distinctMajors = Array.from(new Set(allCandidates.map((c) => c.area_of_study).filter((m): m is string => !!m))).sort((a, b) => a.localeCompare(b));
          const distinctStages = Array.from(new Set(allCandidates.map((c) => c.stage).filter((s): s is string => !!s))).sort((a, b) => a.localeCompare(b));

          const q = allSearch.trim().toLowerCase();
          const minGpa = parseFloat(allMinGpa);
          let visible = allCandidates.filter((c) => {
            if (allFilter !== "All schools" && schoolNameOf(c) !== allFilter) return false;
            if (q && !(`${c.name} ${c.email ?? ""} ${c.area_of_study ?? ""}`.toLowerCase().includes(q))) return false;
            if (allMajor !== "All majors" && c.area_of_study !== allMajor) return false;
            if (allStage !== "All stages" && c.stage !== allStage) return false;
            if (allFavOnly && !c.is_favorite) return false;
            if (allMineOnly && c.point_person_id !== profile.id) return false;
            if (!isNaN(minGpa)) { const g = parseFloat(c.gpa ?? ""); if (isNaN(g) || g < minGpa) return false; }
            return true;
          });

          const dir = allSort.dir === "asc" ? 1 : -1;
          visible = [...visible].sort((a, b) => {
            let av: number | string, bv: number | string;
            switch (allSort.key) {
              case "school": av = schoolNameOf(a) || "~"; bv = schoolNameOf(b) || "~"; break;
              case "major":  av = a.area_of_study ?? "~"; bv = b.area_of_study ?? "~"; break;
              case "gpa":    av = parseFloat(a.gpa ?? "") || -1; bv = parseFloat(b.gpa ?? "") || -1; break;
              case "stage":  av = stageRank[PHASE_OF[a.stage ?? ""] ?? ""] ?? -1; bv = stageRank[PHASE_OF[b.stage ?? ""] ?? ""] ?? -1; break;
              default:       av = a.name.toLowerCase(); bv = b.name.toLowerCase();
            }
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
          });

          const toggleSort = (key: typeof allSort.key) =>
            setAllSort((p) => p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
          const arrow = (key: typeof allSort.key) => allSort.key === key ? (allSort.dir === "asc" ? " ▲" : " ▼") : "";
          const SortHead = ({ k, label }: { k: typeof allSort.key; label: string }) => (
            <div onClick={() => toggleSort(k)} style={{ cursor: "pointer", userSelect: "none", color: allSort.key === k ? C.navy : C.grayMute }}>{label}{arrow(k)}</div>
          );
          const filtersActive = q || allMajor !== "All majors" || allStage !== "All stages" || allFavOnly || allMineOnly || allMinGpa.trim() !== "";

          return (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
                <div>
                  <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Applicants</h1>
                  <p style={{ color: C.grayMute, margin: "4px 0 0" }}>{visible.length} candidates · click a row to view details</p>
                </div>
                <button onClick={() => setBulkOpen(true)} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 700, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" }}>Bulk import</button>
              </div>

              {/* Filter bar */}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
                <input value={allSearch} onChange={(e) => setAllSearch(e.target.value)} placeholder="Search name, email, major…"
                  style={{ flex: "1 1 200px", minWidth: 160, padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
                <select value={allFilter} onChange={(e) => setAllFilter(e.target.value)} style={{ padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, background: "#fff", color: C.gray, fontWeight: 600 }}>
                  <option>All schools</option>
                  {allSchools.map((s) => <option key={s.id}>{s.name}</option>)}
                </select>
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
                  <button onClick={() => { setAllSearch(""); setAllMajor("All majors"); setAllStage("All stages"); setAllMinGpa(""); setAllFavOnly(false); setAllMineOnly(false); }}
                    style={{ padding: "9px 12px", borderRadius: 9, border: "none", background: "transparent", color: C.navy2, fontSize: 13, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                    Clear
                  </button>
                )}
              </div>

              <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 0.6fr 1fr 80px", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                  <SortHead k="name" label="Candidate" /><SortHead k="school" label="School" /><SortHead k="major" label="Major" /><SortHead k="gpa" label="GPA" /><SortHead k="stage" label="Stage" /><div></div>
                </div>
                {visible.map((c) => {
                  const sc = allSchools.find((s) => s.id === c.school_id);
                  const schoolAccent = sc?.color_primary ?? C.navy2;
                  const mine = c.point_person_id === profile.id;
                  return (
                    <div key={c.id} onClick={() => setOpenId(c.id)}
                      style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 0.6fr 1fr 80px", padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", cursor: "pointer", opacity: c.not_interested ? 0.5 : 1 }}
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
                {visible.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>{filtersActive ? "No candidates match these filters." : "No candidates yet."}</div>}
              </div>
            </>
          );
        })()}
      </div>

      {open && (
        <CandidateDrawer c={open} canEdit={openCanEdit} profile={profile} team={team} onClose={() => setOpenId(null)} startTransition={startTransition} onResume={(jazzId, name) => setResumeFor({ jazzId, name })} />
      )}
      {resumeFor && (
        <ResumeModal jazzId={resumeFor.jazzId} name={resumeFor.name} onClose={() => setResumeFor(null)} />
      )}
      {bulkOpen && (
        <BulkImportModal
          schools={allSchools}
          existingEmails={new Set(allCandidates.map((c) => c.email?.toLowerCase() ?? "").filter(Boolean))}
          onClose={() => setBulkOpen(false)}
        />
      )}
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
  const totalTasks = phases.reduce((s, p) => s + p.playbook_tasks.length, 0);
  const doneTasks  = phases.reduce((s, p) => s + p.playbook_tasks.filter((t) => t.done).length, 0);
  const overallPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

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
                    const mTasks = p.playbook_tasks.filter((t) => (t.month_label ?? "July") === month);
                    if (!mTasks.length && !canEdit) return null;
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
                              nameOf={nameOf} startTransition={startTransition} />
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

function TaskRow({ task: t, phase, canEdit, team, profile, noteOpen, onToggleNote, nameOf, startTransition }: {
  task: Task; phase: { id: string; title: string };
  canEdit: boolean; team: { id: string; full_name: string }[];
  profile: Profile; noteOpen: boolean; onToggleNote: () => void;
  nameOf: (id: string | null, label?: string | null) => string;
  startTransition: (cb: () => void) => void;
}) {
  const [noteText, setNoteText] = useState(t.notes ?? "");

  const save = (patch: Partial<Task>) => startTransition(() => {
    upsertTask({ id: t.id, phase_id: phase.id, text: t.text, assignee_id: t.assignee_id, assignee_label: t.assignee_label, month_label: t.month_label, notes: t.notes, due_date: t.due_date, done: t.done, ...patch });
  });

  const assigneeValue = t.assignee_label === "team" ? "team" : (t.assignee_id ?? "");

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${C.line}`, background: t.done ? "#FAFBFE" : "#fff", marginBottom: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px" }}>
        <input type="checkbox" checked={t.done} disabled={!canEdit}
          onChange={(e) => save({ done: e.target.checked })}
          style={{ accentColor: "#11123E", flexShrink: 0 }} />

        {canEdit ? (
          <input defaultValue={t.text}
            onBlur={(e) => { if (e.target.value.trim() !== t.text) save({ text: e.target.value.trim() || t.text }); }}
            style={{ flex: 1, border: "none", background: "transparent", fontSize: 13.5, color: t.done ? C.grayMute : C.gray, textDecoration: t.done ? "line-through" : "none", outline: "none", minWidth: 0 }} />
        ) : (
          <span style={{ flex: 1, fontSize: 13.5, color: t.done ? C.grayMute : C.gray, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
        )}

        {canEdit ? (
          <select value={assigneeValue}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "team") save({ assignee_id: null, assignee_label: "team" });
              else save({ assignee_id: val || null, assignee_label: null });
            }}
            style={{ fontSize: 12, fontWeight: 600, color: t.assignee_label === "team" ? C.navy2 : (t.assignee_id ? C.navy2 : C.orange), border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 6px", background: "#fff", flexShrink: 0 }}>
            <option value="">Unassigned</option>
            <option value="team">Team</option>
            {team.map((tm) => <option key={tm.id} value={tm.id}>{tm.id === profile.id ? `${tm.full_name} (me)` : tm.full_name}</option>)}
          </select>
        ) : (
          <span style={{ fontSize: 12, color: t.assignee_label === "team" ? C.navy2 : (t.assignee_id ? C.navy2 : C.orange), fontWeight: 600, flexShrink: 0 }}>
            {t.assignee_label === "team" ? "Whole team" : t.assignee_id ? (team.find((m) => m.id === t.assignee_id)?.full_name ?? "—") : "Unassigned"}
          </span>
        )}

        <button onClick={onToggleNote} title={noteOpen ? "Hide notes" : "Show notes"}
          style={{ border: "none", background: "none", cursor: "pointer", fontSize: 15, color: (t.notes?.trim()) ? C.navy2 : C.grayMute, flexShrink: 0, padding: "0 4px" }}>
          {noteOpen ? "▲" : "📝"}
        </button>

        {canEdit && (
          <button onClick={() => startTransition(() => { deleteTask(t.id); })}
            style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 16, flexShrink: 0, padding: "0 2px" }}>×</button>
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

type Connection = { id: string; fellow_id: string; name: string; relationship: string };
const REL_QUICK = ["Knows personally", "Went to school together", "Worked together", "Alumni connection", "Mutual friend"];

function CandidateDrawer({ c, canEdit, profile, team, onClose, startTransition, onResume }: {
  c: Cand; canEdit: boolean; profile: Profile; team: TeamMember[];
  onClose: () => void; startTransition: (cb: () => void) => void;
  onResume: (jazzId: string, name: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<{ id: string; body: string; created_at: string; author_id: string | null }[] | null>(null);
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [relDraft, setRelDraft] = useState("");
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
    startTransition(() => {
      addConnection(c.id, rel.trim());
      setConns((prev) => [{ id: Math.random().toString(), fellow_id: "", name: "You", relationship: rel.trim() }, ...(prev ?? [])]);
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
          <div style={{ marginTop: 12 }}><StagePill stage={c.stage} /></div>
        </div>
        <div style={{ padding: 24 }}>
          {!canEdit && (
            <div style={{ background: "#EEF1F7", borderRadius: 9, padding: "8px 12px", marginBottom: 14, fontSize: 12.5, color: C.grayMute }}>
              View only — you can log outreach and warm intros for candidates assigned to you.
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
                {conns.map((cn) => (
                  <div key={cn.id} style={{ fontSize: 13, color: C.gray, display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 16 }}>●</span>
                    <span style={{ flex: 1 }}><b>{cn.name}</b> — <span style={{ color: C.grayMute }}>{cn.relationship}</span></span>
                    {canEdit && <button onClick={() => doDelConn(cn.id)} title="Remove" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }}>×</button>}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic", marginBottom: 10 }}>No connections logged yet.</div>
            )}
            {canEdit && (
              <>
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
              </>
            )}
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
