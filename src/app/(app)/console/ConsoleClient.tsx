"use client";

import { useState, useMemo } from "react";
import type { Profile } from "@/lib/types";
import { isSuper } from "@/lib/types";

const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD",
  orange: "#DD5434", blue: "#8AB9E2", gray: "#303333", grayMute: "#6E7385",
  line: "#E4E7EE", canvas: "#F7F8FB", gold: "#C9A227", good: "#2F8F6B",
};
const HEAD = "'Cabin', sans-serif";

type School = { id: string; name: string; tier: string };
type Cand = { id: string; name: string; school_id: string | null; stage: string | null; gpa: string | null; area_of_study: string | null };
type Goal = { school_id: string; goal_sourced: number; goal_contacted: number; goal_applied: number };
type AI = { candidate_id: string; resume_score: number | null };

const SOURCED = new Set(["new", "contacted", "applied", "bmi", "finalist", "fellow"]);
const CONTACTED = new Set(["contacted", "applied", "bmi", "finalist", "fellow"]);
const APPLIED = new Set(["applied", "bmi", "finalist", "fellow"]);

function fmtPct(actual: number, goal: number) {
  if (!goal || goal <= 0) return "—";
  const p = (actual / goal) * 100;
  return (p > 999 ? ">999" : p.toFixed(0)) + "%";
}

export default function ConsoleClient({
  profile, schools, candidates, goals, ai,
}: {
  profile: Profile; schools: School[]; candidates: Cand[]; goals: Goal[]; ai: AI[];
}) {
  const [tab, setTab] = useState<"overview" | "applicants" | "sync">("overview");
  const [scope, setScope] = useState<string>("Org-wide");
  const superUser = isSuper(profile.role);
  const aiMap = useMemo(() => new Map(ai.map((a) => [a.candidate_id, a.resume_score])), [ai]);

  // ---- JazzHR sync (super-admin only) ----
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
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
        setSyncResult(`Mode: ${data.mode} · fetched ${data.fetched} · written ${data.written}`);
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

      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "30px 28px 80px" }}>
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
          </>
        )}

        {tab === "applicants" && (
          <>
            <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Applicants</h1>
            <p style={{ color: C.grayMute }}>{candidates.length} across the program.{superUser ? " AI scores visible." : " AI scores hidden (Super-Admin only)."}</p>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: `1.7fr 1fr 1fr 0.6fr ${superUser ? "0.8fr" : ""}`, padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                <div>Applicant</div><div>School</div><div>Major</div><div>GPA</div>{superUser && <div>AI</div>}
              </div>
              {candidates.map((c) => {
                const score = aiMap.get(c.id);
                const tone = score == null ? C.grayMute : score >= 16 ? C.good : score >= 12 ? C.gold : C.orange;
                return (
                  <div key={c.id} style={{ display: "grid", gridTemplateColumns: `1.7fr 1fr 1fr 0.6fr ${superUser ? "0.8fr" : ""}`, padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.gray }}>{c.name}</div>
                    <div style={{ fontSize: 13.5, color: C.navy2, fontWeight: 600 }}>{schools.find((s) => s.id === c.school_id)?.name ?? "—"}</div>
                    <div style={{ fontSize: 13.5 }}>{c.area_of_study}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.gpa}</div>
                    {superUser && <div style={{ fontFamily: HEAD, fontWeight: 700, color: tone }}>{score == null ? "—" : `${score}/20`}</div>}
                  </div>
                );
              })}
              {candidates.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No applicants yet — run a sync.</div>}
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
              <p style={{ fontSize: 12.5, color: C.grayMute, marginTop: 16, fontStyle: "italic" }}>
                First run is a connection + data-shape test. Synced candidates won't be sorted into schools until university normalization is added — that's the next step.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
