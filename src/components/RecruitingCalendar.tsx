"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addEvent, updateEvent, deleteEvent, setRsvp } from "@/app/(app)/workspace/actions";

const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD", orange: "#DD5434",
  blue: "#8AB9E2", gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B", gold: "#C9A227",
};
const HEAD = "'Cabin', sans-serif";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type CalEvent = {
  id: string; title: string; description: string | null; event_date: string;
  event_type: "attend" | "info"; school_id: string | null; created_by: string | null;
  going: string[]; not_going: string[]; my_status: "going" | "not_going" | null;
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYmd = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

export default function RecruitingCalendar({ events, canEdit, profileId, schoolId, team, accent = C.orange }: {
  events: CalEvent[]; canEdit: boolean; profileId: string; schoolId: string | null;
  team: { id: string; full_name: string }[]; accent?: string;
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

      {/* grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={i} style={{ minHeight: 84, borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, background: "#FCFCFE" }} />;
          const ds = ymd(new Date(year, month, day));
          const isToday = ds === ymd(today);
          const dayEvents = byDay.get(ds) ?? [];
          return (
            <div key={i} onClick={() => canEdit && setAddFor(ds)} style={{ minHeight: 84, padding: 5, borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, cursor: canEdit ? "pointer" : "default", position: "relative" }}>
              <div style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", fontSize: 12, fontWeight: 700, color: isToday ? "#fff" : C.gray, background: isToday ? accent : "transparent", marginBottom: 3 }}>{day}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {dayEvents.map((e) => {
                  const attend = e.event_type === "attend";
                  const tone = attend ? accent : C.navy2;
                  return (
                    <button key={e.id} onClick={(ev) => { ev.stopPropagation(); setSelected(e); }}
                      title={e.title}
                      style={{ display: "flex", alignItems: "center", gap: 4, border: "none", textAlign: "left", width: "100%",
                        background: attend ? `${tone}1a` : "#fff", borderLeft: `3px solid ${tone}`, color: C.gray,
                        fontSize: 10.5, fontWeight: 600, padding: "2px 5px", borderRadius: 4, cursor: "pointer", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {attend && <span style={{ fontSize: 9, color: e.my_status === "going" ? C.good : e.my_status === "not_going" ? C.grayMute : tone }}>{e.my_status === "going" ? "✓" : "●"}</span>}
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
      <div style={{ display: "flex", gap: 16, padding: "10px 18px", fontSize: 11.5, color: C.grayMute }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: accent }} /> Show-up event (RSVP)</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: C.navy2 }} /> Info / deadline</span>
      </div>

      {selected && (
        <EventModal e={selected} canEdit={canEdit} accent={accent} nameOf={nameOf}
          onClose={() => setSelected(null)} onRsvp={doRsvp} onDelete={doDelete} />
      )}
      {addFor && (
        <AddEventModal date={addFor} schoolId={schoolId} accent={accent}
          onClose={() => setAddFor(null)}
          onSaved={() => { setAddFor(null); router.refresh(); }} startTransition={startTransition} />
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", color: C.navy, cursor: "pointer", fontSize: 16, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" };

function EventModal({ e, canEdit, accent, nameOf, onClose, onRsvp, onDelete }: {
  e: CalEvent; canEdit: boolean; accent: string; nameOf: (id: string) => string;
  onClose: () => void; onRsvp: (e: CalEvent, s: "going" | "not_going") => void; onDelete: (id: string) => void;
}) {
  const attend = e.event_type === "attend";
  const dateLabel = parseYmd(e.event_date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <Overlay onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: attend ? accent : C.navy2, background: attend ? `${accent}18` : `${C.navy2}18`, padding: "2px 8px", borderRadius: 999 }}>
          {attend ? "Show-up event" : "Info / deadline"}
        </span>
      </div>
      <h3 style={{ fontFamily: HEAD, fontSize: 20, color: C.navy, margin: "0 0 4px" }}>{e.title}</h3>
      <div style={{ fontSize: 13, color: C.grayMute, marginBottom: 12 }}>{dateLabel}</div>
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

      {canEdit && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.line}`, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={() => onDelete(e.id)} style={{ border: "none", background: "none", color: C.orange, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Delete event</button>
        </div>
      )}
    </Overlay>
  );
}

function AddEventModal({ date, schoolId, accent, onClose, onSaved, startTransition }: {
  date: string; schoolId: string | null; accent: string;
  onClose: () => void; onSaved: () => void; startTransition: (cb: () => void) => void;
}) {
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState(date);
  const [type, setType] = useState<"attend" | "info">("attend");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = { width: "100%", padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 14, boxSizing: "border-box" as const, marginBottom: 12 };

  const save = () => {
    if (!title.trim()) { setError("Title is required."); return; }
    startTransition(() => {
      addEvent({ title, description: description || null, event_date: eventDate, event_type: type, school_id: schoolId }).then((r: any) => {
        if (r?.error) setError(r.error); else onSaved();
      });
    });
  };

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ fontFamily: HEAD, fontSize: 20, color: C.navy, margin: "0 0 16px" }}>Add event</h3>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" style={input} autoFocus />
      <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} style={input} />
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {([["attend", "Show-up event"], ["info", "Info / deadline"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setType(k)} style={{ flex: 1, border: `1px solid ${type === k ? accent : C.line}`, background: type === k ? `${accent}12` : "#fff", color: type === k ? accent : C.gray, fontWeight: 700, padding: "9px", borderRadius: 9, cursor: "pointer", fontSize: 12.5 }}>{label}</button>
        ))}
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={3} style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />
      {type === "attend" && <div style={{ fontSize: 12, color: C.grayMute, marginBottom: 12 }}>Fellows will be asked to RSVP for show-up events.</div>}
      {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "9px 12px", fontSize: 13, color: "#8A3A1E", marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 600, padding: "10px 16px", borderRadius: 9, cursor: "pointer" }}>Cancel</button>
        <button onClick={save} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, padding: "10px 18px", borderRadius: 9, cursor: "pointer" }}>Add event</button>
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
