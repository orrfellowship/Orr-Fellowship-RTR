"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCandidate } from "@/app/(app)/console/actions";
import { candidateSchoolDisplay } from "@/lib/candidateSchool";
import { norm, nameSchoolKey, findDuplicateGroups, type DupCand } from "@/lib/duplicates";
import ContactPopover from "@/components/ContactPopover";
import { ReviewDeck, type DeckApi } from "./ReviewDeck";

// Finds candidate records that look like duplicates of each other — regardless
// of source (manual entry, bulk import, or JazzHR) — by matching on email or on
// name. Admins keep one and delete the rest. This complements the JazzHR match
// review (which links a NEW JazzHR applicant to an existing sourced candidate).
//
// Presented as a quizlet-style deck: one group per card, choose the record to
// keep, delete the rest — or flip to "Select multiple" to auto-resolve several
// groups (keep the first listed, delete the others) at once.

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B",
};

// Re-exported so existing importers (ImportTable, ConsoleClient) keep their paths.
export { norm, nameSchoolKey, findDuplicateGroups };
export type { DupCand };

type Group = { reason: "email" | "name"; key: string; members: DupCand[] };
const groupKey = (g: Group) => `${g.reason}:${g.key}`;

export default function DuplicateReview({ candidates, schools, open, onClose, onDeleted }: {
  candidates: DupCand[];
  schools: { id: string; name: string; tier?: string | null }[];
  open: boolean;
  onClose: () => void;
  // Lets the parent drop the row from its own candidate state — the list here
  // comes from a client-side snapshot that router.refresh() alone can't update.
  onDeleted?: (id: string) => void;
}) {
  const router = useRouter();
  const groups = useMemo(() => findDuplicateGroups(candidates), [candidates]);
  const schoolName = (c: DupCand) => candidateSchoolDisplay(c, schools).label;

  // Deletes the given ids in order, patching parent state as each lands.
  const deleteMany = async (ids: string[]): Promise<{ error?: string }> => {
    for (const id of ids) {
      const r: { error?: string } = await deleteCandidate(id);
      if (r?.error) return { error: r.error };
      onDeleted?.(id);
    }
    router.refresh();
    return {};
  };

  if (!open) return null;

  return (
    <ReviewDeck<Group>
      title="Potential duplicates"
      subtitle="Same name or email · any source. Keep one record per person and delete the rest."
      accent={C.orange}
      items={groups}
      getKey={groupKey}
      onClose={onClose}
      doneMessage={(n) => `Resolved ${n} duplicate group${n === 1 ? "" : "s"}.`}
      bulk={{
        row: (g) => (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.gray }}>{g.members[0].name}</div>
            <div style={{ fontSize: 11.5, color: C.grayMute }}>
              Same {g.reason} · {g.members.length} records · keep first, delete {g.members.length - 1}
            </div>
          </div>
        ),
        actions: [{
          label: (n) => `Keep first, delete rest · ${n} group${n === 1 ? "" : "s"}`,
          tone: "danger",
          run: async (gs) => deleteMany(gs.flatMap((g) => g.members.slice(1).map((m) => m.id))),
        }],
        hint: "Bulk keeps the first record listed in each selected group and deletes the others. This can't be undone.",
      }}
      renderCard={(g, api) => <DupCard group={g} schoolName={schoolName} api={api} onDelete={deleteMany} />}
    />
  );
}

function DupCard({ group, schoolName, api, onDelete }: {
  group: Group;
  schoolName: (c: DupCand) => string;
  api: DeckApi;
  onDelete: (ids: string[]) => Promise<{ error?: string }>;
}) {
  const [keepId, setKeepId] = useState(group.members[0].id);
  const keeper = group.members.find((m) => m.id === keepId);
  const others = group.members.filter((m) => m.id !== keepId);

  const run = async () => {
    if (api.busy || others.length === 0) return;
    if (!confirm(`Keep "${keeper?.name}" and delete ${others.length} other record${others.length === 1 ? "" : "s"}? This also removes their outreach & intros and can't be undone.`)) return;
    api.setBusy(true); api.setError(null);
    const res = await onDelete(others.map((m) => m.id));
    api.setBusy(false);
    if (res.error) { api.setError(res.error); return; }
    api.resolve(groupKey(group));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.navy2, textTransform: "uppercase", letterSpacing: 0.4 }}>
        Same {group.reason} · {group.reason === "email" ? group.key : group.members[0].name}
      </div>
      <div style={{ fontSize: 12.5, color: C.grayMute }}>Pick the record to keep — the rest will be deleted.</div>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        {group.members.map((c, i) => {
          const keep = c.id === keepId;
          return (
            <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderTop: i === 0 ? "none" : `1px solid ${C.line}`, cursor: "pointer", background: keep ? `${C.good}0f` : "#fff" }}>
              <input type="radio" name="keep" checked={keep} onChange={() => setKeepId(c.id)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.gray }}><ContactPopover name={c.name} email={c.email} /></div>
                <div style={{ fontSize: 12, color: C.grayMute }}>
                  {[schoolName(c), c.stage, c.source === "jazzhr" ? "JazzHR" : c.source === "user_created" ? "Manual" : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: keep ? C.good : C.grayMute }}>{keep ? "KEEP" : "delete"}</span>
            </label>
          );
        })}
      </div>
      <button onClick={run} disabled={api.busy}
        style={{ alignSelf: "flex-start", border: `1px solid ${C.orange}`, background: "#fff", color: C.orange, fontWeight: 700, fontSize: 13, padding: "9px 15px", borderRadius: 9, cursor: api.busy ? "default" : "pointer" }}>
        {api.busy ? "Deleting…" : `Keep this · delete ${others.length} other${others.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
