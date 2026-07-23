"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveSchoolMatch, dismissSchoolMatch, type SchoolMatchReviewRow } from "@/app/(app)/console/actions";
import { ReviewDeck, type DeckApi } from "./ReviewDeck";

// School match review — intake records the phase20 matcher couldn't place:
// unresolved text (no in-group match ≥ 0.60) and tripwires (≥ 0.85 against a
// school in a different group). Shows exactly what was typed, pre-selects the
// best in-group suggestion, and scopes the picker to the entrant's group with
// an "All schools" override for cross-group (tripwire) assignments.
// Resolving stores the raw text as an alias, so it exact-matches from then on.
//
// Presented as a quizlet-style deck: assign or dismiss one card at a time, or
// flip to "Select multiple" to assign several to their suggested school at once.

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434", good: "#2F8F6B",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", gold: "#C9A227",
};
const HEAD = "var(--font-head)";

type School = { id: string; name: string; tier: string };

const GROUP_LABEL: Record<string, string> = { core: "Feeder", satellite: "Satellite", bonus: "Bonus" };
const groupLabel = (tier: string | null) => (tier && GROUP_LABEL[tier]) || "Unscoped";

export default function SchoolMatchReview({ reviews, schools, open, onClose }: {
  reviews: SchoolMatchReviewRow[];
  schools: School[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const schoolById = useMemo(() => new Map(schools.map((s) => [s.id, s])), [schools]);

  const resolve = async (id: string, schoolId: string): Promise<{ error?: string }> => {
    const res = await resolveSchoolMatch(id, schoolId);
    if ("error" in res && res.error) return { error: res.error };
    router.refresh();
    return {};
  };
  const dismiss = async (id: string): Promise<{ error?: string }> => {
    const res = await dismissSchoolMatch(id);
    if ("error" in res && res.error) return { error: res.error };
    router.refresh();
    return {};
  };

  if (!open) return null;

  return (
    <ReviewDeck<SchoolMatchReviewRow>
      title="School match review"
      subtitle="Typed school names the matcher couldn't place. Assigning saves the text as an alias, so it matches automatically next time."
      accent={C.gold}
      items={reviews}
      getKey={(r) => r.id}
      onClose={onClose}
      doneMessage={(n) => `Handled ${n} school match${n === 1 ? "" : "es"}.`}
      bulk={{
        selectable: (r) => !!r.suggested_school_id,
        row: (r) => {
          const s = r.suggested_school_id ? schoolById.get(r.suggested_school_id) : null;
          return (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.gray }}>{r.candidate_name}</div>
              <div style={{ fontSize: 11.5, color: C.grayMute }}>“{r.raw_input}” → {s ? s.name : "—"}</div>
            </div>
          );
        },
        actions: [{
          label: (n) => `Assign ${n} to suggested school`,
          tone: "primary",
          run: async (rows) => {
            for (const r of rows) {
              if (!r.suggested_school_id) continue;
              const res = await resolve(r.id, r.suggested_school_id);
              if (res.error) return res;
            }
            return {};
          },
        }],
        hint: "Only rows with a suggested school can be bulk-assigned; the rest need a manual pick.",
      }}
      renderCard={(r, api) => (
        <SchoolCard r={r} schools={schools} schoolById={schoolById} api={api} onResolve={resolve} onDismiss={dismiss} />
      )}
    />
  );
}

function SchoolCard({ r, schools, schoolById, api, onResolve, onDismiss }: {
  r: SchoolMatchReviewRow;
  schools: School[];
  schoolById: Map<string, School>;
  api: DeckApi;
  onResolve: (id: string, schoolId: string) => Promise<{ error?: string }>;
  onDismiss: (id: string) => Promise<{ error?: string }>;
}) {
  const [pick, setPick] = useState(r.suggested_school_id ?? "");
  const [showAll, setShowAll] = useState(r.reason === "tripwire"); // tripwires need the override
  const cross = r.cross_school_id ? schoolById.get(r.cross_school_id) : null;
  const suggestion = r.suggested_school_id ? schoolById.get(r.suggested_school_id) : null;

  const options = useMemo(() => {
    const scoped = showAll || !r.entrant_tier ? schools : schools.filter((s) => s.tier === r.entrant_tier);
    return [...scoped].sort((a, b) => a.tier.localeCompare(b.tier) || a.name.localeCompare(b.name));
  }, [schools, showAll, r.entrant_tier]);

  const assign = async () => {
    if (!pick || api.busy) return;
    api.setBusy(true); api.setError(null);
    const res = await onResolve(r.id, pick);
    api.setBusy(false);
    if (res.error) { api.setError(res.error); return; }
    api.resolve(r.id);
  };
  const dismiss = async () => {
    if (api.busy) return;
    api.setBusy(true); api.setError(null);
    const res = await onDismiss(r.id);
    api.setBusy(false);
    if (res.error) { api.setError(res.error); return; }
    api.resolve(r.id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: C.navy }}>{r.candidate_name}</span>
        <div style={{ fontSize: 12.5, color: C.grayMute, marginTop: 4 }}>
          typed <b style={{ color: C.gray }}>&ldquo;{r.raw_input}&rdquo;</b> · entered from the <b>{groupLabel(r.entrant_tier)}</b> group
        </div>
      </div>
      {r.reason === "tripwire" && cross && (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#7A5A00", background: "#FFF6DC", border: `1px solid ${C.gold}`, borderRadius: 9, padding: "8px 12px" }}>
          ⚠ Looks like {cross.name} ({groupLabel(cross.tier)} group{r.cross_score != null ? `, ${Math.round(r.cross_score * 100)}%` : ""})
        </div>
      )}
      {r.reason === "unresolved" && suggestion && r.suggested_score != null && (
        <div style={{ fontSize: 12, color: C.grayMute }}>Closest in group: {suggestion.name} ({Math.round(r.suggested_score * 100)}%)</div>
      )}

      <select value={pick} onChange={(e) => setPick(e.target.value)}
        style={{ padding: "10px 12px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5, color: C.gray, background: "#fff" }}>
        <option value="">Choose a school…</option>
        {options.map((s) => <option key={s.id} value={s.id}>{s.name} · {groupLabel(s.tier)}</option>)}
      </select>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {r.entrant_tier && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.grayMute, cursor: "pointer" }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            All groups
          </label>
        )}
        {cross && pick !== r.cross_school_id && (
          <button onClick={() => setPick(r.cross_school_id!)} disabled={api.busy}
            style={{ border: `1px solid ${C.gold}`, background: "#FFF6DC", color: "#7A5A00", fontWeight: 700, fontSize: 12.5, padding: "7px 12px", borderRadius: 8, cursor: "pointer" }}>
            Use {cross.name}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={assign} disabled={api.busy || !pick}
          style={{ border: "none", background: pick && !api.busy ? C.navy : C.navy2, color: "#fff", fontWeight: 700, fontSize: 13, padding: "9px 18px", borderRadius: 9, cursor: pick && !api.busy ? "pointer" : "not-allowed" }}>
          {api.busy ? "Saving…" : "Assign school"}
        </button>
        <button onClick={dismiss} disabled={api.busy}
          style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.grayMute, fontWeight: 600, fontSize: 13, padding: "9px 14px", borderRadius: 9, cursor: api.busy ? "default" : "pointer" }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
