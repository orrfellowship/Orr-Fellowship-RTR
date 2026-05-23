"use client";

import { useState, useMemo, useTransition, useEffect } from "react";
import type { Profile } from "@/lib/types";
import { canReassign, canEditPlaybook } from "@/lib/types";
import {
  toggleFavorite, setNotInterested, logOutreach, reassignPointPerson,
  getOutreach, addConnection, upsertTask, deleteTask, addPhase,
} from "./actions";
import StandingsClient from "@/components/StandingsClient";

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
type AllCand     = { id: string; name: string; email: string | null; school_id: string | null; stage: string | null; gpa: string | null; area_of_study: string | null; jazz_id: string | null; linkedin: string | null };
type AllGoal     = { school_id: string; goal_sourced: number; goal_contacted: number; goal_applied: number };
type TeamMember  = { id: string; full_name: string };
type Task        = { id: string; text: string; assignee_id: string | null; due_date: string | null; done: boolean };
type Phase       = { id: string; label: string; title: string; sort_order: number; playbook_tasks: Task[] };

const PHASE_OF: Record<string, string> = { new: "Sourced", contacted: "Contacted", applied: "Applied", bmi: "Advanced", finalist: "Finalist", fellow: "Fellow" };
const phaseTone: Record<string, string> = { Sourced: C.navy3, Contacted: C.blue, Applied: C.navy2, Advanced: C.orange, Finalist: C.gold, Fellow: C.good };
function StagePill({ stage }: { stage: string | null }) {
  const ph = stage ? PHASE_OF[stage] ?? "Sourced" : "Sourced";
  const tone = phaseTone[ph];
  return <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: tone, background: `${tone}22`, padding: "4px 9px", borderRadius: 999 }}>{stage ?? "—"}</span>;
}

export default function WorkspaceClient({
  profile, school, candidates, team, phases, allSchools, allCandidates, allGoals,
}: {
  profile: Profile; school: School | null; candidates: Cand[]; team: TeamMember[]; phases: Phase[];
  allSchools: AllSchool[]; allCandidates: AllCand[]; allGoals: AllGoal[];
}) {
  const [tab, setTab] = useState<"plan" | "board" | "playbook" | "standings" | "all">("plan");
  const [allFilter, setAllFilter] = useState<string>("All schools");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canEdit = canEditPlaybook(profile.role);
  const canAssign = canReassign(profile.role);
  const accent = school?.color_primary ?? C.orange;

  const nameOf = (id: string | null) => id ? (id === profile.id ? "You" : team.find((t) => t.id === id)?.full_name ?? "—") : "Unassigned";
  const open = candidates.find((c) => c.id === openId) ?? null;

  const plan = useMemo(() => {
    const out: { id: string; type: string; cand: Cand; why: string }[] = [];
    candidates.forEach((c) => {
      if (c.not_interested) return;
      if (c.stage === "contacted") out.push({ id: `n${c.id}`, type: "Follow up", cand: c, why: "Keep this one warm" });
      if (c.stage === "new" && !c.point_person_id) out.push({ id: `u${c.id}`, type: "Claim", cand: c, why: "New & unclaimed" });
      if (c.stage === "finalist") out.push({ id: `f${c.id}`, type: "Finalist prep", cand: c, why: "Confirm logistics" });
    });
    return out;
  }, [candidates]);

  const onFav = (c: Cand) => startTransition(() => { toggleFavorite(c.id, !c.is_favorite); });

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
                <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16, color: "#fff" }}>{school?.name ?? "Orr Recruiting"}</div>
                <div style={{ fontSize: 10, letterSpacing: 1.5, color: "rgba(255,255,255,.45)", textTransform: "uppercase" }}>{profile.role === "team_lead" ? "Team Lead" : "Fellow"} Workspace</div>
              </div>
            </div>
            {([["plan", `This Week (${plan.length})`], ["board", "My School"], ["playbook", "Playbook"], ["standings", "Standings"], ["all", "All Schools"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k as any)} style={{ border: "none", background: "none", cursor: "pointer", padding: "15px 0", fontFamily: HEAD, fontSize: 14.5, fontWeight: tab === k ? 700 : 600, color: tab === k ? "#fff" : "rgba(255,255,255,.55)", borderBottom: tab === k ? `3px solid ${accent}` : "3px solid transparent" }}>{l}</button>
            ))}
          </div>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{profile.full_name}</div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 28px 80px", opacity: pending ? 0.7 : 1 }}>
        {tab === "plan" && (
          <>
            <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>This Week</h1>
            <p style={{ color: C.grayMute }}>{plan.length} moves queued at your school.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 16 }}>
              {plan.map((a) => (
                <div key={a.id} onClick={() => setOpenId(a.cand.id)} style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${accent}`, borderRadius: 12, padding: "15px 18px", display: "flex", alignItems: "center", gap: 16, cursor: "pointer" }}>
                  <span style={{ width: 96, fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: accent }}>{a.type}</span>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: C.gray }}>{a.cand.name}</div><div style={{ fontSize: 13, color: C.grayMute }}>{a.why} · {a.cand.area_of_study}</div></div>
                  <StagePill stage={a.cand.stage} />
                </div>
              ))}
              {plan.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>All clear — nothing needs you right now.</div>}
            </div>
          </>
        )}

        {tab === "board" && (
          <>
            <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>My School Board</h1>
            <p style={{ color: C.grayMute }}>{candidates.length} candidates. AI résumé score hidden here (Super-Admin only).</p>
            <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 0.6fr 1fr 1.2fr 40px", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                <div>Candidate</div><div>Major</div><div>GPA</div><div>Stage</div><div>Owner</div><div></div>
              </div>
              {candidates.map((c) => (
                <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 0.6fr 1fr 1.2fr 40px", padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", opacity: c.not_interested ? 0.5 : 1 }}>
                  <div onClick={() => setOpenId(c.id)} style={{ cursor: "pointer" }}><div style={{ fontWeight: 700, fontSize: 14, color: C.gray }}>{c.name}</div><div style={{ fontSize: 12, color: C.grayMute }}>{c.email}</div></div>
                  <div style={{ fontSize: 13.5 }}>{c.area_of_study}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.gpa}</div>
                  <div><StagePill stage={c.stage} /></div>
                  <div>
                    {canAssign ? (
                      <select value={c.point_person_id ?? ""} onChange={(e) => startTransition(() => { reassignPointPerson(c.id, e.target.value || null); })}
                        style={{ fontSize: 12.5, fontWeight: 600, color: c.point_person_id ? C.navy : C.orange, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 7px", background: "#fff" }}>
                        <option value="">Unassigned</option>
                        {team.map((t) => <option key={t.id} value={t.id}>{t.id === profile.id ? `${t.full_name} (me)` : t.full_name}</option>)}
                      </select>
                    ) : (
                      <span style={{ fontSize: 13, color: c.point_person_id ? C.grayMute : C.orange, fontWeight: 600 }}>{nameOf(c.point_person_id)}</span>
                    )}
                  </div>
                  <div onClick={() => onFav(c)} style={{ cursor: "pointer", fontSize: 18, color: c.is_favorite ? C.gold : "#D8DCE5", textAlign: "center" }}>{c.is_favorite ? "★" : "☆"}</div>
                </div>
              ))}
              {candidates.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No candidates yet — run a sync or add one.</div>}
            </div>
          </>
        )}

        {tab === "playbook" && (
          <PlaybookTab phases={phases} profile={profile} canEdit={canEdit} nameOf={nameOf} startTransition={startTransition} />
        )}

        {tab === "standings" && (
          <StandingsClient schools={allSchools} candidates={allCandidates} goals={allGoals} mySchoolId={school?.id ?? null} />
        )}

        {tab === "all" && (() => {
          const visible = allFilter === "All schools"
            ? allCandidates
            : allCandidates.filter((c) => allSchools.find((s) => s.id === c.school_id)?.name === allFilter);
          return (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
                <div>
                  <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>All Schools</h1>
                  <p style={{ color: C.grayMute, margin: "4px 0 0" }}>{visible.length} candidates · Read-only</p>
                </div>
                <select value={allFilter} onChange={(e) => setAllFilter(e.target.value)}
                  style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 600 }}>
                  <option>All schools</option>
                  {allSchools.map((s) => <option key={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 0.6fr 1fr 80px", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
                  <div>Candidate</div><div>School</div><div>Major</div><div>GPA</div><div>Stage</div><div></div>
                </div>
                {visible.map((c) => {
                  const sc = allSchools.find((s) => s.id === c.school_id);
                  const schoolAccent = sc?.color_primary ?? C.navy2;
                  return (
                    <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 0.6fr 1fr 80px", padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.gray }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: C.grayMute }}>{c.email}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: schoolAccent }}>{sc?.name ?? <span style={{ color: C.grayMute, fontStyle: "italic" }}>Unrouted</span>}</div>
                      <div style={{ fontSize: 13 }}>{c.area_of_study ?? "—"}</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{c.gpa ?? "—"}</div>
                      <div><StagePill stage={c.stage} /></div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: C.navy2, textDecoration: "none", border: `1px solid ${C.line}`, borderRadius: 6, padding: "4px 8px" }}>in</a>}
                        {c.jazz_id && <button onClick={() => window.open(`/api/resume?jazzId=${encodeURIComponent(c.jazz_id!)}`, "_blank")} style={{ fontSize: 11, fontWeight: 700, color: C.navy2, border: `1px solid ${C.line}`, borderRadius: 6, padding: "4px 8px", background: "#fff", cursor: "pointer" }}>CV</button>}
                      </div>
                    </div>
                  );
                })}
                {visible.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No candidates yet.</div>}
              </div>
            </>
          );
        })()}
      </div>

      {open && (
        <CandidateDrawer
          c={open} canEdit={true}
          onClose={() => setOpenId(null)} startTransition={startTransition}
        />
      )}
    </div>
  );
}

// ---------------- PLAYBOOK TAB (read for fellows, edit for leads) ----------------
function PlaybookTab({ phases, profile, canEdit, nameOf, startTransition }: {
  phases: Phase[]; profile: Profile; canEdit: boolean;
  nameOf: (id: string | null) => string; startTransition: (cb: () => void) => void;
}) {
  return (
    <>
      <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Playbook</h1>
      <p style={{ color: C.grayMute }}>{canEdit ? "You can edit this plan. Assign tasks to teammates with a due date — they'll surface in This Week." : "Your team lead's plan for the cycle."}</p>
      {canEdit && (
        <button onClick={() => startTransition(() => { addPhase(profile.school_id ?? "", "New month", "Untitled phase", phases.length); })}
          style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 600, padding: "10px 16px", borderRadius: 10, cursor: "pointer", marginTop: 8 }}>+ Add phase</button>
      )}
      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {phases.map((p) => (
          <div key={p.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 12 }}>
              <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 12, color: C.orange, textTransform: "uppercase" }}>{p.label}</span>
              <h3 style={{ fontFamily: HEAD, fontSize: 19, fontWeight: 700, margin: 0, color: C.navy }}>{p.title}</h3>
            </div>
            {p.playbook_tasks.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 14, color: t.done ? C.grayMute : C.gray }}>
                <input type="checkbox" defaultChecked={t.done} disabled={!canEdit}
                  onChange={(e) => startTransition(() => { upsertTask({ id: t.id, phase_id: p.id, text: t.text, assignee_id: t.assignee_id, due_date: t.due_date, done: e.target.checked }); })}
                  style={{ accentColor: C.orange }} />
                <span style={{ flex: 1, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
                <span style={{ fontSize: 12, color: t.assignee_id ? C.navy2 : C.orange, fontWeight: 600 }}>{nameOf(t.assignee_id)}</span>
                {t.due_date && <span style={{ fontSize: 12, color: C.grayMute }}>due {t.due_date.slice(5)}</span>}
                {canEdit && <button onClick={() => startTransition(() => { deleteTask(t.id); })} style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 16 }}>×</button>}
              </div>
            ))}
            {canEdit && (
              <button onClick={() => startTransition(() => { upsertTask({ phase_id: p.id, text: "New task", assignee_id: null, due_date: null, done: false }); })}
                style={{ marginTop: 10, border: `1px dashed ${C.line}`, background: "transparent", color: C.navy2, fontWeight: 600, padding: "8px 14px", borderRadius: 9, cursor: "pointer", width: "100%" }}>+ Add task</button>
            )}
            {p.playbook_tasks.length === 0 && !canEdit && <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>No tasks yet.</div>}
          </div>
        ))}
        {phases.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No playbook yet{canEdit ? " — add the first phase." : "."}</div>}
      </div>
    </>
  );
}

// ---------------- CANDIDATE DRAWER (outreach log + quick-log + warm intro) ----------------
function CandidateDrawer({ c, onClose, startTransition }: {
  c: Cand; canEdit: boolean;
  onClose: () => void; startTransition: (cb: () => void) => void;
}) {
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<{ id: string; body: string; created_at: string }[] | null>(null);
  const QUICK = ["Called — left voicemail", "Emailed", "Met in person", "Scheduled follow-up"];

  // lazy-load outreach when drawer opens (proper effect, not a render side-effect)
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
            <button onClick={() => startTransition(() => { toggleFavorite(c.id, !c.is_favorite); })} style={{ flex: 1, border: `1px solid ${c.is_favorite ? C.gold : C.line}`, background: c.is_favorite ? "#FBF3D6" : "#fff", color: c.is_favorite ? "#8A6D0E" : C.gray, fontWeight: 700, padding: 10, borderRadius: 9, cursor: "pointer", fontSize: 13 }}>{c.is_favorite ? "★ Favorited" : "☆ Favorite"}</button>
            <button onClick={() => startTransition(() => { setNotInterested(c.id, !c.not_interested); })} style={{ flex: 1, border: `1px solid ${C.line}`, background: c.not_interested ? "#EFEFF2" : "#fff", color: C.gray, fontWeight: 700, padding: 10, borderRadius: 9, cursor: "pointer", fontSize: 13 }}>{c.not_interested ? "Unflag" : "Flag not interested"}</button>
          </div>

          {[["Email", c.email], ["GPA", c.gpa]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>{k}</span><span style={{ fontSize: 13, color: C.gray, fontWeight: 600 }}>{v ?? "—"}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, margin: "16px 0 20px" }}>
            <a href={c.linkedin ?? "#"} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, textAlign: "center", textDecoration: "none", border: `1px solid ${C.line}`, background: "#fff", color: c.linkedin ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, pointerEvents: c.linkedin ? "auto" : "none" }}>LinkedIn ↗</a>
            <button
              onClick={() => { if (c.jazz_id) window.open(`/api/resume?jazzId=${encodeURIComponent(c.jazz_id)}`, "_blank"); }}
              disabled={!c.jazz_id}
              style={{ flex: 1, textAlign: "center", border: `1px solid ${C.line}`, background: "#fff", color: c.jazz_id ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, cursor: c.jazz_id ? "pointer" : "not-allowed" }}>Résumé ↗</button>
          </div>

          {/* warm-intro: shared club / same-major teammates */}
          <div style={{ fontFamily: HEAD, fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, marginBottom: 10 }}>Warm intro finder</div>
          <div style={{ background: "#fff", border: `1px dashed ${C.line}`, borderRadius: 9, padding: 13, fontSize: 12.5, color: C.grayMute, marginBottom: 20 }}>
            Connections appear here from logged outreach and the team's connection list. Know this person?{" "}
            <button onClick={() => startTransition(() => { addConnection(c.id, "knows personally"); })} style={{ border: "none", background: "none", color: C.orange, fontWeight: 700, cursor: "pointer", padding: 0 }}>Add a connection</button>.
          </div>

          {/* quick-log */}
          <div style={{ fontFamily: HEAD, fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, marginBottom: 10 }}>Outreach log</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {QUICK.map((q) => <button key={q} onClick={() => doLog(q)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 600, fontSize: 12, padding: "6px 11px", borderRadius: 999, cursor: "pointer" }}>+ {q}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a note…" style={{ flex: 1, padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
            <button onClick={() => { if (draft.trim()) { doLog(draft.trim()); setDraft(""); } }} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 600, padding: "0 16px", borderRadius: 9, cursor: "pointer" }}>Log</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(log ?? []).map((n) => <div key={n.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 13px", fontSize: 13, color: C.gray }}>{n.body}</div>)}
            {(log ?? []).length === 0 && <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>No outreach logged yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
