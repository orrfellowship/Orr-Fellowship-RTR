"use client";

import { useState } from "react";

// Person-centric "Team Tasks" board: an Unassigned group on top, then each team
// member as an expandable card listing the tasks assigned to them. Shared by the
// admin console and the team-lead workspace; each passes its own data + handlers.

const C = {
  navy: "#11123E", navy2: "#485F92", gray: "#303333", grayMute: "#6E7385",
  line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B", gold: "#C9A227",
};
const HEAD = "'Cabin', sans-serif";

export type PBTask = { id: string; phaseId: string; phaseTitle: string; text: string; assigneeId: string | null; dueDate: string | null; done: boolean };
export type PBMember = { id: string; full_name: string };
export type PBPatch = { text?: string; phaseId?: string; dueDate?: string | null; assigneeId?: string | null; done?: boolean };

const UNASSIGNED = "__unassigned__";

export default function PlaybookBoard({
  phases, members, tasks, meId, accent = "#DD5434", canEdit = true,
  onAddTask, onUpdateTask, onDeleteTask,
}: {
  phases: { id: string; title: string }[];
  members: PBMember[];
  tasks: PBTask[];
  meId?: string;
  accent?: string;
  canEdit?: boolean;
  onAddTask: (assigneeId: string | null, phaseId: string) => void;
  onUpdateTask: (taskId: string, patch: PBPatch) => void;
  onDeleteTask: (taskId: string) => void;
}) {
  const memberIds = new Set(members.map((m) => m.id));
  const groupOf = (t: PBTask) => (t.assigneeId && memberIds.has(t.assigneeId)) ? t.assigneeId : UNASSIGNED;
  const groups = [{ id: UNASSIGNED, name: "Unassigned" }, ...members.map((m) => ({ id: m.id, name: m.full_name }))];
  // Unassigned starts open (that's where the lead drops new work); people collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set([UNASSIGNED]));
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const firstPhaseId = phases[0]?.id ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {groups.map((g) => {
        const isUn = g.id === UNASSIGNED;
        const gTasks = tasks.filter((t) => groupOf(t) === g.id);
        const done = gTasks.filter((t) => t.done).length;
        const pct = gTasks.length > 0 ? Math.round((done / gTasks.length) * 100) : 0;
        const isOpen = expanded.has(g.id);
        return (
          <div key={g.id} style={{ background: "#fff", border: `1px solid ${isUn ? accent + "66" : C.line}`, borderRadius: 14, overflow: "hidden" }}>
            <button onClick={() => toggle(g.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", border: "none", background: isOpen ? C.canvas : "#fff", cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 14, color: "#fff", background: isUn ? C.grayMute : accent }}>
                {isUn ? "?" : g.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {isUn ? "Unassigned" : g.name}{g.id === meId ? " (you)" : ""}
                </div>
                <div style={{ fontSize: 12, color: C.grayMute }}>{gTasks.length} task{gTasks.length !== 1 ? "s" : ""}{gTasks.length > 0 ? ` · ${done} done` : ""}</div>
              </div>
              {gTasks.length > 0 && (
                <div style={{ width: 64, height: 5, borderRadius: 99, background: C.line, overflow: "hidden", flexShrink: 0 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? C.good : pct >= 50 ? C.gold : accent }} />
                </div>
              )}
              <span style={{ color: C.grayMute, fontSize: 14, flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
            </button>

            {isOpen && (
              <div style={{ padding: "4px 14px 14px", borderTop: `1px solid ${C.line}` }}>
                {gTasks.map((t) => (
                  <TaskRow key={t.id} t={t} phases={phases} members={members} accent={accent} canEdit={canEdit}
                    onUpdate={(patch) => onUpdateTask(t.id, patch)} onDelete={() => onDeleteTask(t.id)} />
                ))}
                {gTasks.length === 0 && (
                  <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic", padding: "10px 4px" }}>
                    {isUn ? "No unassigned tasks." : "No tasks yet."}
                  </div>
                )}
                {canEdit && (
                  <button
                    onClick={() => { if (!firstPhaseId) { alert("Add a date first using “+ Add date”."); return; } onAddTask(isUn ? null : g.id, firstPhaseId); }}
                    style={{ marginTop: 8, border: `1px dashed ${C.line}`, background: "transparent", color: C.navy2, fontWeight: 600, fontSize: 13, padding: "8px 14px", borderRadius: 9, cursor: "pointer", width: "100%" }}>
                    + Add task{isUn ? "" : ` for ${g.name.split(" ")[0]}`}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TaskRow({ t, phases, members, accent, canEdit, onUpdate, onDelete }: {
  t: PBTask; phases: { id: string; title: string }[]; members: PBMember[];
  accent: string; canEdit: boolean; onUpdate: (patch: PBPatch) => void; onDelete: () => void;
}) {
  const ctrl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.navy2, border: `1px solid ${C.line}`, borderRadius: 7, padding: "4px 6px", background: "#fff", flexShrink: 0 };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px", borderBottom: `1px solid ${C.line}88`, flexWrap: "wrap" }}>
      <input type="checkbox" checked={t.done} disabled={!canEdit}
        onChange={(e) => onUpdate({ done: e.target.checked })}
        style={{ accentColor: accent, flexShrink: 0, width: 16, height: 16 }} />
      {canEdit ? (
        <input defaultValue={t.text} key={t.text}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.text) onUpdate({ text: v }); }}
          style={{ flex: "1 1 200px", minWidth: 140, border: "none", background: "transparent", fontSize: 14, color: t.done ? C.grayMute : C.gray, textDecoration: t.done ? "line-through" : "none", outline: "none" }} />
      ) : (
        <span style={{ flex: "1 1 200px", minWidth: 140, fontSize: 14, color: t.done ? C.grayMute : C.gray, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
      )}
      {/* Date (which month phase the task lives under) */}
      <select value={t.phaseId} disabled={!canEdit} onChange={(e) => onUpdate({ phaseId: e.target.value })} style={{ ...ctrl, cursor: canEdit ? "pointer" : "default" }}>
        {phases.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
      {/* Optional specific due date */}
      <input type="date" value={t.dueDate ?? ""} disabled={!canEdit} onChange={(e) => onUpdate({ dueDate: e.target.value || null })}
        style={{ ...ctrl, color: t.dueDate ? C.navy2 : C.grayMute }} />
      {/* Who it's assigned to */}
      <select value={t.assigneeId ?? ""} disabled={!canEdit} onChange={(e) => onUpdate({ assigneeId: e.target.value || null })}
        style={{ ...ctrl, color: t.assigneeId ? C.navy2 : accent, cursor: canEdit ? "pointer" : "default" }}>
        <option value="">Unassigned</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
      </select>
      {canEdit && (
        <button onClick={onDelete} title="Delete task" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 16, flexShrink: 0 }}>×</button>
      )}
    </div>
  );
}
