"use client";

import { useState, useRef, useEffect } from "react";

// Grouped school filter: Core schools individually + "Satellite School" and
// "Bonus School" group rows, each with a ▸ chevron to expand into the specific
// schools within. Value is "all" | <school_id> | "tier:satellite" | "tier:bonus".
// matchesSchoolFilter() (below) applies the chosen value to a candidate.

const C = {
  navy: "#11123E", navy2: "#485F92", gray: "#33384D", grayMute: "#6E7385",
  line: "#E4E7EE", canvas: "#F7F8FB",
};

export type FilterableSchool = { id: string; name: string; tier: string };

export function schoolTierOf(schools: FilterableSchool[], schoolId: string | null): string | null {
  return schoolId ? (schools.find((s) => s.id === schoolId)?.tier ?? null) : null;
}

// Does a candidate's school_id satisfy the current filter value?
export function matchesSchoolFilter(value: string, schoolId: string | null, schools: FilterableSchool[]): boolean {
  if (value === "all") return true;
  if (value === "tier:satellite") return schoolTierOf(schools, schoolId) === "satellite";
  if (value === "tier:bonus") return schoolTierOf(schools, schoolId) === "bonus";
  return schoolId === value;
}

export default function SchoolFilter({ schools, value, onChange }: {
  schools: FilterableSchool[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expand, setExpand] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const byName = (a: FilterableSchool, b: FilterableSchool) => a.name.localeCompare(b.name);
  const core = schools.filter((s) => s.tier === "core").sort(byName);
  const sat = schools.filter((s) => s.tier === "satellite").sort(byName);
  const bon = schools.filter((s) => s.tier === "bonus").sort(byName);

  const label =
    value === "all" ? "All schools"
    : value === "tier:satellite" ? "Satellite School"
    : value === "tier:bonus" ? "Bonus School"
    : (schools.find((s) => s.id === value)?.name ?? "All schools");

  const sel = (v: string) => { onChange(v); setOpen(false); };
  const rowBase: React.CSSProperties = { display: "flex", alignItems: "center", width: "100%", border: "none", background: "transparent", cursor: "pointer", fontSize: 13.5, color: C.gray, padding: "8px 12px", textAlign: "left" };
  const isActive = (v: string) => value === v;

  const Group = ({ tier, groupLabel, list }: { tier: string; groupLabel: string; list: FilterableSchool[] }) => {
    const tierVal = `tier:${tier}`;
    const exp = !!expand[tier];
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <button onClick={() => sel(tierVal)} style={{ ...rowBase, flex: 1, fontWeight: isActive(tierVal) ? 700 : 500, background: isActive(tierVal) ? C.canvas : "transparent" }}>{groupLabel}</button>
          <button onClick={() => setExpand((p) => ({ ...p, [tier]: !p[tier] }))} title={exp ? "Collapse" : "Expand"}
            style={{ border: "none", background: "transparent", cursor: "pointer", color: C.grayMute, padding: "8px 12px", fontSize: 11 }}>{exp ? "▾" : "▸"}</button>
        </div>
        {exp && list.map((s) => (
          <button key={s.id} onClick={() => sel(s.id)} style={{ ...rowBase, paddingLeft: 28, fontSize: 13, background: isActive(s.id) ? C.canvas : "transparent", color: isActive(s.id) ? C.navy : C.gray, fontWeight: isActive(s.id) ? 700 : 400 }}>{s.name}</button>
        ))}
      </div>
    );
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, background: "#fff", color: value === "all" ? C.grayMute : C.gray, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
        {label} <span style={{ fontSize: 10, color: C.grayMute }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 20, top: "calc(100% + 4px)", left: 0, minWidth: 220, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(17,18,62,.12)", maxHeight: 320, overflowY: "auto", padding: "4px 0" }}>
          <button onClick={() => sel("all")} style={{ ...rowBase, fontWeight: isActive("all") ? 700 : 500, background: isActive("all") ? C.canvas : "transparent" }}>All schools</button>
          {core.length > 0 && <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: C.grayMute, padding: "8px 12px 4px" }}>Core</div>}
          {core.map((s) => (
            <button key={s.id} onClick={() => sel(s.id)} style={{ ...rowBase, background: isActive(s.id) ? C.canvas : "transparent", color: isActive(s.id) ? C.navy : C.gray, fontWeight: isActive(s.id) ? 700 : 400 }}>{s.name}</button>
          ))}
          {sat.length > 0 && <Group tier="satellite" groupLabel="Satellite School" list={sat} />}
          {bon.length > 0 && <Group tier="bonus" groupLabel="Bonus School" list={bon} />}
        </div>
      )}
    </div>
  );
}
