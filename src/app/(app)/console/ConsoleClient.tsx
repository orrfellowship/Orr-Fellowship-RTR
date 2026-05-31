"use client";

import { useState, useMemo, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { isSuper, isAdminPlus } from "@/lib/types";
import {
  toggleFavorite, setNotInterested, logOutreach, getOutreach, getConnections,
  reassignPointPerson, reassignSchool, addConnection, addPhase, upsertTask, deleteTask, deletePhase, updatePhase,
  upsertGoal, upsertGroupGoal, updateUser, updateUserName, addCandidate, bulkImportCandidates, deleteOutreach, deleteConnection,
  deduplicateCandidates, inviteUser, seedPlaybook, removeUser,
} from "./actions";
import StandingsClient from "@/components/StandingsClient";
import { phaseOf, STAGE_CONFIG, routeToSchoolName } from "@/lib/stages";

const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD",
  orange: "#DD5434", blue: "#8AB9E2", gray: "#303333", grayMute: "#6E7385",
  line: "#E4E7EE", canvas: "#F7F8FB", gold: "#C9A227", good: "#2F8F6B",
};
const HEAD = "'Cabin', sans-serif";

type School = { id: string; name: string; tier: string; color_primary: string | null; logo_url: string | null };
type Cand = {
  id: string; jazz_id: string | null; name: string; email: string | null; school_id: string | null;
  stage: string | null; gpa: string | null; area_of_study: string | null; university_raw: string | null;
  linkedin: string | null; resume_link: string | null; grad_date: string | null;
  point_person_id: string | null; not_interested: boolean; is_favorite: boolean;
};
type TeamMember = { id: string; full_name: string };
type Goal = { school_id: string; goal_sourced: number; goal_contacted: number; goal_applied: number };
type AIFlag = { text: string; kind: "standout" | "concern" | "info" };
type AI = { candidate_id: string; resume_score: number | null; summary: string | null; flags: AIFlag[]; analyzed_at: string | null };
type Task = { id: string; text: string; assignee_id: string | null; assignee_label: string | null; month_label: string | null; notes: string | null; due_date: string | null; done: boolean };
type Phase = { id: string; label: string; title: string; sort_order: number; school_id: string; playbook_tasks: Task[] };
type UserProfile = { id: string; full_name: string; email: string; role: string; school_id: string | null; is_active: boolean };

const ALL_ROLES = ["super_admin", "admin", "team_lead", "fellow"] as const;

const PHASE_OF: Record<string, string> = { new: "Sourced", contacted: "Contacted", applied: "Applied", bmi: "Advanced", finalist: "Finalist", fellow: "Fellow" };
const phaseTone: Record<string, string> = { Sourced: C.navy3, Contacted: C.blue, Applied: C.navy2, Advanced: C.orange, Finalist: C.gold, Fellow: C.good };
function StagePill({ stage }: { stage: string | null }) {
  const ph = stage ? PHASE_OF[stage] ?? stage : "—";
  const tone = phaseTone[ph] ?? C.grayMute;
  return <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: tone, background: `${tone}22`, padding: "4px 9px", borderRadius: 999 }}>{stage ?? "—"}</span>;
}

const SOURCED = new Set(["new", "contacted", "applied", "bmi", "finalist", "fellow"]);
const CONTACTED = new Set(["contacted", "applied", "bmi", "finalist", "fellow"]);
const APPLIED = new Set(["applied", "bmi", "finalist", "fellow"]);

function fmtPct(actual: number, goal: number) {
  if (!goal || goal <= 0) return "—";
  const p = (actual / goal) * 100;
  return (p > 999 ? ">999" : p.toFixed(0)) + "%";
}

export default function ConsoleClient({
  profile, schools, candidates, team, goals, ai, phases, users,
}: {
  profile: Profile; schools: School[]; candidates: Cand[]; team: TeamMember[];
  goals: Goal[]; ai: AI[]; phases: Phase[]; users: UserProfile[];
}) {
  const [tab, setTab] = useState<"overview" | "applicants" | "standings" | "playbook" | "schools" | "users" | "sync">("overview");
  const [scope, setScope] = useState<string>("Org-wide");
  const [playbookSchool, setPlaybookSchool] = useState<string>(schools[0]?.id ?? "");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showUnrouted, setShowUnrouted] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [dedupMsg, setDedupMsg] = useState<string | null>(null);
  const [deduping, setDeduping] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const superUser = isSuper(profile.role);
  const adminPlus = isAdminPlus(profile.role);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
  }
  const aiMap = useMemo(() => new Map(ai.map((a) => [a.candidate_id, a as AI])), [ai]);
  const nameOf = (id: string | null) => id ? (id === profile.id ? "You" : team.find((t) => t.id === id)?.full_name ?? "—") : "Unassigned";

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
      else setSyncResult(`${data.partial ? "Partial (re-run to continue)" : "Complete"} · written ${data.written} · routed ${data.routed} · unrouted ${data.unrouted}${data.failed ? ` · failed ${data.failed}` : ""}${data.remaining ? ` · ${data.remaining} remaining` : ""}`);
    } catch (e: any) { setSyncError(e?.message ?? "Request failed"); }
    finally { setSyncing(false); }
  }

  // scoreboard totals
  const board = useMemo(() => {
    const inScope = (c: Cand) => scope === "Org-wide" || schools.find((s) => s.id === c.school_id)?.name === scope;
    const cands = candidates.filter(inScope);
    const scopeGoals = goals.filter((g) => scope === "Org-wide" || schools.find((s) => s.id === g.school_id)?.name === scope);
    return [
      { label: "Sourced", actual: cands.filter((c) => c.stage && SOURCED.has(c.stage)).length, goal: scopeGoals.reduce((a, g) => a + g.goal_sourced, 0) },
      { label: "Contacted", actual: cands.filter((c) => c.stage && CONTACTED.has(c.stage)).length, goal: scopeGoals.reduce((a, g) => a + g.goal_contacted, 0) },
      { label: "Applied", actual: cands.filter((c) => c.stage && APPLIED.has(c.stage)).length, goal: scopeGoals.reduce((a, g) => a + g.goal_applied, 0) },
    ];
  }, [scope, candidates, goals, schools]);

  const open = candidates.find((c) => c.id === openId) ?? null;
  const playbookPhases = phases.filter((p) => p.school_id === playbookSchool);
  const playbookSchoolObj = schools.find((s) => s.id === playbookSchool);

  // goal draft state: school_id → {sourced, contacted, applied}
  const [goalDrafts, setGoalDrafts] = useState<Record<string, { sourced: string; contacted: string; applied: string }>>({});
  const [goalSaved, setGoalSaved] = useState<Record<string, "saved" | "error">>({});
  // group goal draft state: tier → {sourced, contacted, applied}
  const [groupGoalDrafts, setGroupGoalDrafts] = useState<Record<string, { sourced: string; contacted: string; applied: string }>>({});
  const [groupGoalSaved, setGroupGoalSaved] = useState<Record<string, "saved" | "error">>({});
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

  const TABS: [string, string][] = [["overview", "Overview"], ["applicants", "Applicants"], ["standings", "Standings"], ["playbook", "Playbook"]];
  if (adminPlus) TABS.push(["schools", "Schools"]);
  if (superUser) TABS.push(["users", "Users"], ["sync", "Sync"]);

  return (
    <div style={{ minHeight: "100vh", background: C.canvas }}>
      <div style={{ background: C.navy, padding: "0 28px" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <div style={{ padding: "14px 0" }}>
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16, color: "#fff" }}>Orr Recruiting</div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: "rgba(255,255,255,.45)", textTransform: "uppercase" }}>{superUser ? "Super Admin" : "Admin"} Console</div>
            </div>
            {TABS.map(([k, l]) => (
              <button key={k} onClick={() => setTab(k as any)} style={{ border: "none", background: "none", cursor: "pointer", padding: "15px 0", fontFamily: HEAD, fontSize: 14.5, fontWeight: tab === k ? 700 : 600, color: tab === k ? "#fff" : "rgba(255,255,255,.55)", borderBottom: tab === k ? `3px solid ${C.orange}` : "3px solid transparent" }}>
                {l}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{profile.full_name}</div>
            <button onClick={signOut} style={{ border: "1px solid rgba(255,255,255,.3)", background: "transparent", color: "rgba(255,255,255,.75)", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 8, cursor: "pointer" }}>Sign out</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "30px 28px 80px", opacity: pending ? 0.7 : 1 }}>

        {/* ---- OVERVIEW ---- */}
        {tab === "overview" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
              <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Where the program stands</h1>
              <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 600 }}>
                <option>Org-wide</option>
                {schools.map((s) => <option key={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginTop: 22 }}>
              {board.map((b) => {
                const p = b.goal > 0 ? (b.actual / b.goal) * 100 : 0;
                const tone = p >= 100 ? C.good : p >= 70 ? C.gold : C.orange;
                return (
                  <div key={b.label} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
                    <div style={{ background: C.navy, color: "#fff", padding: "16px 20px", textAlign: "center" }}>
                      <div style={{ fontFamily: HEAD, fontSize: 13, fontWeight: 600, textTransform: "uppercase", opacity: 0.8 }}>{b.label}</div>
                      <div style={{ fontFamily: HEAD, fontSize: 40, fontWeight: 700, marginTop: 4 }}>{b.actual}</div>
                    </div>
                    <div style={{ padding: "12px 20px", textAlign: "center", borderBottom: `1px solid ${C.line}` }}>
                      <div style={{ fontSize: 12, color: C.grayMute, fontWeight: 600 }}>Goal</div>
                      <div style={{ fontFamily: HEAD, fontSize: 22, fontWeight: 700, color: C.navy2 }}>{b.goal}</div>
                    </div>
                    <div style={{ padding: "12px 20px", textAlign: "center", background: `${tone}14` }}>
                      <div style={{ fontSize: 12, color: C.grayMute, fontWeight: 600 }}>% Complete</div>
                      <div style={{ fontFamily: HEAD, fontSize: 26, fontWeight: 700, color: tone }}>{fmtPct(b.actual, b.goal)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 12.5, color: C.grayMute, marginTop: 12, fontStyle: "italic" }}>
              {superUser ? "AI résumé scores are visible to you on the Applicants tab." : "AI résumé scores are Super-Admin only."}
            </p>
            <h2 style={{ fontFamily: HEAD, fontSize: 20, color: C.navy, margin: "32px 0 12px" }}>By school</h2>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", padding: "10px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                <div>School</div><div>Sourced</div><div>Contacted</div><div>Applied</div>
              </div>
              {schools.map((s) => {
                const sc = candidates.filter((c) => c.school_id === s.id);
                const accent = s.color_primary ?? C.navy2;
                return (
                  <div key={s.id}
                    style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", borderLeft: `4px solid ${accent}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {s.logo_url && <img src={s.logo_url} alt={s.name} style={{ height: 24, width: 24, objectFit: "contain", borderRadius: 4 }} />}
                      <div>
                        <div style={{ fontWeight: 700, color: C.gray }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: C.grayMute, textTransform: "capitalize" }}>{s.tier}</div>
                      </div>
                    </div>
                    <div style={{ color: accent, fontWeight: 700 }}>{sc.filter((c) => c.stage && SOURCED.has(c.stage)).length}</div>
                    <div style={{ color: accent, fontWeight: 700 }}>{sc.filter((c) => c.stage && CONTACTED.has(c.stage)).length}</div>
                    <div style={{ color: accent, fontWeight: 700 }}>{sc.filter((c) => c.stage && APPLIED.has(c.stage)).length}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ---- APPLICANTS ---- */}
        {tab === "applicants" && (() => {
          const scopeFiltered = candidates.filter((c) => scope === "Org-wide" || schools.find((s) => s.id === c.school_id)?.name === scope);
          const unroutedCount = scopeFiltered.filter((c) => !c.school_id).length;
          const visible = showUnrouted ? scopeFiltered.filter((c) => !c.school_id) : scopeFiltered;
          return (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
              <div>
                <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Applicants</h1>
                <p style={{ color: C.grayMute, margin: "4px 0 0" }}>
                  {visible.length} candidates{superUser ? " · AI scores visible" : ""}
                  {unroutedCount > 0 && !showUnrouted && <span style={{ color: C.orange }}> · {unroutedCount} unrouted</span>}
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button onClick={() => setShowUnrouted((v) => !v)}
                  style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${showUnrouted ? C.orange : C.line}`, fontSize: 13.5, background: showUnrouted ? "#FBE7DF" : "#fff", color: showUnrouted ? C.orange : C.grayMute, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {showUnrouted ? "✕ Unrouted only" : `Unrouted (${unroutedCount})`}
                </button>
                <select value={scope} onChange={(e) => { setScope(e.target.value); setShowUnrouted(false); }} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 600 }}>
                  <option>Org-wide</option>
                  {schools.map((s) => <option key={s.id}>{s.name}</option>)}
                </select>
                <button onClick={() => setAddOpen(true)} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: C.navy, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" }}>+ Add</button>
                <button onClick={() => setBulkOpen(true)} style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 700, fontSize: 13.5, cursor: "pointer", whiteSpace: "nowrap" }}>Bulk import</button>
              </div>
            </div>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: `1.7fr 1fr 1fr 0.6fr 1fr${superUser ? " 0.8fr" : ""} 40px`, padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                <div>Applicant</div><div>School</div><div>Major</div><div>GPA</div><div>Stage</div>{superUser && <div>AI</div>}<div></div>
              </div>
              {visible.map((c) => {
                  const aiRec = aiMap.get(c.id);
                  const score = aiRec?.resume_score ?? null;
                  const scoreTone = score == null ? C.grayMute : score >= 16 ? C.good : score >= 12 ? C.gold : C.orange;
                  const schoolName = schools.find((s) => s.id === c.school_id)?.name;
                  return (
                    <div key={c.id} onClick={() => setOpenId(c.id)}
                      style={{ display: "grid", gridTemplateColumns: `1.7fr 1fr 1fr 0.6fr 1fr${superUser ? " 0.8fr" : ""} 40px`, padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", cursor: "pointer", opacity: c.not_interested ? 0.5 : 1 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F4FA")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.gray }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: C.grayMute }}>{c.email}</div>
                      </div>
                      <div style={{ fontSize: 13.5 }} onClick={(e) => e.stopPropagation()}>
                        {adminPlus ? (
                          <select
                            value={c.school_id ?? ""}
                            onChange={(e) => startTransition(() => { reassignSchool(c.id, e.target.value || null); })}
                            style={{ fontSize: 12, fontWeight: 600, color: c.school_id ? C.navy2 : C.orange, border: `1px solid ${c.school_id ? C.line : C.orange}`, borderRadius: 7, padding: "4px 6px", background: "#fff", maxWidth: "100%", cursor: "pointer" }}>
                            <option value="">— Unrouted —</option>
                            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        ) : (
                          schoolName
                            ? <span style={{ color: C.navy2, fontWeight: 600 }}>{schoolName}</span>
                            : <span style={{ color: C.orange, fontStyle: "italic", fontSize: 12 }}>{c.university_raw ?? "Unrouted"}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 13.5 }}>{c.area_of_study}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.gpa}</div>
                      <div><StagePill stage={c.stage} /></div>
                      {superUser && <div style={{ fontFamily: HEAD, fontWeight: 700, color: scoreTone }}>{score == null ? "—" : `${score}/20`}</div>}
                      <div style={{ fontSize: 18, color: c.is_favorite ? C.gold : "#D8DCE5", textAlign: "center" }}>{c.is_favorite ? "★" : "☆"}</div>
                    </div>
                  );
                })}
              {visible.length === 0 && (
                <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>{showUnrouted ? "No unrouted candidates — routing is complete!" : "No applicants yet — run a sync."}</div>
              )}
            </div>
          </>
        );})()}

        {/* ---- STANDINGS ---- */}
        {tab === "standings" && (
          <StandingsClient
            schools={schools}
            candidates={candidates.map((c) => ({ id: c.id, school_id: c.school_id, stage: c.stage }))}
            goals={goals}
            mySchoolId={null}
          />
        )}

        {/* ---- PLAYBOOK ---- */}
        {tab === "playbook" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
              <div>
                <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>
                  {playbookSchoolObj?.logo_url && <img src={playbookSchoolObj.logo_url} alt="" style={{ height: 28, width: 28, objectFit: "contain", borderRadius: 5, marginRight: 10, verticalAlign: "middle" }} />}
                  {playbookSchoolObj?.name ?? "School"} Playbook
                </h1>
                <p style={{ color: C.grayMute, margin: "4px 0 0" }}>Edit phase names, tasks, assignees, and due dates inline. Changes save on blur.</p>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <select value={playbookSchool} onChange={(e) => setPlaybookSchool(e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 600 }}>
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={async () => {
                  const res = await seedPlaybook(playbookSchool);
                  if (res.error === "already_seeded") {
                    if (!confirm("This school already has a playbook. Reseed from defaults? (existing tasks will be deleted)")) return;
                    await seedPlaybook(playbookSchool, true);
                  }
                }} style={{ border: "none", background: C.orange, color: "#fff", fontWeight: 700, fontSize: 13, padding: "10px 16px", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap" }}>
                  Seed Defaults
                </button>
              </div>
            </div>
            <button onClick={() => startTransition(() => { addPhase(playbookSchool, "Month", "New phase", playbookPhases.length); })}
              style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 600, padding: "10px 16px", borderRadius: 10, cursor: "pointer", marginTop: 16 }}>
              + Add phase
            </button>
            <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
              {playbookPhases.map((p) => (
                <div key={p.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 22 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
                    <input defaultValue={p.label}
                      onBlur={(e) => { if (e.target.value.trim() !== p.label) startTransition(() => { updatePhase(p.id, e.target.value.trim() || p.label, p.title); }); }}
                      style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 11, color: C.orange, textTransform: "uppercase", border: "none", background: "transparent", width: 90, outline: "none", borderBottom: `1px solid ${C.line}`, padding: "2px 0" }} />
                    <input defaultValue={p.title}
                      onBlur={(e) => { if (e.target.value.trim() !== p.title) startTransition(() => { updatePhase(p.id, p.label, e.target.value.trim() || p.title); }); }}
                      style={{ fontFamily: HEAD, fontSize: 18, fontWeight: 700, color: C.navy, border: "none", background: "transparent", flex: 1, outline: "none", borderBottom: `1px solid ${C.line}`, padding: "2px 0" }} />
                    <button onClick={() => { if (confirm(`Delete phase "${p.title}" and all its tasks?`)) startTransition(() => { deletePhase(p.id); }); }}
                      style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "4px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>
                      Delete phase
                    </button>
                  </div>
                  {p.playbook_tasks.map((t) => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${C.line}88` }}>
                      <input type="checkbox" defaultChecked={t.done}
                        onChange={(e) => startTransition(() => { upsertTask({ id: t.id, phase_id: p.id, text: t.text, assignee_id: t.assignee_id, assignee_label: t.assignee_label ?? null, month_label: t.month_label ?? null, notes: t.notes ?? null, due_date: t.due_date, done: e.target.checked }); })}
                        style={{ accentColor: C.orange, flexShrink: 0 }} />
                      <input defaultValue={t.text}
                        onBlur={(e) => { if (e.target.value.trim() !== t.text) startTransition(() => { upsertTask({ id: t.id, phase_id: p.id, text: e.target.value.trim() || t.text, assignee_id: t.assignee_id, assignee_label: t.assignee_label ?? null, month_label: t.month_label ?? null, notes: t.notes ?? null, due_date: t.due_date, done: t.done }); }); }}
                        style={{ flex: 1, border: "none", background: "transparent", fontSize: 14, color: t.done ? C.grayMute : C.gray, textDecoration: t.done ? "line-through" : "none", outline: "none", minWidth: 0 }} />
                      <select value={t.assignee_id ?? ""}
                        onChange={(e) => startTransition(() => { upsertTask({ id: t.id, phase_id: p.id, text: t.text, assignee_id: e.target.value || null, assignee_label: t.assignee_label ?? null, month_label: t.month_label ?? null, notes: t.notes ?? null, due_date: t.due_date, done: t.done }); })}
                        style={{ fontSize: 12, fontWeight: 600, color: t.assignee_id ? C.navy2 : C.orange, border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 6px", background: "#fff", flexShrink: 0 }}>
                        <option value="">Unassigned</option>
                        {team.map((tm) => <option key={tm.id} value={tm.id}>{tm.id === profile.id ? `${tm.full_name} (me)` : tm.full_name}</option>)}
                      </select>
                      <input type="date" value={t.due_date ?? ""}
                        onChange={(e) => startTransition(() => { upsertTask({ id: t.id, phase_id: p.id, text: t.text, assignee_id: t.assignee_id, assignee_label: t.assignee_label ?? null, month_label: t.month_label ?? null, notes: t.notes ?? null, due_date: e.target.value || null, done: t.done }); })}
                        style={{ fontSize: 12, color: C.grayMute, border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 6px", background: "#fff", flexShrink: 0 }} />
                      <button onClick={() => startTransition(() => { deleteTask(t.id); })} style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 16, flexShrink: 0 }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => startTransition(() => { upsertTask({ phase_id: p.id, text: "New task", assignee_id: null, assignee_label: null, month_label: null, notes: null, due_date: null, done: false }); })}
                    style={{ marginTop: 10, border: `1px dashed ${C.line}`, background: "transparent", color: C.navy2, fontWeight: 600, padding: "8px 14px", borderRadius: 9, cursor: "pointer", width: "100%" }}>
                    + Add task
                  </button>
                  {p.playbook_tasks.length === 0 && <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic", marginTop: 8 }}>No tasks yet.</div>}
                </div>
              ))}
              {playbookPhases.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No playbook yet for this school — add the first phase.</div>}
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
            const sc = candidates.filter((c) => c.school_id === s.id);
            const teamSize = users.filter((u) => u.school_id === s.id).length;
            const g = goals.find((g) => g.school_id === s.id);
            const draft = goalDraft(s.id);
            const sourced = sc.filter((c) => SOURCED.has(c.stage ?? "")).length;
            const contacted = sc.filter((c) => CONTACTED.has(c.stage ?? "")).length;
            const applied = sc.filter((c) => APPLIED.has(c.stage ?? "")).length;
            return (
              <div key={s.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${accent}`, borderRadius: 14, padding: "18px 22px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: showGoalForm ? 14 : 0 }}>
                  {s.logo_url && <img src={s.logo_url} alt="" style={{ height: 28, width: 28, objectFit: "contain", borderRadius: 4 }} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: C.gray }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: C.grayMute, textTransform: "capitalize" }}>{s.tier} · {teamSize} teammate{teamSize !== 1 ? "s" : ""}</div>
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    {([["Sourced", sourced, g?.goal_sourced], ["Contacted", contacted, g?.goal_contacted], ["Applied", applied, g?.goal_applied]] as [string, number, number | undefined][]).map(([lbl, act, goal]) => {
                      const hasGoal = (goal ?? 0) > 0;
                      const pct = hasGoal ? Math.round((act / (goal as number)) * 100) : 0;
                      const tone = pct >= 100 ? C.good : pct >= 70 ? C.gold : C.orange;
                      return (
                        <div key={lbl} style={{ textAlign: "center" }}>
                          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 20, color: hasGoal ? tone : C.navy2 }}>{act}</div>
                          <div style={{ fontSize: 10, color: C.grayMute, fontWeight: 600 }}>{lbl}{hasGoal ? ` · ${pct}%` : ""}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {showGoalForm && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: C.grayMute, fontWeight: 600 }}>Goals:</span>
                    {(["sourced", "contacted", "applied"] as const).map((field) => (
                      <label key={field} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 12, color: C.grayMute, textTransform: "capitalize" }}>{field}</span>
                        <input type="number" min={0} value={draft[field]}
                          onChange={(e) => setGoalField(s.id, field, e.target.value)}
                          style={{ width: 60, padding: "5px 8px", borderRadius: 7, border: `1px solid ${C.line}`, fontSize: 13, fontWeight: 700, color: C.navy, textAlign: "center" }} />
                      </label>
                    ))}
                    <button onClick={async () => {
                      const result = await upsertGoal(s.id, Number(draft.sourced) || 0, Number(draft.contacted) || 0, Number(draft.applied) || 0);
                      const status = result.error ? "error" : "saved";
                      setGoalSaved((prev) => ({ ...prev, [s.id]: status }));
                      setTimeout(() => setGoalSaved((prev) => { const n = { ...prev }; delete n[s.id]; return n; }), 2500);
                    }} style={{ border: "none", background: goalSaved[s.id] === "saved" ? C.good : goalSaved[s.id] === "error" ? C.orange : C.navy, color: "#fff", fontWeight: 700, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, transition: "background .2s", minWidth: 90 }}>
                      {goalSaved[s.id] === "saved" ? "Saved ✓" : goalSaved[s.id] === "error" ? "Error ✕" : "Save goals"}
                    </button>
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
                const groupCands = tierSchools.flatMap((s) => candidates.filter((c) => c.school_id === s.id));
                const groupSourced = groupCands.filter((c) => SOURCED.has(c.stage ?? "")).length;
                const groupContacted = groupCands.filter((c) => CONTACTED.has(c.stage ?? "")).length;
                const groupApplied = groupCands.filter((c) => APPLIED.has(c.stage ?? "")).length;
                // All schools in a group share the same goal value — read from any one
                const repGoal = goals.find((g) => tierSchoolIds.includes(g.school_id));
                const groupGoalActual = { sourced: repGoal?.goal_sourced ?? 0, contacted: repGoal?.goal_contacted ?? 0, applied: repGoal?.goal_applied ?? 0 };
                const gDraft = isGrouped ? groupGoalDraft(tier, tierSchoolIds) : null;

                return (
                  <div key={tier} style={{ marginBottom: 28 }}>
                    <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 1, marginBottom: 10 }}>
                      {tier === "core" ? "Core Schools" : tier === "satellite" ? "Satellite Group" : "Bonus Group"}
                    </div>
                    {isGrouped && gDraft ? (
                      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.navy2}`, borderRadius: 14, padding: "18px 22px" }}>
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: C.gray, marginBottom: 6 }}>{tier === "satellite" ? "Satellite Group" : "Bonus Group"} ({tierSchools.length} schools)</div>
                          <div style={{ display: "flex", gap: 16 }}>
                            {([["Sourced", groupSourced, groupGoalActual.sourced], ["Contacted", groupContacted, groupGoalActual.contacted], ["Applied", groupApplied, groupGoalActual.applied]] as [string, number, number][]).map(([lbl, act, goal]) => {
                              const hasGoal = goal > 0;
                              const pct = hasGoal ? Math.round((act / goal) * 100) : 0;
                              const tone = pct >= 100 ? C.good : pct >= 70 ? C.gold : C.orange;
                              return (
                                <span key={lbl} style={{ fontSize: 13, color: C.grayMute }}>
                                  {lbl}: <b style={{ color: hasGoal ? tone : C.navy2 }}>{act}</b>{hasGoal ? <span style={{ fontSize: 11, color: tone }}> ({pct}%)</span> : ""}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
                          <span style={{ fontSize: 12, color: C.grayMute, fontWeight: 600 }}>Goals:</span>
                          {(["sourced", "contacted", "applied"] as const).map((field) => (
                            <label key={field} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <span style={{ fontSize: 12, color: C.grayMute, textTransform: "capitalize" }}>{field}</span>
                              <input type="number" min={0} value={gDraft[field]}
                                onChange={(e) => setGroupGoalField(tier, tierSchoolIds, field, e.target.value)}
                                style={{ width: 60, padding: "5px 8px", borderRadius: 7, border: `1px solid ${C.line}`, fontSize: 13, fontWeight: 700, color: C.navy, textAlign: "center" }} />
                            </label>
                          ))}
                          <button onClick={async () => {
                            const result = await upsertGroupGoal(tierSchoolIds, Number(gDraft.sourced) || 0, Number(gDraft.contacted) || 0, Number(gDraft.applied) || 0);
                            const status = result.error ? "error" : "saved";
                            setGroupGoalSaved((prev) => ({ ...prev, [tier]: status }));
                            setTimeout(() => setGroupGoalSaved((prev) => { const n = { ...prev }; delete n[tier]; return n; }), 2500);
                          }} style={{ border: "none", background: groupGoalSaved[tier] === "saved" ? C.good : groupGoalSaved[tier] === "error" ? C.orange : C.navy, color: "#fff", fontWeight: 700, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, transition: "background .2s", minWidth: 90 }}>
                            {groupGoalSaved[tier] === "saved" ? "Saved ✓" : groupGoalSaved[tier] === "error" ? "Error ✕" : "Save goals"}
                          </button>
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
        {tab === "users" && superUser && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
              <div>
                <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Users</h1>
                <p style={{ color: C.grayMute, margin: "4px 0 0" }}>{users.length} user{users.length !== 1 ? "s" : ""} · Role and school changes take effect immediately.</p>
              </div>
              <button onClick={() => setInviteOpen(true)} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, fontSize: 13.5, padding: "10px 18px", borderRadius: 10, cursor: "pointer" }}>+ Invite User</button>
            </div>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.6fr 1.2fr 1.4fr 36px 36px", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                <div>Name</div><div>Email</div><div>Role</div><div>School</div><div></div><div></div>
              </div>
              {users.map((u) => (
                <div key={u.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 1.6fr 1.2fr 1.4fr 36px 36px", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", opacity: u.is_active ? 1 : 0.45 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input defaultValue={u.full_name}
                      onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== u.full_name) startTransition(() => { updateUserName(u.id, n); }); }}
                      style={{ fontWeight: 700, fontSize: 13.5, color: C.gray, border: "none", background: "transparent", outline: "none", borderBottom: `1px solid ${C.line}`, flex: 1, padding: "2px 0", minWidth: 0 }} />
                    {u.id === profile.id && <span style={{ fontSize: 11, color: C.navy2, background: `${C.navy2}22`, padding: "1px 6px", borderRadius: 99, flexShrink: 0 }}>you</span>}
                  </div>
                  <div style={{ fontSize: 13, color: C.grayMute }}>{u.email}</div>
                  <select defaultValue={u.role}
                    onChange={(e) => startTransition(() => { updateUser(u.id, e.target.value, u.school_id); })}
                    disabled={u.id === profile.id}
                    style={{ fontSize: 12.5, fontWeight: 600, color: C.navy, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 7px", background: "#fff" }}>
                    {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select defaultValue={u.school_id ?? ""}
                    onChange={(e) => startTransition(() => { updateUser(u.id, u.role, e.target.value || null); })}
                    style={{ fontSize: 12.5, fontWeight: 600, color: u.school_id ? C.navy : C.grayMute, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 7px", background: "#fff" }}>
                    <option value="">— No school —</option>
                    {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <div style={{ width: 10, height: 10, borderRadius: 99, background: u.is_active ? C.good : C.line, margin: "0 auto" }} title={u.is_active ? "Active" : "Inactive"} />
                  <button
                    disabled={u.id === profile.id}
                    onClick={() => { if (confirm(`Remove ${u.full_name}? This cannot be undone.`)) startTransition(() => { removeUser(u.id); }); }}
                    title={u.id === profile.id ? "Cannot remove yourself" : "Remove user"}
                    style={{ border: "none", background: "transparent", color: u.id === profile.id ? C.line : "#ef4444", fontSize: 16, cursor: u.id === profile.id ? "default" : "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    ×
                  </button>
                </div>
              ))}
              {users.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No users found.</div>}
            </div>
          </>
        )}

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
      </div>

      {open && (
        <CandidateDrawer c={open} profile={profile} team={team} onClose={() => setOpenId(null)} startTransition={startTransition} aiData={aiMap.get(open.id) ?? null} superUser={superUser} />
      )}
      {addOpen && (
        <AddCandidateModal schools={schools} existingEmails={new Set(candidates.map((c) => c.email?.toLowerCase() ?? "").filter(Boolean))} onClose={() => setAddOpen(false)} startTransition={startTransition} />
      )}
      {bulkOpen && (
        <BulkImportModal schools={schools} existingEmails={new Set(candidates.map((c) => c.email?.toLowerCase() ?? "").filter(Boolean))} onClose={() => setBulkOpen(false)} startTransition={startTransition} />
      )}
      {inviteOpen && (
        <InviteUserModal schools={schools} onClose={() => setInviteOpen(false)} startTransition={startTransition} />
      )}
    </div>
  );
}

type Connection = { id: string; fellow_id: string; name: string; relationship: string };
const REL_QUICK = ["Knows personally", "Went to school together", "Worked together", "Alumni connection", "Mutual friend"];

// ---- Candidate Drawer ----
function CandidateDrawer({ c, profile, team, onClose, startTransition, aiData, superUser }: {
  c: Cand; profile: Profile; team: TeamMember[];
  onClose: () => void; startTransition: (cb: () => void) => void;
  aiData: AI | null; superUser: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<{ id: string; body: string; created_at: string }[] | null>(null);
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [relDraft, setRelDraft] = useState("");
  const QUICK = ["Called — left voicemail", "Emailed", "Met in person", "Scheduled follow-up"];

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
          <h2 style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 24, margin: "0 0 2px" }}>{c.name}</h2>
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

          {([["Email", c.email], ["GPA", c.gpa], ["Grad Date", c.grad_date], ["University", c.university_raw]] as [string, string | null][]).map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>{k}</span>
              <span style={{ fontSize: 13, color: C.gray, fontWeight: 600 }}>{v ?? "—"}</span>
            </div>
          ))}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
            <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>Point person</span>
            <select defaultValue={c.point_person_id ?? ""} onChange={(e) => startTransition(() => { reassignPointPerson(c.id, e.target.value || null); })}
              style={{ fontSize: 13, fontWeight: 600, color: c.point_person_id ? C.navy : C.orange, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 8px", background: "#fff" }}>
              <option value="">Unassigned</option>
              {team.map((t) => <option key={t.id} value={t.id}>{t.id === profile.id ? `${t.full_name} (me)` : t.full_name}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 8, margin: "16px 0 20px" }}>
            <a href={c.linkedin ?? "#"} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, textAlign: "center", textDecoration: "none", border: `1px solid ${C.line}`, background: "#fff", color: c.linkedin ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, pointerEvents: c.linkedin ? "auto" : "none" }}>
              LinkedIn ↗
            </a>
            <button
              onClick={async () => {
                if (!c.jazz_id) return;
                const res = await fetch(`/api/resume?jazzId=${encodeURIComponent(c.jazz_id)}`);
                if (res.ok) { const url = URL.createObjectURL(await res.blob()); window.open(url, "_blank"); }
                else { alert("Resume unavailable (private file) — view this candidate directly in JazzHR."); }
              }}
              disabled={!c.jazz_id}
              style={{ flex: 1, textAlign: "center", border: `1px solid ${C.line}`, background: "#fff", color: c.jazz_id ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, cursor: c.jazz_id ? "pointer" : "not-allowed" }}>
              Résumé ↗
            </button>
          </div>

          {/* AI signal panel */}
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
            <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, marginBottom: 10, letterSpacing: 0.8 }}>AI Analysis</div>
            {superUser ? (
              aiData ? (
                <>
                  {/* Score bar */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 12, color: C.grayMute, fontWeight: 600 }}>Résumé Score</span>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: HEAD, color: aiData.resume_score == null ? C.grayMute : aiData.resume_score >= 16 ? C.good : aiData.resume_score >= 12 ? C.gold : C.orange }}>
                        {aiData.resume_score == null ? "—" : `${aiData.resume_score} / 20`}
                      </span>
                    </div>
                    {aiData.resume_score != null && (
                      <div style={{ height: 7, borderRadius: 99, background: C.line, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(aiData.resume_score / 20) * 100}%`, background: aiData.resume_score >= 16 ? C.good : aiData.resume_score >= 12 ? C.gold : C.orange, borderRadius: 99 }} />
                      </div>
                    )}
                  </div>
                  {/* Summary */}
                  {aiData.summary && (
                    <p style={{ fontSize: 13, color: C.gray, margin: "0 0 12px", lineHeight: 1.5 }}>{aiData.summary}</p>
                  )}
                  {/* Flags */}
                  {(aiData.flags ?? []).length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(aiData.flags ?? []).map((f, i) => {
                        const chipColor = f.kind === "standout" ? C.good : f.kind === "concern" ? C.orange : C.blue;
                        return (
                          <span key={i} style={{ fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: `${chipColor}22`, color: chipColor, border: `1px solid ${chipColor}55` }}>
                            {f.kind === "standout" ? "✓ " : f.kind === "concern" ? "⚠ " : "ℹ "}{f.text}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {!aiData.summary && (aiData.flags ?? []).length === 0 && aiData.resume_score == null && (
                    <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>No AI data yet.</div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>No AI analysis yet for this candidate.</div>
              )
            ) : (
              <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>AI restricted to Super-Admins.</div>
            )}
          </div>

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
        </div>
      </div>
    </div>
  );
}

// ---- Add Candidate Modal ----
const EMPTY_FORM = { name: "", email: "", school_id: "", stage: "", gpa: "", area_of_study: "" };
function AddCandidateModal({ schools, existingEmails, onClose, startTransition }: {
  schools: School[]; existingEmails: Set<string>;
  onClose: () => void; startTransition: (cb: () => void) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dupeEmail = form.email && existingEmails.has(form.email.toLowerCase());

  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const submit = () => {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setError(null);
    startTransition(() => {
      addCandidate({
        name: form.name.trim(),
        email: form.email.trim() || null,
        school_id: form.school_id || null,
        stage: form.stage || null,
        gpa: form.gpa.trim() || null,
        area_of_study: form.area_of_study.trim() || null,
      }).then((r) => {
        if ("error" in r && r.error) setError(r.error);
        else { setSaved(true); setTimeout(onClose, 800); }
      });
    });
  };

  const field = (label: string, k: keyof typeof EMPTY_FORM, placeholder?: string) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>{label}</label>
      <input value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={placeholder}
        style={{ width: "100%", padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" }} />
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 28, width: 440, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ fontFamily: HEAD, fontSize: 22, color: C.navy, margin: "0 0 20px" }}>Add Candidate</h2>
        {field("Name *", "name")}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>Email</label>
          <input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="email@example.com"
            style={{ width: "100%", padding: "10px 13px", borderRadius: 9, border: `1px solid ${dupeEmail ? C.orange : C.line}`, fontSize: 14, boxSizing: "border-box" }} />
          {dupeEmail && <div style={{ fontSize: 12, color: C.orange, marginTop: 4 }}>⚠ A candidate with this email already exists — duplicate will be created if you continue.</div>}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>School</label>
          <select value={form.school_id} onChange={(e) => set("school_id", e.target.value)}
            style={{ width: "100%", padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff" }}>
            <option value="">— Unassigned —</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: C.grayMute, display: "block", marginBottom: 5 }}>Stage</label>
          <select value={form.stage} onChange={(e) => set("stage", e.target.value)}
            style={{ width: "100%", padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff" }}>
            <option value="">— None —</option>
            {STAGE_CONFIG.map((s) => <option key={s.key} value={s.key}>{s.key} ({s.phase})</option>)}
          </select>
        </div>
        {field("GPA", "gpa", "3.5")}
        {field("Major / Area of Study", "area_of_study", "Computer Science")}
        {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#8A3A1E", marginBottom: 14 }}>{error}</div>}
        {saved && <div style={{ background: "#E8F5EE", border: `1px solid ${C.good}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#1B5E3F", marginBottom: 14 }}>✓ Candidate added!</div>}
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

function BulkImportModal({ schools, existingEmails, onClose, startTransition }: {
  schools: School[]; existingEmails: Set<string>;
  onClose: () => void; startTransition: (cb: () => void) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const schoolByName = new Map(schools.map((s) => [s.name.toLowerCase(), s.id]));
  const resolveSchoolId = (raw: string): string | null => {
    const exact = schoolByName.get(raw.toLowerCase());
    if (exact) return exact;
    const routed = routeToSchoolName(raw);
    return routed ? (schoolByName.get(routed.toLowerCase()) ?? null) : null;
  };

  const parsed = (() => {
    if (!text.trim()) return null;
    const rows = parseCSVRows(text);
    const header = rows[0]?.map((h) => h.toLowerCase()) ?? [];
    const hasHeader = header.includes("name") || header.includes("email");
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const iName = hasHeader ? header.indexOf("name") : 0;
    const iEmail = hasHeader ? header.indexOf("email") : 1;
    const iSchool = hasHeader ? header.indexOf("school") : 2;
    const iStage = hasHeader ? header.indexOf("stage") : 3;
    const iGpa = hasHeader ? header.indexOf("gpa") : 4;
    const iMajor = hasHeader ? Math.max(header.indexOf("major"), header.indexOf("area_of_study")) : 5;
    const items = dataRows.map((r) => ({
      name: r[iName] ?? "",
      email: r[iEmail] || null,
      school_id: resolveSchoolId(r[iSchool] ?? ""),
      stage: r[iStage] || null,
      gpa: r[iGpa] || null,
      area_of_study: r[iMajor] || null,
    })).filter((r) => r.name);
    const dupes = items.filter((r) => r.email && existingEmails.has((r.email ?? "").toLowerCase()));
    return { items, dupes };
  })();

  const doImport = () => {
    if (!parsed || parsed.items.length === 0) { setError("No valid rows to import."); return; }
    setError(null);
    startTransition(() => {
      bulkImportCandidates(parsed.items).then((r) => {
        if ("error" in r && r.error) setError(r.error);
        else setResult(`✓ Imported ${"count" in r ? r.count : parsed.items.length} candidate${parsed.items.length !== 1 ? "s" : ""}. Page will refresh.`);
      });
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 28, width: 560, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ fontFamily: HEAD, fontSize: 22, color: C.navy, margin: "0 0 8px" }}>Bulk Import</h2>
        <p style={{ fontSize: 13, color: C.grayMute, margin: "0 0 16px" }}>
          Paste CSV with columns: <code style={{ background: C.canvas, padding: "1px 5px", borderRadius: 4 }}>Name, Email, School, Stage, GPA, Major</code>. Header row is auto-detected.
        </p>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setResult(null); setError(null); }}
          placeholder={"Name,Email,School,Stage,GPA,Major\nJane Doe,jane@example.com,Purdue,new,3.7,Computer Science"}
          rows={8} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 13, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
        {parsed && (
          <div style={{ margin: "12px 0", padding: "10px 14px", background: C.canvas, borderRadius: 9, fontSize: 13 }}>
            <b style={{ color: C.navy }}>{parsed.items.length}</b> row{parsed.items.length !== 1 ? "s" : ""} parsed
            {parsed.dupes.length > 0 && <span style={{ color: C.orange, marginLeft: 10 }}>⚠ {parsed.dupes.length} may be duplicate{parsed.dupes.length !== 1 ? "s" : ""} (email match)</span>}
          </div>
        )}
        {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#8A3A1E", marginBottom: 14 }}>{error}</div>}
        {result && <div style={{ background: "#E8F5EE", border: `1px solid ${C.good}`, borderRadius: 9, padding: "10px 13px", fontSize: 13, color: "#1B5E3F", marginBottom: 14 }}>{result}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "11px 18px", borderRadius: 10, cursor: "pointer" }}>Cancel</button>
          <button onClick={doImport} disabled={!parsed || parsed.items.length === 0}
            style={{ border: "none", background: parsed && parsed.items.length > 0 ? C.navy : C.navy3, color: "#fff", fontWeight: 700, padding: "11px 20px", borderRadius: 10, cursor: parsed && parsed.items.length > 0 ? "pointer" : "not-allowed" }}>
            Import {parsed ? parsed.items.length : 0} rows
          </button>
        </div>
      </div>
    </div>
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
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
