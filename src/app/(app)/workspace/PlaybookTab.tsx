"use client";

import { useState } from "react";
import type { Profile } from "@/lib/types";
import { C, HEAD, MONTHS } from "./constants";
import type { Phase, Task, TeamMember } from "./types";
import { upsertTask, deleteTask, addPhase, updatePhase, deletePhase } from "./actions";

function TaskRow({ task: t, phase, canEdit, team, profile, noteOpen, onToggleNote, nameOf, startTransition }: {
  task: Task; phase: { id: string; title: string };
  canEdit: boolean; team: TeamMember[];
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
          style={{ accentColor: C.navy, flexShrink: 0 }} />

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
            {nameOf(t.assignee_id, t.assignee_label)}
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

export default function PlaybookTab({ phases, profile, canEdit, team, nameOf, accent, startTransition }: {
  phases: Phase[];
  profile: Profile; canEdit: boolean; team: TeamMember[];
  nameOf: (id: string | null, label?: string | null) => string;
  accent: string;
  startTransition: (cb: () => void) => void;
}) {
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set(phases.map((p) => p.id)));
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  const toggleRole = (id: string) => setExpandedRoles((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleNote = (id: string) => setExpandedNotes((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

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
