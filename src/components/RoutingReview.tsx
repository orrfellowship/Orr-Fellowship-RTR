"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fixMisroutedCandidates } from "@/app/(app)/console/actions";
import { candidateSchoolDisplay, findMisrouted, type CandidateSchool } from "@/lib/candidateSchool";
import ContactPopover from "@/components/ContactPopover";
import PaginationControls from "@/components/PaginationControls";

// School routing review — candidates whose stored school disagrees with where
// their raw imported university text routes today (e.g. "IU Indianapolis"
// dumped in the Bonus group because the routing table didn't recognize it at
// import time). Shows the exact text that came in from the import file, the
// current assignment, and the suggested one; admins fix rows one at a time or
// all at once. Manual placements on a specific school are never flagged.

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434", good: "#2F8F6B",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB",
};

export type RoutingCand = { id: string; name: string; email: string | null; school_id: string | null; university_raw: string | null; stage: string | null; source: string | null };

export default function RoutingReview({ candidates, schools, onMoved }: {
  candidates: RoutingCand[];
  schools: CandidateSchool[];
  // Lets the parent patch its own candidate state (the list here comes from a
  // client-side snapshot that router.refresh() alone can't update).
  onMoved?: (moves: { id: string; school_id: string }[]) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fixedIds, setFixedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null); // candidate id or "__all__"
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const flagged = useMemo(
    () => findMisrouted(candidates.filter((c) => !fixedIds.has(c.id)), schools),
    [candidates, schools, fixedIds],
  );

  const suggestedLabel = (m: { candidate: RoutingCand; expectedSchoolId: string }) =>
    candidateSchoolDisplay({ school_id: m.expectedSchoolId, university_raw: m.candidate.university_raw }, schools).label;
  const safePage = Math.min(page, Math.max(0, Math.ceil(flagged.length / pageSize) - 1));
  const shown = flagged.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const apply = (items: { candidate: RoutingCand; expectedSchoolId: string }[], busy: string) => {
    setBusyId(busy); setError(null);
    startTransition(() => {
      fixMisroutedCandidates(items.map((m) => m.candidate.id)).then((r) => {
        setBusyId(null);
        if (r?.error) { setError(r.error); return; }
        setFixedIds((prev) => { const next = new Set(prev); for (const m of items) next.add(m.candidate.id); return next; });
        onMoved?.(items.map((m) => ({ id: m.candidate.id, school_id: m.expectedSchoolId })));
        router.refresh();
      });
    });
  };

  if (flagged.length === 0) {
    return <div style={{ fontSize: 13.5, color: C.grayMute, fontStyle: "italic" }}>No routing issues found — every candidate&apos;s school matches where their imported university text routes.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: pending ? 0.7 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, fontSize: 12.5, color: C.grayMute, minWidth: 220 }}>
          {flagged.length} candidate{flagged.length === 1 ? "" : "s"} whose imported school text routes somewhere other than where they&apos;re filed. The quoted text is exactly what came in from the import file.
        </div>
        <button onClick={() => apply(flagged, "__all__")} disabled={pending}
          style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 700, fontSize: 12.5, padding: "8px 16px", borderRadius: 9, cursor: pending ? "default" : "pointer", flexShrink: 0 }}>
          {busyId === "__all__" ? "Fixing…" : `Fix all ${flagged.length}`}
        </button>
      </div>
      {error && <div style={{ background: "#FBE7DF", border: `1px solid ${C.orange}`, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "#8A3A1E" }}>{error}</div>}

      <PaginationControls page={safePage} pageSize={pageSize} total={flagged.length} onPageChange={setPage} onPageSizeChange={(size) => { setPage(0); setPageSize(size); }} />

      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        {shown.map((m, i) => {
          const c = m.candidate;
          const current = candidateSchoolDisplay(c, schools);
          return (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.gray }}>
                  <ContactPopover name={c.name} email={c.email} />
                  <span style={{ fontWeight: 400, color: C.grayMute }}> · imported as &ldquo;{(c.university_raw ?? "").trim()}&rdquo;</span>
                </div>
                <div style={{ fontSize: 12, color: C.grayMute, marginTop: 2 }}>
                  <span style={{ color: C.orange, fontWeight: 600 }}>{current.isUnrouted ? "Unrouted" : current.label}</span>
                  {" → "}
                  <span style={{ color: C.good, fontWeight: 600 }}>{suggestedLabel(m)}</span>
                  {c.email ? ` · ${c.email}` : ""}
                </div>
              </div>
              <button onClick={() => apply([m], c.id)} disabled={pending}
                style={{ border: `1px solid ${C.navy2}`, background: "#fff", color: C.navy2, fontWeight: 700, fontSize: 12, padding: "6px 12px", borderRadius: 8, cursor: pending ? "default" : "pointer", flexShrink: 0 }}>
                {busyId === c.id ? "…" : "Move"}
              </button>
            </div>
          );
        })}
      </div>
      <PaginationControls page={safePage} pageSize={pageSize} total={flagged.length} onPageChange={setPage} onPageSizeChange={(size) => { setPage(0); setPageSize(size); }} />
    </div>
  );
}
