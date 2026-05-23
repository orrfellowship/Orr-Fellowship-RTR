"use client";

import { useState, useMemo, useTransition, useEffect } from "react";
import type { Profile } from "@/lib/types";
import { isSuper } from "@/lib/types";
import {
  toggleFavorite, setNotInterested, logOutreach, getOutreach,
  reassignPointPerson, addConnection,
} from "./actions";

const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD",
  orange: "#DD5434", blue: "#8AB9E2", gray: "#303333", grayMute: "#6E7385",
  line: "#E4E7EE", canvas: "#F7F8FB", gold: "#C9A227", good: "#2F8F6B",
};
const HEAD = "'Cabin', sans-serif";

type School = { id: string; name: string; tier: string };
type Cand = {
  id: string; name: string; email: string | null; school_id: string | null;
  stage: string | null; gpa: string | null; area_of_study: string | null;
  linkedin: string | null; resume_link: string | null;
  point_person_id: string | null; not_interested: boolean; is_favorite: boolean;
};
type TeamMember = { id: string; full_name: string };
type Goal = { school_id: string; goal_sourced: number; goal_contacted: number; goal_applied: number };
type AI = { candidate_id: string; resume_score: number | null };

const PHASE_OF: Record<string, string> = { new: "Sourced", contacted: "Contacted", applied: "Applied", bmi: "Advanced", finalist: "Finalist", fellow: "Fellow" };
const phaseTone: Record<string, string> = { Sourced: C.navy3, Contacted: C.blue, Applied: C.navy2, Advanced: C.orange, Finalist: C.gold, Fellow: C.good };

function StagePill({ stage }: { stage: string | null }) {
  const ph = stage ? PHASE_OF[stage] ?? "Sourced" : "Sourced";
  const tone = phaseTone[ph];
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
  profile, schools, candidates, team, goals, ai,
}: {
  profile: Profile; schools: School[]; candidates: Cand[]; team: TeamMember[];
  goals: Goal[]; ai: AI[];
}) {
  const [tab, setTab] = useState<"overview" | "applicants" | "sync">("overview");
  const [scope, setScope] = useState<string>("Org-wide");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const superUser = isSuper(profile.role);
  const aiMap = useMemo(() => new Map(ai.map((a) => [a.candidate_id, a.resume_score])), [ai]);

  // ---- JazzHR sync (super-admin only) ----
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // ---- list jobs (read-only diagnostic) ----
  const [jobs, setJobs] = useState<{ id: string; title: string; status: string | null; city: string | null }[] | null>(null);
  const [listing, setListing] = useState(false);
  async function listJobs() {
    setListing(true); setSyncError(null);
    try {
      const res = await fetch("/api/sync", { method: "GET" });
      const data = await res.json();
      if (!res.ok) setSyncError(typeof data.error === "string" ? data.error : JSON.stringify(data));
      else setJobs(data.jobs ?? []);
    } catch (e: any) {
      setSyncError(e?.message ?? "Request failed");
    } finally {
      setListing(false);
    }
  }

  // ---- clear data (danger zone, typed confirmation) ----
  const CONFIRM = "DELETE ALL CANDIDATES";
  const [confirmText, setConfirmText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);
  async function clearData() {
    setClearing(true); setClearMsg(null);
    try {
      const res = await fetch("/api/clear-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText }),
      });
      const data = await res.json();
      if (!res.ok) setClearMsg(`Error: ${typeof data.error === "string" ? data.error : JSON.stringify(data)}`);
      else { setClearMsg(`Cleared ${data.deleted} candidates. Refresh to see the empty state.`); setConfirmText(""); }
    } catch (e: any) {
      setClearMsg(`Error: ${e?.message ?? "Request failed"}`);
    } finally {
      setClearing(false);
    }
  }

  async function runSync(mode: "full" | "refresh") {
    setSyncing(true); setSyncResult(null); setSyncError(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(typeof data.error === "string" ? data.error : JSON.stringify(data));
      } else {
        setSyncResult(
          `${data.partial ? "Partial (re-run to continue)" : "Complete"} · written ${data.written} · routed ${data.routed} · unrouted ${data.unrouted}${data.failed ? ` · failed ${data.failed}` : ""}${data.remaining ? ` · ${data.remaining} remaining` : ""}`
        );
      }
    } catch (e: any) {
      setSyncError(e?.message ?? "Request failed");
    } finally {
      setSyncing(false);
    }
  }

  // scoreboard totals for the selected scope
  const board = useMemo(() => {
    const inScope = (c: Cand) => scope === "Org-wide" || schools.find((s) => s.id === c.school_id)?.name === scope;
    const cands = candidates.filter(inScope);
    const sourced = cands.filter((c) => c.stage && SOURCED.has(c.stage)).length;
    const contacted = cands.filter((c) => c.stage && CONTACTED.has(c.stage)).length;
    const applied = cands.filter((c) => c.stage && APPLIED.has(c.stage)).length;
    const scopeGoals = goals.filter((g) => scope === "Org-wide" || schools.find((s) => s.id === g.school_id)?.name === scope);
    const gSourced = scopeGoals.reduce((a, g) => a + g.goal_sourced, 0);
    const gContacted = scopeGoals.reduce((a, g) => a + g.goal_contacted, 0);
    const gApplied = scopeGoals.reduce((a, g) => a + g.goal_applied, 0);
    return [
      { label: "Sourced", actual: sourced, goal: gSourced },
      { label: "Contacted", actual: contacted, goal: gContacted },
      { label: "Applied", actual: applied, goal: gApplied },
    ];
  }, [scope, candidates, goals, schools]);

  const open = candidates.find((c) => c.id === openId) ?? null;

  return (
    <div style={{ minHeight: "100vh", background: C.canvas }}>
      <div style={{ background: C.navy, padding: "0 28px" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
            <div style={{ padding: "14px 0" }}>
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16, color: "#fff" }}>Orr Recruiting</div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: "rgba(255,255,255,.45)", textTransform: "uppercase" }}>{superUser ? "Super Admin" : "Admin"} Console</div>
            </div>
            {([["overview", "Overview"], ["applicants", "Applicants"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k as any)} style={{ border: "none", background: "none", cursor: "pointer", padding: "15px 0", fontFamily: HEAD, fontSize: 14.5, fontWeight: tab === k ? 700 : 600, color: tab === k ? "#fff" : "rgba(255,255,255,.55)", borderBottom: tab === k ? `3px solid ${C.orange}` : "3px solid transparent" }}>{l}</button>
            ))}
            {superUser && (
              <button onClick={() => setTab("sync")} style={{ border: "none", background: "none", cursor: "pointer", padding: "15px 0", fontFamily: HEAD, fontSize: 14.5, fontWeight: tab === "sync" ? 700 : 600, color: tab === "sync" ? "#fff" : "rgba(255,255,255,.55)", borderBottom: tab === "sync" ? `3px solid ${C.orange}` : "3px solid transparent" }}>Sync</button>
            )}
          </div>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{profile.full_name}</div>
        </div>
      </div>

      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "30px 28px 80px", opacity: pending ? 0.7 : 1 }}>
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
            {/* school-by-school breakdown — click row to filter applicants */}
            <h2 style={{ fontFamily: HEAD, fontSize: 20, color: C.navy, margin: "32px 0 12px" }}>By school</h2>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", padding: "10px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                <div>School</div><div>Sourced</div><div>Contacted</div><div>Applied</div>
              </div>
              {schools.map((s) => {
                const sc = candidates.filter((c) => c.school_id === s.id);
                return (
                  <div key={s.id} onClick={() => { setScope(s.name); setTab("applicants"); }}
                    style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F4FA")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                    <div style={{ fontWeight: 700, color: C.gray }}>{s.name}<span style={{ fontSize: 11, color: C.grayMute, fontWeight: 400, marginLeft: 6 }}>{s.tier}</span></div>
                    <div style={{ color: C.navy2, fontWeight: 600 }}>{sc.filter((c) => c.stage && SOURCED.has(c.stage)).length}</div>
                    <div style={{ color: C.navy2, fontWeight: 600 }}>{sc.filter((c) => c.stage && CONTACTED.has(c.stage)).length}</div>
                    <div style={{ color: C.navy2, fontWeight: 600 }}>{sc.filter((c) => c.stage && APPLIED.has(c.stage)).length}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "applicants" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
              <div>
                <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Applicants</h1>
                <p style={{ color: C.grayMute, margin: "4px 0 0" }}>
                  {candidates.filter((c) => scope === "Org-wide" || schools.find((s) => s.id === c.school_id)?.name === scope).length} candidates
                  {superUser ? " · AI scores visible" : ""}
                </p>
              </div>
              <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 600 }}>
                <option>Org-wide</option>
                {schools.map((s) => <option key={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: `1.7fr 1fr 1fr 0.6fr 1fr${superUser ? " 0.8fr" : ""} 40px`, padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                <div>Applicant</div><div>School</div><div>Major</div><div>GPA</div><div>Stage</div>{superUser && <div>AI</div>}<div></div>
              </div>
              {candidates
                .filter((c) => scope === "Org-wide" || schools.find((s) => s.id === c.school_id)?.name === scope)
                .map((c) => {
                  const score = aiMap.get(c.id);
                  const tone = score == null ? C.grayMute : score >= 16 ? C.good : score >= 12 ? C.gold : C.orange;
                  return (
                    <div key={c.id} onClick={() => setOpenId(c.id)}
                      style={{ display: "grid", gridTemplateColumns: `1.7fr 1fr 1fr 0.6fr 1fr${superUser ? " 0.8fr" : ""} 40px`, padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", cursor: "pointer", opacity: c.not_interested ? 0.5 : 1 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#F0F4FA")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.gray }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: C.grayMute }}>{c.email}</div>
                      </div>
                      <div style={{ fontSize: 13.5, color: C.navy2, fontWeight: 600 }}>{schools.find((s) => s.id === c.school_id)?.name ?? "—"}</div>
                      <div style={{ fontSize: 13.5 }}>{c.area_of_study}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.gpa}</div>
                      <div><StagePill stage={c.stage} /></div>
                      {superUser && <div style={{ fontFamily: HEAD, fontWeight: 700, color: tone }}>{score == null ? "—" : `${score}/20`}</div>}
                      <div style={{ fontSize: 18, color: c.is_favorite ? C.gold : "#D8DCE5", textAlign: "center" }}>{c.is_favorite ? "★" : "☆"}</div>
                    </div>
                  );
                })}
              {candidates.filter((c) => scope === "Org-wide" || schools.find((s) => s.id === c.school_id)?.name === scope).length === 0 && (
                <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No applicants yet — run a sync.</div>
              )}
            </div>
          </>
        )}

        {tab === "sync" && superUser && (
          <>
            <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>JazzHR Sync</h1>
            <p style={{ color: C.grayMute, maxWidth: 620 }}>
              Pull candidates from JazzHR. The API key lives server-side and is never exposed to the browser.
              Start with a <b>full</b> pull; later, <b>refresh</b> adds new candidates and updates stages.
            </p>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 24, marginTop: 16, maxWidth: 620 }}>
              <h3 style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: C.navy }}>Step 1 — Check the connection</h3>
              <p style={{ fontSize: 13, color: C.grayMute, margin: "0 0 12px" }}>Lists the jobs in your JazzHR account. Read-only — writes nothing.</p>
              <button onClick={listJobs} disabled={listing}
                style={{ border: `1px solid ${C.navy}`, background: listing ? C.canvas : "#fff", color: C.navy, fontWeight: 700, padding: "11px 18px", borderRadius: 10, cursor: listing ? "default" : "pointer", fontSize: 14 }}>
                {listing ? "Loading jobs…" : "List JazzHR jobs"}
              </button>
              {jobs && (
                <div style={{ marginTop: 14, border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
                  {jobs.length === 0 ? (
                    <div style={{ padding: 16, fontSize: 13.5, color: C.grayMute }}>Connected, but no jobs returned.</div>
                  ) : jobs.map((j) => (
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
                <button onClick={() => runSync("full")} disabled={syncing}
                  style={{ border: "none", background: syncing ? C.navy3 : C.orange, color: "#fff", fontWeight: 700, padding: "12px 20px", borderRadius: 10, cursor: syncing ? "default" : "pointer", fontSize: 14 }}>
                  {syncing ? "Syncing… (paging through JazzHR)" : "Run full sync"}
                </button>
                <button onClick={() => runSync("refresh")} disabled={syncing}
                  style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 600, padding: "12px 20px", borderRadius: 10, cursor: syncing ? "default" : "pointer", fontSize: 14 }}>
                  Refresh
                </button>
              </div>
              {syncResult && (
                <div style={{ marginTop: 16, background: "#E8F5EE", border: `1px solid ${C.good}`, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, color: "#1B5E3F" }}>
                  ✓ {syncResult}
                </div>
              )}
              {syncError && (
                <div style={{ marginTop: 16, background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, color: "#8A3A1E", wordBreak: "break-word" }}>
                  Sync error: {syncError}
                </div>
              )}
            </div>

            <div style={{ background: "#fff", border: `1px solid ${C.orange}`, borderRadius: 14, padding: 24, marginTop: 16, maxWidth: 620 }}>
              <h3 style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 700, margin: "0 0 4px", color: C.orange }}>Danger zone — clear all candidates</h3>
              <p style={{ fontSize: 13, color: C.grayMute, margin: "0 0 12px", lineHeight: 1.5 }}>
                Deletes every candidate and their notes, favorites, and AI rows so you can re-sync clean. Schools, users, playbook, and goals are kept. To confirm, type <b style={{ color: C.gray }}>{CONFIRM}</b> below.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={CONFIRM}
                  style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, fontFamily: "monospace" }} />
                <button onClick={clearData} disabled={clearing || confirmText !== CONFIRM}
                  style={{ border: "none", background: confirmText === CONFIRM && !clearing ? C.orange : "#E4B5A6", color: "#fff", fontWeight: 700, padding: "11px 18px", borderRadius: 10, cursor: confirmText === CONFIRM && !clearing ? "pointer" : "not-allowed", fontSize: 14, whiteSpace: "nowrap" }}>
                  {clearing ? "Clearing…" : "Clear data"}
                </button>
              </div>
              {clearMsg && (
                <div style={{ marginTop: 14, background: clearMsg.startsWith("Error") ? "#FBE7DF" : "#E8F5EE", border: `1px solid ${clearMsg.startsWith("Error") ? C.orange : C.good}`, borderRadius: 10, padding: "12px 14px", fontSize: 13.5, color: clearMsg.startsWith("Error") ? "#8A3A1E" : "#1B5E3F" }}>
                  {clearMsg}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {open && (
        <CandidateDrawer
          c={open} profile={profile} team={team}
          onClose={() => setOpenId(null)} startTransition={startTransition}
        />
      )}
    </div>
  );
}

// ---- Candidate Drawer ----
function CandidateDrawer({ c, profile, team, onClose, startTransition }: {
  c: Cand; profile: Profile; team: TeamMember[];
  onClose: () => void; startTransition: (cb: () => void) => void;
}) {
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<{ id: string; body: string; created_at: string }[] | null>(null);
  const QUICK = ["Called — left voicemail", "Emailed", "Met in person", "Scheduled follow-up"];
  const canAssign = profile.role === "admin" || profile.role === "super_admin";

  useEffect(() => {
    let active = true;
    getOutreach(c.id).then((r) => {
      if (active) setLog((("log" in r ? r.log : []) as any) ?? []);
    });
    return () => { active = false; };
  }, [c.id]);

  const doLog = (body: string) => startTransition(() => {
    logOutreach(c.id, body);
    setLog((prev) => [{ id: Math.random().toString(), body, created_at: new Date().toISOString() }, ...(prev ?? [])]);
  });

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

          {[["Email", c.email], ["GPA", c.gpa]].map(([k, v]) => (
            <div key={k as string} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>{k}</span>
              <span style={{ fontSize: 13, color: C.gray, fontWeight: 600 }}>{v ?? "—"}</span>
            </div>
          ))}

          {canAssign && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>Point person</span>
              <select
                defaultValue={c.point_person_id ?? ""}
                onChange={(e) => startTransition(() => { reassignPointPerson(c.id, e.target.value || null); })}
                style={{ fontSize: 13, fontWeight: 600, color: c.point_person_id ? C.navy : C.orange, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 8px", background: "#fff" }}>
                <option value="">Unassigned</option>
                {team.map((t) => <option key={t.id} value={t.id}>{t.id === profile.id ? `${t.full_name} (me)` : t.full_name}</option>)}
              </select>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, margin: "16px 0 20px" }}>
            <a href={c.linkedin ?? "#"} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, textAlign: "center", textDecoration: "none", border: `1px solid ${C.line}`, background: "#fff", color: c.linkedin ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, pointerEvents: c.linkedin ? "auto" : "none" }}>LinkedIn ↗</a>
            <button
              onClick={() => { if (c.resume_link) window.open(`/api/resume?url=${encodeURIComponent(c.resume_link)}`, "_blank"); }}
              disabled={!c.resume_link}
              style={{ flex: 1, textAlign: "center", border: `1px solid ${C.line}`, background: "#fff", color: c.resume_link ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, cursor: c.resume_link ? "pointer" : "not-allowed" }}>Résumé ↗</button>
          </div>

          <div style={{ background: "#fff", border: `1px dashed ${C.line}`, borderRadius: 9, padding: 13, fontSize: 12.5, color: C.grayMute, marginBottom: 20 }}>
            Know this person?{" "}
            <button onClick={() => startTransition(() => { addConnection(c.id, "knows personally"); })}
              style={{ border: "none", background: "none", color: C.orange, fontWeight: 700, cursor: "pointer", padding: 0 }}>
              Add a connection
            </button>.
          </div>

          <div style={{ fontFamily: HEAD, fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, marginBottom: 10 }}>Outreach log</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {QUICK.map((q) => (
              <button key={q} onClick={() => doLog(q)}
                style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 600, fontSize: 12, padding: "6px 11px", borderRadius: 999, cursor: "pointer" }}>
                + {q}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a note…"
              style={{ flex: 1, padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
            <button onClick={() => { if (draft.trim()) { doLog(draft.trim()); setDraft(""); } }}
              style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 600, padding: "0 16px", borderRadius: 9, cursor: "pointer" }}>
              Log
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(log ?? []).map((n) => (
              <div key={n.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 13px", fontSize: 13, color: C.gray }}>{n.body}</div>
            ))}
            {(log ?? []).length === 0 && <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>No outreach logged yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
