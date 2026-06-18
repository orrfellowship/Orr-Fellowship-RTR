"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addEvent, updateEvent, deleteEvent, setRsvp, addEventNote, deleteEventNote } from "@/app/(app)/workspace/actions";

const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD", orange: "#DD5434",
  blue: "#8AB9E2", gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B", gold: "#C9A227",
};
const HEAD = "'Cabin', sans-serif";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type EventNote = { id: string; school_id: string; body: string; created_by: string | null };
export type CalEvent = {
  id: string; title: string; description: string | null; address: string | null; event_date: string;
  event_type: EventType; school_id: string | null; created_by: string | null;
  going: string[]; not_going: string[]; my_status: "going" | "not_going" | null;
  notes?: EventNote[];
};
export type EventType = "attend" | "info" | "deadline";

const EVENT_TYPES: { key: EventType; label: string; tone: string; fill: (accent: string) => string }[] = [
  { key: "attend", label: "Show-up event", tone: C.orange, fill: (accent) => `${accent}1a` },
  { key: "info", label: "Info", tone: C.navy2, fill: () => "#fff" },
  { key: "deadline", label: "Deadline", tone: C.gold, fill: () => "#fff" },
];
const eventMeta = (type: EventType, accent: string) => {
  const meta = EVENT_TYPES.find((t) => t.key === type) ?? EVENT_TYPES[1];
  return { ...meta, tone: type === "attend" ? accent : meta.tone, fillColor: meta.fill(accent) };
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYmd = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

export default function RecruitingCalendar({ events, canEdit, profileId, schoolId, team, accent = C.orange, schools, scopePicker = false, canManageNotes = false }: {
  events: CalEvent[]; canEdit: boolean; profileId: string; schoolId: string | null;
  team: { id: string; full_name: string }[]; accent?: string;
  // When scopePicker is set (admin calendar), the add form lets the user choose
  // org-wide vs. a specific school from `schools`. Otherwise events use schoolId.
  schools?: { id: string; name: string }[]; scopePicker?: boolean;
  // Admins can attach per-school notes to an event (team leads only view theirs).
  canManageNotes?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = new Date();
  // Start on the month of the next upcoming event, else today.
  const initial = useMemo(() => {
    const upcoming = [...events].map((e) => e.event_date).filter((d) => d >= ymd(today)).sort()[0];
    return upcoming ? parseYmd(upcoming) : today;
  }, []); // eslint-disable-line
  const [cursor, setCursor] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null); // date string for the add form
  const [editFor, setEditFor] = useState<CalEvent | null>(null); // event being edited

  const nameOf = (id: string) => (id === profileId ? "You" : team.find((t) => t.id === id)?.full_name ?? "Someone");

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) (m.get(e.event_date) ?? m.set(e.event_date, []).get(e.event_date)!).push(e);
    return m;
  }, [events]);

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const doRsvp = (e: CalEvent, status: "going" | "not_going") => startTransition(() => {
    setRsvp(e.id, e.my_status === status ? null : status).then(() => router.refresh());
    setSelected(null);
  });
  const doDelete = (id: string) => { if (confirm("Delete this event?")) startTransition(() => { deleteEvent(id).then(() => router.refresh()); setSelected(null); }); };
  const doAddNote = (eventId: string, schoolId: string, body: string) => startTransition(() => { addEventNote(eventId, schoolId, body).then(() => router.refresh()); });
  const doDelNote = (id: string) => startTransition(() => { deleteEventNote(id).then(() => router.refresh()); });

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", opacity: pending ? 0.7 : 1 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: C.navy, flex: 1 }}>{MONTHS[month]} {year}</div>
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} style={navBtn}>‹</button>
        <button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} style={{ ...navBtn, width: "auto", padding: "0 10px", fontSize: 12, fontWeight: 700 }}>Today</button>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} style={navBtn}>›</button>
        {canEdit && (
          <button onClick={() => setAddFor(ymd(today))} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, fontSize: 12.5, padding: "7px 13px", borderRadius: 8, cursor: "pointer", marginLeft: 4 }}>+ Add event</button>
        )}
      </div>

      {/* day-of-week row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: `1px solid ${C.line}`, background: C.canvas }}>
        {DOW.map((d) => <div key={d} style={{ padding: "7px 0", textAlign: "center", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: C.grayMute }}>{d}</div>)}
      </div>

      {/* grid — every day is a fixed-height cell; extra events scroll inside it
          so adding events never resizes the row. */}
      <style>{`.orr-cal-events::-webkit-scrollbar { width: 4px; } .orr-cal-events::-webkit-scrollbar-thumb { background: #d8dce5; border-radius: 4px; }`}</style>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "96px" }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={i} style={{ borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, background: "#FCFCFE" }} />;
          const ds = ymd(new Date(year, month, day));
          const isToday = ds === ymd(today);
          const dayEvents = byDay.get(ds) ?? [];
          return (
            <div key={i} onClick={() => canEdit && setAddFor(ds)} style={{ padding: 5, borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, cursor: canEdit ? "pointer" : "default", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", fontSize: 12, fontWeight: 700, color: isToday ? "#fff" : C.gray, background: isToday ? accent : "transparent", marginBottom: 3, flexShrink: 0 }}>{day}</div>
              <div className="orr-cal-events" style={{ display: "flex", flexDirection: "column", gap: 3, overflowY: "auto", flex: 1, minHeight: 0 }}>
                {dayEvents.map((e) => {
                  const attend = e.event_type === "attend";
                  const meta = eventMeta(e.event_type, accent);
                  return (
                    <button key={e.id} onClick={(ev) => { ev.stopPropagation(); setSelected(e); }}
                      title={e.title}
                      style={{ display: "flex", alignItems: "center", gap: 4, border: "none", textAlign: "left", width: "100%", flexShrink: 0,
                        background: meta.fillColor, borderLeft: `3px solid ${meta.tone}`, color: C.gray,
                        fontSize: 10.5, fontWeight: 600, padding: "2px 5px", borderRadius: 4, cursor: "pointer", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {attend && <span style={{ fontSize: 9, color: e.my_status === "going" ? C.good : e.my_status === "not_going" ? C.grayMute : meta.tone }}>{e.my_status === "going" ? "✓" : "●"}</span>}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "10px 18px", fontSize: 11.5, color: C.grayMute }}>
        {EVENT_TYPES.map((t) => {
          const meta = eventMeta(t.key, accent);
          return (
            <span key={t.key} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: meta.tone }} /> {t.label}{t.key === "attend" ? " (RSVP)" : ""}
            </span>
          );
        })}
      </div>

      {selected && (
        <EventModal e={selected} canEdit={canEdit} accent={accent} nameOf={nameOf}
          schools={schools ?? []} canManageNotes={canManageNotes}
          onClose={() => setSelected(null)} onRsvp={doRsvp} onDelete={doDelete}
          onEdit={(ev) => { setSelected(null); setEditFor(ev); }}
          onAddNote={doAddNote} onDeleteNote={doDelNote} />
      )}
      {addFor && (
        <AddEventModal date={addFor} schoolId={schoolId} accent={accent}
          schools={schools ?? []} scopePicker={scopePicker}
          onClose={() => setAddFor(null)}
          onSaved={() => { setAddFor(null); router.refresh(); }} startTransition={startTransition} />
      )}
      {editFor && (
        <AddEventModal date={editFor.event_date} schoolId={schoolId} accent={accent}
          schools={schools ?? []} scopePicker={scopePicker} editing={editFor}
          onClose={() => setEditFor(null)}
          onSaved={() => { setEditFor(null); router.refresh(); }} startTransition={startTransition} />
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", color: C.navy, cursor: "pointer", fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" };

function EventModal({ e, canEdit, accent, nameOf, schools, canManageNotes, onClose, onRsvp, onDelete, onEdit, onAddNote, onDeleteNote }: {
  e: CalEvent; canEdit: boolean; accent: string; nameOf: (id: string) => string;
  schools: { id: string; name: string }[]; canManageNotes: boolean;
  onClose: () => void; onRsvp: (e: CalEvent, s: "going" | "not_going") => void; onDelete: (id: string) => void; onEdit: (e: CalEvent) => void;
  onAddNote: (eventId: string, schoolId: string, body: string) => void; onDeleteNote: (id: string) => void;
}) {
  const attend = e.event_type === "attend";
  const meta = eventMeta(e.event_type, accent);
  const dateLabel = parseYmd(e.event_date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const [notes, setNotes] = useState<EventNote[]>(e.notes ?? []);
  const [noteSchool, setNoteSchool] = useState<string>(e.school_id ?? (schools[0]?.id ?? ""));
  const [noteBody, setNoteBody] = useState("");
  const schoolName = (id: string) => schools.find((s) => s.id === id)?.name ?? "School";
  const addNote = () => {
    if (!noteBody.trim() || !noteSchool) return;
    onAddNote(e.id, noteSchool, noteBody.trim());
    setNotes((prev) => [...prev, { id: `tmp-${Math.random()}`, school_id: noteSchool, body: noteBody.trim(), created_by: null }]);
    setNoteBody("");
  };
  const delNote = (id: string) => { onDeleteNote(id); setNotes((prev) => prev.filter((n) => n.id !== id)); };
  return (
    <Overlay onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: meta.tone, background: `${meta.tone}18`, padding: "2px 8px", borderRadius: 999 }}>
          {meta.label}
        </span>
      </div>
      <h3 style={{ fontFamily: HEAD, fontSize: 20, color: C.navy, margin: "0 0 4px" }}>{e.title}</h3>
      <div style={{ fontSize: 13, color: C.grayMute, marginBottom: e.address ? 6 : 12 }}>{dateLabel}</div>
      {e.address && (
        <a href={`https://maps.google.com/?q=${encodeURIComponent(e.address)}`} target="_blank" rel="noreferrer"
          style={{ display: "inline-flex", alignItems: "flex-start", gap: 6, fontSize: 13, color: C.navy2, textDecoration: "none", marginBottom: 12 }}>
          <span aria-hidden style={{ flexShrink: 0 }}>📍</span><span>{e.address}</span>
        </a>
      )}
      {e.description && <p style={{ fontSize: 13.5, color: C.gray, lineHeight: 1.5, marginTop: 0 }}>{e.description}</p>}

      {attend && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => onRsvp(e, "going")} style={{ flex: 1, border: `1px solid ${e.my_status === "going" ? C.good : C.line}`, background: e.my_status === "going" ? "#E8F5EE" : "#fff", color: e.my_status === "going" ? "#1B5E3F" : C.gray, fontWeight: 700, padding: "9px", borderRadius: 9, cursor: "pointer", fontSize: 13 }}>✓ Going</button>
            <button onClick={() => onRsvp(e, "not_going")} style={{ flex: 1, border: `1px solid ${e.my_status === "not_going" ? C.navy3 : C.line}`, background: e.my_status === "not_going" ? "#EFEFF2" : "#fff", color: C.gray, fontWeight: 700, padding: "9px", borderRadius: 9, cursor: "pointer", fontSize: 13 }}>Can't make it</button>
          </div>
          <div style={{ fontSize: 12.5, color: C.grayMute }}>
            <b style={{ color: C.good }}>{e.going.length} going</b>{e.not_going.length > 0 && ` · ${e.not_going.length} can't`}
            {e.going.length > 0 && <div style={{ marginTop: 4, color: C.gray }}>{e.going.map(nameOf).join(", ")}</div>}
          </div>
        </div>
      )}

      {(notes.length > 0 || canManageNotes) && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: C.grayMute, marginBottom: 8 }}>
            {canManageNotes ? "School notes" : "Notes for your school"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: canManageNotes ? 10 : 0 }}>
            {notes.map((n) => (
              <div key={n.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, color: C.gray, background: C.canvas, borderRadius: 8, padding: "8px 10px" }}>
                <span style={{ flex: 1 }}>{canManageNotes && <b style={{ color: C.navy2 }}>{schoolName(n.school_id)}: </b>}{n.body}</span>
                {canManageNotes && <button onClick={() => delNote(n.id)} title="Remove" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 15, lineHeight: 1, flexShrink: 0 }}>×</button>}
              </div>
            ))}
            {notes.length === 0 && canManageNotes && <div style={{ fontSize: 12.5, color: C.grayMute, fontStyle: "italic" }}>No school notes yet — these go only to the chosen school's team lead.</div>}
          </div>
          {canManageNotes && (
            <div style={{ display: "flex", gap: 6 }}>
              <select value={noteSchool} onChange={(ev) => setNoteSchool(ev.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 13, background: "#fff", maxWidth: 150 }}>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input value={noteBody} onChange={(ev) => setNoteBody(ev.target.value)} placeholder="Note for this school…" style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 13 }} />
              <button onClick={addNote} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 600, padding: "0 14px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Add</button>
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => onEdit(e)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 700, fontSize: 12.5, padding: "7px 14px", borderRadius: 8, cursor: "pointer" }}>Edit event</button>
          <button onClick={() => onDelete(e.id)} style={{ border: "none", background: "none", color: C.orange, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Delete event</button>
        </div>
      )}
    </Overlay>
  );
}

function AddEventModal({ date, schoolId, accent, schools, scopePicker, editing, onClose, onSaved, startTransition }: {
  date: string; schoolId: string | null; accent: string;
  schools: { id: string; name: string }[]; scopePicker: boolean; editing?: CalEvent | null;
  onClose: () => void; onSaved: () => void; startTransition: (cb: () => void) => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [eventDate, setEventDate] = useState(editing?.event_date ?? date);
  const [type, setType] = useState<EventType>(editing?.event_type ?? "attend");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [address, setAddress] = useState(editing?.address ?? "");
  // "" = org-wide; otherwise a school id. Non-picker callers always use schoolId.
  const [scope, setScope] = useState<string>(editing?.school_id ?? schoolId ?? "");
  const [error, setError] = useState<string | null>(null);
  const input = { width: "100%", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" as const, marginBottom: 12 };

  const save = () => {
    if (!title.trim()) { setError("Title is required."); return; }
    startTransition(() => {
      const done = (r: any) => { if (r?.error) setError(r.error); else onSaved(); };
      if (editing) {
        updateEvent(editing.id, { title, description: description || null, address: address || null, event_date: eventDate, event_type: type }).then(done);
      } else {
        const targetSchool = scopePicker ? (scope || null) : schoolId;
        addEvent({ title, description: description || null, address: address || null, event_date: eventDate, event_type: type, school_id: targetSchool }).then(done);
      }
    });
  };

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ fontFamily: HEAD, fontSize: 20, color: C.navy, margin: "0 0 16px" }}>{editing ? "Edit event" : "Add event"}</h3>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" style={input} autoFocus />
      <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} style={input} />
      {scopePicker && !editing && (
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ ...input, cursor: "pointer" }}>
          <option value="">🌐 Organization-wide (everyone)</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {EVENT_TYPES.map(({ key, label }) => {
          const meta = eventMeta(key, accent);
          return (
            <button key={key} onClick={() => setType(key)} style={{ flex: 1, border: `1px solid ${type === key ? meta.tone : C.line}`, background: type === key ? `${meta.tone}12` : "#fff", color: type === key ? meta.tone : C.gray, fontWeight: 700, padding: "9px", borderRadius: 9, cursor: "pointer", fontSize: 12.5 }}>{label}</button>
          );
        })}
      </div>
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address / location (optional)" style={input} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={3} style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />
      {type === "attend" && <div style={{ fontSize: 12, color: C.grayMute, marginBottom: 12 }}>Fellows will be asked to RSVP for show-up events.</div>}
      {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "9px 12px", fontSize: 13, color: "#8A3A1E", marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "10px 16px", borderRadius: 9, cursor: "pointer" }}>Cancel</button>
        <button onClick={save} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, padding: "10px 18px", borderRadius: 9, cursor: "pointer" }}>{editing ? "Save changes" : "Add event"}</button>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 24, width: 420, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        {children}
      </div>
    </div>
  );
}
