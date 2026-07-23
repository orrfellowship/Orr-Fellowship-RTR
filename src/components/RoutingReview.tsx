"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { fixMisroutedCandidates } from "@/app/(app)/console/actions";
import { candidateSchoolDisplay, findMisrouted, type CandidateSchool } from "@/lib/candidateSchool";
import ContactPopover from "@/components/ContactPopover";
import { ReviewDeck } from "./ReviewDeck";

// School routing review — candidates whose stored school disagrees with where
// their raw imported university text routes today (e.g. "IU Indianapolis"
// dumped in the Bonus group because the routing table didn't recognize it at
// import time). Shows the exact text that came in, the current assignment, and
// the suggested one; admins move rows one at a time or select several at once.
// Manual placements on a specific school are never flagged.

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434", good: "#2F8F6B",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB",
};

export type RoutingCand = { id: string; name: string; email: string | null; school_id: string | null; university_raw: string | null; stage: string | null; source: string | null };
type Flag = { candidate: RoutingCand; expectedSchoolId: string };

export default function RoutingReview({ candidates, schools, open, onClose, onMoved }: {
  candidates: RoutingCand[];
  schools: CandidateSchool[];
  open: boolean;
  onClose: () => void;
  // Lets the parent patch its own candidate state (the list here comes from a
  // client-side snapshot that router.refresh() alone can't update).
  onMoved?: (moves: { id: string; school_id: string }[]) => void;
}) {
  const router = useRouter();
  const flagged = useMemo(() => findMisrouted(candidates, schools), [candidates, schools]) as Flag[];

  const move = async (items: Flag[]): Promise<{ error?: string }> => {
    const r = await fixMisroutedCandidates(items.map((m) => m.candidate.id));
    if (r?.error) return { error: r.error };
    onMoved?.(items.map((m) => ({ id: m.candidate.id, school_id: m.expectedSchoolId })));
    router.refresh();
    return {};
  };

  const suggestedLabel = (m: Flag) =>
    candidateSchoolDisplay({ school_id: m.expectedSchoolId, university_raw: m.candidate.university_raw }, schools).label;

  if (!open) return null;

  return (
    <ReviewDeck<Flag>
      title="School routing review"
      subtitle="Imported school text routes somewhere other than where the candidate is filed. The quoted text is exactly what came in from the import file."
      accent={C.navy}
      items={flagged}
      getKey={(m) => m.candidate.id}
      onClose={onClose}
      doneMessage={(n) => `Moved ${n} candidate${n === 1 ? "" : "s"}.`}
      bulk={{
        row: (m) => (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.gray }}>{m.candidate.name}</div>
            <div style={{ fontSize: 11.5, color: C.grayMute }}>→ {suggestedLabel(m)}</div>
          </div>
        ),
        actions: [{ label: (n) => `Move ${n} selected`, tone: "primary", run: async (items) => move(items) }],
        hint: "Selected candidates move to the school their imported text routes to.",
      }}
      renderCard={(m, api) => {
        const current = candidateSchoolDisplay(m.candidate, schools);
        const run = async () => {
          if (api.busy) return;
          api.setBusy(true); api.setError(null);
          const res = await move([m]);
          api.setBusy(false);
          if (res.error) { api.setError(res.error); return; }
          api.resolve(m.candidate.id);
        };
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 17, color: C.navy }}>
              <ContactPopover name={m.candidate.name} email={m.candidate.email} />
            </div>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px", background: C.canvas, display: "flex", flexDirection: "column", gap: 8 }}>
              <Row label="Imported as" value={`“${(m.candidate.university_raw ?? "").trim()}”`} />
              <Row label="Filed under" value={current.isUnrouted ? "Unrouted" : current.label} tone={C.orange} />
              <Row label="Should be" value={suggestedLabel(m)} tone={C.good} />
            </div>
            <button onClick={run} disabled={api.busy}
              style={{ alignSelf: "flex-start", border: "none", background: C.navy, color: "#fff", fontWeight: 700, fontSize: 13, padding: "9px 18px", borderRadius: 9, cursor: api.busy ? "default" : "pointer" }}>
              {api.busy ? "Moving…" : "Move to suggested school"}
            </button>
          </div>
        );
      }}
    />
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: 10, alignItems: "baseline" }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: "#6E7385" }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: tone ?? "#303333" }}>{value}</span>
    </div>
  );
}
