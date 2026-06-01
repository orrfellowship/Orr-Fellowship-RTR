"use client";

import { useState, useMemo, useTransition } from "react";
import type { Profile } from "@/lib/types";
import { C, HEAD, MONTHS, SOURCED, CONTACTD, APPLIED } from "../constants";
import StagePill from "../StagePill";
import CandidateDrawer from "../CandidateDrawer";
import { upsertTask } from "../actions";
import { phaseOf } from "@/lib/stages";
import type { Cand, TeamMember, Phase, AllGoal } from "../types";

const PHASE_ORDER = ["sourced", "contacted", "applied"] as const;
const PHASE_LABEL: Record<string, string> = { sourced: "Sourced", contacted: "Contacted", applied: "Applied" };
const PHASE_TONE: Record<string, string> = { sourced: "#8591AD", contacted: "#8AB9E2", applied: "#485F92" };

export default function PlanClient({ profile, candidates, team, phases, schoolGoal, accent, canEdit }: {
  profile: Profile;
  candidates: Cand[];
  team: TeamMember[];
  phases: Phase[];
  schoolGoal: AllGoal | null;
  accent: string;
  canEdit: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const open = candidates.find((c) => c.id === openId) ?? null;

  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    candidates.forEach((c) => {
      if (c.not_interested) return;
      const ph = phaseOf(c.stage);
      if (ph && ph !== "rejected" && ph !== "moved") counts[ph] = (counts[ph] ?? 0) + 1;
    });
    return counts;
  }, [candidates]);

  const totalActive = PHASE_ORDER.reduce((s, ph) => s + (phaseCounts[ph] ?? 0), 0);

  const pipelineBoard = useMemo(() => [
    { label: "Sourced",   actual: candidates.filter((c) => c.stage && SOURCED.has(c.stage)).length,  goal: schoolGoal?.goal_sourced   ?? 0 },
    { label: "Contacted", actual: candidates.filter((c) => c.stage && CONTACTD.has(c.stage)).length, goal: schoolGoal?.goal_contacted ?? 0 },
    { label: "Applied",   actual: candidates.filter((c) => c.stage && APPLIED.has(c.stage)).length,  goal: schoolGoal?.goal_applied   ?? 0 },
  ], [candidates, schoolGoal]);

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

  const myTasks = useMemo(() => {
    const results: { task: Phase["playbook_tasks"][0]; roleTitle: string }[] = [];
    for (const p of phases) {
      for (const t of p.playbook_tasks) {
        const mine = t.assignee_id === profile.id;
        const isTeam = t.assignee_label === "team";
        const unassigned = !t.assignee_id && !t.assignee_label;
        if (mine || isTeam || (unassigned && canEdit)) results.push({ task: t, roleTitle: p.title });
      }
    }
    return results;
  }, [phases, profile.id, canEdit]);

  const canToggleTask = (t: Phase["playbook_tasks"][0]) => t.assignee_id === profile.id || canEdit;

  return (
    <>
      <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Weekly Snapshot</h1>
      <p style={{ color: C.grayMute, margin: "4px 0 0" }}>{plan.length} move{plan.length !== 1 ? "s" : ""} queued · {totalActive} active candidates</p>

      {/* Pipeline overview cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 18 }}>
        {pipelineBoard.map((b) => {
          const hasGoal = b.goal > 0;
          const pct = hasGoal ? (b.actual / b.goal) * 100 : 0;
          const tone = pct >= 100 ? C.good : pct >= 70 ? C.gold : C.orange;
          return (
            <div key={b.label} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ background: C.navy, color: "#fff", padding: "14px 18px", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", opacity: 0.8 }}>{b.label}</div>
                <div style={{ fontFamily: HEAD, fontSize: 36, fontWeight: 700, marginTop: 2, lineHeight: 1 }}>{b.actual}</div>
              </div>
              {hasGoal ? (
                <div style={{ padding: "10px 18px", textAlign: "center", background: `${tone}14` }}>
                  <div style={{ fontSize: 11, color: C.grayMute, fontWeight: 600 }}>Goal {b.goal} · {Math.round(pct)}%</div>
                  <div style={{ marginTop: 6, height: 5, borderRadius: 99, background: C.line, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: tone, borderRadius: 99 }} />
                  </div>
                </div>
              ) : (
                <div style={{ padding: "10px 18px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: C.grayMute }}>No goal set</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Stage breakdown bar */}
      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 20px", marginTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 0.8, marginBottom: 12 }}>Pipeline Breakdown</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {PHASE_ORDER.map((ph) => {
            const n = phaseCounts[ph] ?? 0;
            const tone = PHASE_TONE[ph];
            return (
              <div key={ph} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 68, padding: "10px 14px", borderRadius: 10, background: `${tone}14`, border: `1px solid ${tone}44` }}>
                <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 24, color: tone, lineHeight: 1 }}>{n}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: tone, textTransform: "uppercase", letterSpacing: 0.5 }}>{PHASE_LABEL[ph]}</span>
              </div>
            );
          })}
        </div>
        {totalActive > 0 && (
          <div style={{ marginTop: 14, height: 8, borderRadius: 99, background: C.line, overflow: "hidden", display: "flex", gap: 1 }}>
            {PHASE_ORDER.map((ph) => {
              const n = phaseCounts[ph] ?? 0;
              if (!n) return null;
              return <div key={ph} style={{ flex: n, background: PHASE_TONE[ph], borderRadius: 99 }} />;
            })}
          </div>
        )}
      </div>

      {/* My tasks snapshot */}
      {myTasks.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: 18, color: C.navy, margin: "0 0 10px", fontFamily: HEAD }}>
            My Tasks
            <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 600, color: C.grayMute }}>{myTasks.filter((m) => m.task.done).length}/{myTasks.length} complete</span>
          </h2>
          {MONTHS.map((month) => {
            const monthTasks = myTasks.filter((m) => m.task.month_label === month);
            if (!monthTasks.length) return null;
            return (
              <div key={month} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 0.8, marginBottom: 8 }}>{month}</div>
                <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
                  {monthTasks.map(({ task: t, roleTitle }) => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${C.line}`, opacity: t.done ? 0.55 : 1 }}>
                      <input type="checkbox" checked={t.done} disabled={!canToggleTask(t)}
                        title={canToggleTask(t) ? undefined : "Only team leads or admins can update this task"}
                        onChange={(e) => startTransition(() => { upsertTask({ id: t.id, phase_id: "", text: t.text, assignee_id: t.assignee_id, assignee_label: t.assignee_label, month_label: t.month_label, notes: t.notes, due_date: t.due_date, done: e.target.checked }); })}
                        style={{ accentColor: accent, flexShrink: 0, cursor: canToggleTask(t) ? "pointer" : "not-allowed" }} />
                      <span style={{ flex: 1, fontSize: 13.5, color: C.gray, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
                      <span style={{ fontSize: 11, color: C.grayMute, flexShrink: 0 }}>{roleTitle}</span>
                      {t.assignee_label === "team" && <span style={{ fontSize: 10, fontWeight: 700, color: C.navy2, background: `${C.navy2}18`, padding: "2px 7px", borderRadius: 99, flexShrink: 0 }}>Team</span>}
                      {!t.assignee_id && !t.assignee_label && <span style={{ fontSize: 10, fontWeight: 700, color: C.grayMute, background: `${C.grayMute}18`, padding: "2px 7px", borderRadius: 99, flexShrink: 0 }}>Unassigned</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action queue */}
      <h2 style={{ fontSize: 18, color: C.navy, margin: "24px 0 10px", fontFamily: HEAD }}>Action Queue</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {plan.map((a) => (
          <div key={a.id} onClick={() => setOpenId(a.cand.id)} style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `4px solid ${accent}`, borderRadius: 12, padding: "15px 18px", display: "flex", alignItems: "center", gap: 16, cursor: "pointer" }}>
            <span style={{ width: 96, fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: accent }}>{a.type}</span>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: C.gray }}>{a.cand.name}</div><div style={{ fontSize: 13, color: C.grayMute }}>{a.why} · {a.cand.area_of_study}</div></div>
            <StagePill stage={a.cand.stage} />
          </div>
        ))}
        {plan.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>All clear — nothing needs you right now.</div>}
      </div>

      {open && <CandidateDrawer c={open} team={team} profileId={profile.id} onClose={() => setOpenId(null)} />}
    </>
  );
}
