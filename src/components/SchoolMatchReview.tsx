"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveSchoolMatch, dismissSchoolMatch, type SchoolMatchReviewRow } from "@/app/(app)/console/actions";

// School match review — intake records the phase20 matcher couldn't place:
// unresolved text (no in-group match ≥ 0.60) and tripwires (≥ 0.85 against a
// school in a different group). Shows exactly what was typed, pre-selects the
// best in-group suggestion, and scopes the picker to the entrant's group with
// an "All schools" override for cross-group (tripwire) assignments.
// Resolving stores the raw text as an alias, so it exact-matches from then on.

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434", good: "#2F8F6B",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", gold: "#C9A227",
};
const HEAD = "var(--font-head)";

type School = { id: string; name: string; tier: string };

const GROUP_LABEL: Record<string, string> = { core: "Feeder", satellite: "Satellite", bonus: "Bonus" };
const groupLabel = (tier: string | null) => (tier && GROUP_LABEL[tier]) || "Unscoped";

export default function SchoolMatchReview({ reviews, schools }: {
  reviews: SchoolMatchReviewRow[];
  schools: School[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-review UI state: the picked school and whether the picker shows every group.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [allSchools, setAllSchools] = useState<Record<string, boolean>>({});

  const schoolById = useMemo(() => new Map(schools.map((s) => [s.id, s])), [schools]);
  const open = reviews.filter((r) => !handled.has(r.id));

  const pickFor = (r: SchoolMatchReviewRow) => picks[r.id] ?? r.suggested_school_id ?? "";
  const optionsFor = (r: SchoolMatchReviewRow) => {
    const showAll = allSchools[r.id] ?? r.reason === "tripwire"; // tripwires need the override
    const scoped = showAll || !r.entrant_tier ? schools : schools.filter((s) => s.tier === r.entrant_tier);
    return [...scoped].sort((a, b) => a.tier.localeCompare(b.tier) || a.name.localeCompare(b.name));
  };

  const act = (r: SchoolMatchReviewRow, fn: () => Promise<{ error?: string } | { ok: true }>) => {
    setBusyId(r.id); setError(null);
    startTransition(() => {
      fn().then((res) => {
        setBusyId(null);
        if ("error" in res && res.error) { setError(res.error); return; }
        setHandled((prev) => new Set(prev).add(r.id));
        router.refresh();
      });
    });
  };

  if (open.length === 0) {
    return <div style={{ color: C.grayMute, fontSize: 13.5 }}>All school matches are resolved. 🎉</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "9px 12px", fontSize: 13, color: "#8A3A1E" }}>{error}</div>}
      {open.map((r) => {
        const cross = r.cross_school_id ? schoolById.get(r.cross_school_id) : null;
        const suggestion = r.suggested_school_id ? schoolById.get(r.suggested_school_id) : null;
        const busy = busyId === r.id && pending;
        return (
          <div key={r.id} style={{ border: `1px solid ${r.reason === "tripwire" ? C.gold : C.line}`, borderRadius: 12, padding: "14px 16px", background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 14.5, color: C.navy }}>{r.candidate_name}</span>
              <span style={{ fontSize: 12.5, color: C.grayMute }}>
                typed <b style={{ color: C.gray }}>&ldquo;{r.raw_input}&rdquo;</b> · entered from the <b>{groupLabel(r.entrant_tier)}</b> group
              </span>
              {r.reason === "tripwire" && cross && (
                <span style={{ fontSize: 12, fontWeight: 700, color: "#7A5A00", background: "#FFF6DC", border: `1px solid ${C.gold}`, borderRadius: 999, padding: "2px 10px" }}>
                  ⚠ Looks like {cross.name} ({groupLabel(cross.tier)} group{r.cross_score != null ? `, ${Math.round(r.cross_score * 100)}%` : ""})
                </span>
              )}
              {r.reason === "unresolved" && suggestion && r.suggested_score != null && (
                <span style={{ fontSize: 12, color: C.grayMute }}>closest in group: {suggestion.name} ({Math.round(r.suggested_score * 100)}%)</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <select value={pickFor(r)} onChange={(e) => setPicks((p) => ({ ...p, [r.id]: e.target.value }))}
                style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 13, minWidth: 220, color: C.gray, background: "#fff" }}>
                <option value="">Choose a school…</option>
                {optionsFor(r).map((s) => <option key={s.id} value={s.id}>{s.name} · {groupLabel(s.tier)}</option>)}
              </select>
              {r.entrant_tier && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.grayMute, cursor: "pointer" }}>
                  <input type="checkbox" checked={allSchools[r.id] ?? r.reason === "tripwire"}
                    onChange={(e) => setAllSchools((p) => ({ ...p, [r.id]: e.target.checked }))} />
                  All groups
                </label>
              )}
              {cross && pickFor(r) !== r.cross_school_id && (
                <button onClick={() => setPicks((p) => ({ ...p, [r.id]: r.cross_school_id! }))} disabled={busy}
                  style={{ border: `1px solid ${C.gold}`, background: "#FFF6DC", color: "#7A5A00", fontWeight: 700, fontSize: 12.5, padding: "7px 12px", borderRadius: 8, cursor: "pointer" }}>
                  Use {cross.name}
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={() => act(r, () => dismissSchoolMatch(r.id))} disabled={busy}
                style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.grayMute, fontWeight: 600, fontSize: 12.5, padding: "8px 13px", borderRadius: 8, cursor: "pointer" }}>
                Dismiss
              </button>
              <button onClick={() => { const pick = pickFor(r); if (pick) act(r, () => resolveSchoolMatch(r.id, pick)); }}
                disabled={busy || !pickFor(r)}
                style={{ border: "none", background: pickFor(r) && !busy ? C.navy : C.navy2, color: "#fff", fontWeight: 700, fontSize: 12.5, padding: "8px 16px", borderRadius: 8, cursor: pickFor(r) && !busy ? "pointer" : "not-allowed" }}>
                {busy ? "Saving…" : "Assign school"}
              </button>
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 12, color: C.grayMute }}>
        Assigning also saves what was typed as an alias for that school, so the same text matches automatically next time.
      </div>
    </div>
  );
}
