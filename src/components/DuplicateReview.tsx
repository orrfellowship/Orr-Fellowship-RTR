"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCandidate } from "@/app/(app)/console/actions";
import { candidateSchoolDisplay } from "@/lib/candidateSchool";
import { norm, nameSchoolKey, findDuplicateGroups, type DupCand } from "@/lib/duplicates";
import ContactPopover from "@/components/ContactPopover";
import PaginationControls from "@/components/PaginationControls";

// Finds candidate records that look like duplicates of each other — regardless
// of source (manual entry, bulk import, or JazzHR) — by matching on email or on
// name. Admins keep one and delete the rest. This complements the JazzHR match
// review (which links a NEW JazzHR applicant to an existing sourced candidate).

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB",
};
const HEAD = "var(--font-head)";

// Re-exported so existing importers (ImportTable, ConsoleClient) keep their paths.
export { norm, nameSchoolKey, findDuplicateGroups };
export type { DupCand };

export default function DuplicateReview({ candidates, schools, onDeleted }: {
  candidates: DupCand[];
  schools: { id: string; name: string; tier?: string | null }[];
  // Lets the parent drop the row from its own candidate state — the list here
  // comes from a client-side snapshot that router.refresh() alone can't update.
  onDeleted?: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Deleted ids are filtered out locally so the row disappears the moment the
  // server confirms the delete, even before any parent state/refresh lands.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const groups = useMemo(
    () => findDuplicateGroups(candidates.filter((c) => !deletedIds.has(c.id))),
    [candidates, deletedIds],
  );
  const schoolName = (c: DupCand) => candidateSchoolDisplay(c, schools).label;
  const safePage = Math.min(page, Math.max(0, Math.ceil(groups.length / pageSize) - 1));
  const shownGroups = groups.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const del = (c: DupCand) => {
    if (!confirm(`Delete "${c.name}"? This removes the record and its outreach/intros.`)) return;
    startTransition(() => {
      deleteCandidate(c.id).then((r: any) => {
        if (r?.error) { alert(r.error); return; }
        setDeletedIds((prev) => new Set(prev).add(c.id));
        onDeleted?.(c.id);
        router.refresh();
      });
    });
  };

  if (groups.length === 0) {
    return <div style={{ fontSize: 13.5, color: C.grayMute, fontStyle: "italic" }}>No duplicate candidates found — every record has a unique name and email.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: pending ? 0.7 : 1 }}>
      <div style={{ fontSize: 12.5, color: C.grayMute }}>{groups.length} possible duplicate group{groups.length === 1 ? "" : "s"} (matched by name or email). Keep one and delete the rest.</div>
      <PaginationControls page={safePage} pageSize={pageSize} total={groups.length} onPageChange={setPage} onPageSizeChange={(size) => { setPage(0); setPageSize(size); }} />
      {shownGroups.map((g, gi) => (
        <div key={gi} style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "8px 14px", background: C.canvas, fontSize: 11.5, fontWeight: 700, color: C.navy2, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Same {g.reason} · {g.reason === "email" ? g.key : g.members[0].name}
          </div>
          {g.members.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.gray }}><ContactPopover name={c.name} email={c.email} /></div>
                <div style={{ fontSize: 12, color: C.grayMute }}>
                  {[c.email, schoolName(c), c.stage, c.source === "jazzhr" ? "JazzHR" : c.source === "user_created" ? "Manual" : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button onClick={() => del(c)} style={{ border: `1px solid ${C.orange}`, background: "#fff", color: C.orange, fontWeight: 700, fontSize: 12, padding: "6px 12px", borderRadius: 8, cursor: "pointer", flexShrink: 0 }}>Delete</button>
            </div>
          ))}
        </div>
      ))}
      <PaginationControls page={safePage} pageSize={pageSize} total={groups.length} onPageChange={setPage} onPageSizeChange={(size) => { setPage(0); setPageSize(size); }} />
    </div>
  );
}
