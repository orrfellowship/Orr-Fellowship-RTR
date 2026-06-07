"use client";

import { useState, useRef, useEffect, useMemo } from "react";

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB",
};

export type PickerPerson = { id: string; full_name: string; role?: string | null };

// Searchable single-select person combobox. Reused for point-person assignment
// (scoped to a school's team) and anywhere a person needs to be chosen from a list.
export default function PersonPicker({
  value, options, onChange, meId,
  placeholder = "Search people…", unassignedLabel = "Unassigned",
  teamOption = false, accent = C.orange, compact = false,
}: {
  value: string | null;
  options: PickerPerson[];
  onChange: (value: string | null, isTeam?: boolean) => void;
  meId?: string;
  placeholder?: string;
  unassignedLabel?: string;
  teamOption?: boolean;       // include a "Whole team" choice (stored by caller)
  accent?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selectedLabel = useMemo(() => {
    if (value === "__team__") return "Whole team";
    if (!value) return unassignedLabel;
    const p = options.find((o) => o.id === value);
    if (!p) return unassignedLabel;
    return p.id === meId ? `${p.full_name} (me)` : p.full_name;
  }, [value, options, meId, unassignedLabel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.full_name.toLowerCase().includes(q)) : options;
  }, [query, options]);

  const isAssigned = value && value !== "__team__";
  const fontSize = compact ? 12 : 13;

  const choose = (v: string | null, isTeam = false) => {
    onChange(v, isTeam);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
          fontSize, fontWeight: 600, color: value === "__team__" ? C.navy2 : (isAssigned ? C.navy : C.orange),
          border: `1px solid ${C.line}`, borderRadius: 7, padding: compact ? "4px 7px" : "6px 9px", background: "#fff", cursor: "pointer" }}>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedLabel}</span>
        <span style={{ color: C.grayMute, fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 80, minWidth: 220, maxWidth: 300,
          background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(11,12,42,.14)", overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: `1px solid ${C.line}` }}>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.line}`, fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto", padding: 4 }}>
            <Row label={unassignedLabel} active={!value} onClick={() => choose(null)} tone={C.orange} />
            {teamOption && <Row label="Whole team" active={value === "__team__"} onClick={() => choose("__team__", true)} tone={C.navy2} />}
            {filtered.map((o) => (
              <Row key={o.id} label={o.id === meId ? `${o.full_name} (me)` : o.full_name}
                badge={o.role === "team_lead" ? "Lead" : undefined}
                active={value === o.id} onClick={() => choose(o.id)} tone={accent} />
            ))}
            {filtered.length === 0 && <div style={{ padding: "10px 12px", fontSize: 12.5, color: C.grayMute, fontStyle: "italic" }}>No matches.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, active, onClick, tone, badge }: { label: string; active: boolean; onClick: () => void; tone: string; badge?: string }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
        border: "none", background: active ? `${tone}14` : "transparent", color: active ? tone : C.gray,
        fontSize: 13, fontWeight: active ? 700 : 500, padding: "8px 10px", borderRadius: 7, cursor: "pointer" }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = C.canvas; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {badge && <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: tone, background: `${tone}18`, padding: "1px 5px", borderRadius: 4 }}>{badge}</span>}
    </button>
  );
}
