"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { mergeCandidates, getDuplicateDetails } from "@/app/(app)/console/actions";
import { candidateSchoolDisplay } from "@/lib/candidateSchool";
import { norm, nameSchoolKey, findDuplicateGroups, type DupCand } from "@/lib/duplicates";
import ContactPopover from "@/components/ContactPopover";
import { ReviewDeck, type DeckApi } from "./ReviewDeck";

// Finds candidate records that look like duplicates of each other — matched by
// email OR by name (any source). Admins pick the record to KEEP; the others are
// MERGED into it (all their tracked data — intros, outreach, favorites, AI, and
// any fields the keeper is missing — move over) and then deleted, so nothing is
// lost. Presented as a quizlet-style deck.

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434", gold: "#C9A227",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B",
};

// Re-exported so existing importers (ImportTable, ConsoleClient) keep their paths.
export { norm, nameSchoolKey, findDuplicateGroups };
export type { DupCand };

type Group = { reason: "email" | "name"; key: string; members: DupCand[] };
const groupKey = (g: Group) => `${g.reason}:${g.key}`;

type Detail = { createdAt: string | null; pointPerson: string | null; hasLinkedin: boolean; hasResume: boolean; jazzLinked: boolean; outreachCount: number; introCount: number };

export default function DuplicateReview({ candidates, schools, open, onClose, onDeleted }: {
  candidates: DupCand[];
  schools: { id: string; name: string; tier?: string | null }[];
  open: boolean;
  onClose: () => void;
  // Lets the parent drop merged-away rows from its client-side snapshot.
  onDeleted?: (id: string) => void;
}) {
  const router = useRouter();
  const groups = useMemo(() => findDuplicateGroups(candidates), [candidates]);
  const schoolName = (c: DupCand) => candidateSchoolDisplay(c, schools).label;
  const [details, setDetails] = useState<Record<string, Detail>>({});

  // Pull richer per-record info once the deck opens so the cards can show what's
  // tracked on each candidate (helps decide which to keep).
  useEffect(() => {
    if (!open) return;
    const ids = [...new Set(groups.flatMap((g) => g.members.map((m) => m.id)))];
    if (!ids.length) return;
    let alive = true;
    getDuplicateDetails(ids).then((r) => { if (alive && r.details) setDetails(r.details); });
    return () => { alive = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge every non-kept record in a group into the keeper, then it's gone.
  const mergeInto = async (keepId: string, loseIds: string[]): Promise<{ error?: string }> => {
    for (const lose of loseIds) {
      const r: { error?: string } = await mergeCandidates(keepId, lose);
      if (r?.error) return { error: r.error };
      onDeleted?.(lose);
    }
    router.refresh();
    return {};
  };

  if (!open) return null;

  return (
    <ReviewDeck<Group>
      title="Potential duplicates"
      subtitle="Matched by name or email. Keep one record — the others are merged into it (their notes, outreach & intros move over) and removed."
      accent={C.orange}
      items={groups}
      getKey={groupKey}
      onClose={onClose}
      doneMessage={(n) => `Resolved ${n} duplicate group${n === 1 ? "" : "s"}.`}
      bulk={{
        row: (g) => (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.gray }}>{g.members[0].name}</div>
            <div style={{ fontSize: 11.5, color: C.grayMute }}>Same {g.reason} · {g.members.length} records · keep first, merge {g.members.length - 1}</div>
          </div>
        ),
        actions: [{
          label: (n) => `Keep first, merge rest · ${n} group${n === 1 ? "" : "s"}`,
          tone: "danger",
          run: async (gs) => {
            for (const g of gs) {
              const res = await mergeInto(g.members[0].id, g.members.slice(1).map((m) => m.id));
              if (res.error) return res;
            }
            return {};
          },
        }],
        hint: "Bulk keeps the first record listed in each selected group and merges the rest into it.",
      }}
      renderCard={(g, api) => <DupCard group={g} schoolName={schoolName} details={details} api={api} onMerge={mergeInto} />}
    />
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "unknown date";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function DupCard({ group, schoolName, details, api, onMerge }: {
  group: Group;
  schoolName: (c: DupCand) => string;
  details: Record<string, Detail>;
  api: DeckApi;
  onMerge: (keepId: string, loseIds: string[]) => Promise<{ error?: string }>;
}) {
  // Default keeper: the record with the most tracked activity (JazzHR link,
  // outreach, intros), so the richer record survives. Falls back to the first.
  const score = (id: string) => { const d = details[id]; return d ? (d.jazzLinked ? 100 : 0) + d.outreachCount * 3 + d.introCount * 3 + (d.hasLinkedin ? 1 : 0) + (d.hasResume ? 1 : 0) : 0; };
  const suggested = useMemo(() => [...group.members].sort((a, b) => score(b.id) - score(a.id))[0]?.id ?? group.members[0].id, [group, details]);
  const [keepId, setKeepId] = useState(suggested);
  useEffect(() => { setKeepId(suggested); }, [suggested]);
  const keeper = group.members.find((m) => m.id === keepId);
  const others = group.members.filter((m) => m.id !== keepId);

  const run = async () => {
    if (api.busy || others.length === 0) return;
    if (!confirm(`Keep "${keeper?.name}" and merge ${others.length} duplicate${others.length === 1 ? "" : "s"} into it? Their notes, outreach and intros move to the kept record, and the duplicate${others.length === 1 ? " is" : "s are"} deleted.`)) return;
    api.setBusy(true); api.setError(null);
    const res = await onMerge(keepId, others.map((m) => m.id));
    api.setBusy(false);
    if (res.error) { api.setError(res.error); return; }
    api.resolve(groupKey(group));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.navy2, textTransform: "uppercase", letterSpacing: 0.4 }}>
        Same {group.reason} · {group.reason === "email" ? group.key : group.members[0].name}
      </div>
      <div style={{ fontSize: 12.5, color: C.grayMute }}>Pick the record to keep — the rest merge into it. We pre-select the one with the most history.</div>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        {group.members.map((c, i) => {
          const keep = c.id === keepId;
          const d = details[c.id];
          return (
            <label key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderTop: i === 0 ? "none" : `1px solid ${C.line}`, cursor: "pointer", background: keep ? `${C.good}0f` : "#fff" }}>
              <input type="radio" name="keep" checked={keep} onChange={() => setKeepId(c.id)} style={{ marginTop: 3 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.gray }}><ContactPopover name={c.name} email={c.email} /></div>
                <div style={{ fontSize: 12, color: C.grayMute, marginTop: 1 }}>
                  {[c.email, schoolName(c), c.stage, c.source === "jazzhr" ? "JazzHR" : c.source === "user_created" ? "Manual" : null].filter(Boolean).join(" · ")}
                </div>
                <div style={{ fontSize: 11.5, color: C.grayMute, marginTop: 3 }}>
                  {d
                    ? [
                        `added ${fmtDate(d.createdAt)}`,
                        d.pointPerson ? `owner: ${d.pointPerson}` : "unassigned",
                        `${d.outreachCount} outreach`,
                        `${d.introCount} intro${d.introCount === 1 ? "" : "s"}`,
                      ].join(" · ")
                    : "loading details…"}
                </div>
                {d && (d.jazzLinked || d.hasLinkedin || d.hasResume) && (
                  <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                    {d.jazzLinked && <Badge tone={C.navy}>JazzHR-linked</Badge>}
                    {d.hasLinkedin && <Badge tone={C.navy2}>LinkedIn</Badge>}
                    {d.hasResume && <Badge tone={C.navy2}>Résumé</Badge>}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: keep ? C.good : C.grayMute, flexShrink: 0, marginTop: 2 }}>{keep ? "KEEP" : "merge in"}</span>
            </label>
          );
        })}
      </div>
      <button onClick={run} disabled={api.busy}
        style={{ alignSelf: "flex-start", border: `1px solid ${C.orange}`, background: "#fff", color: C.orange, fontWeight: 700, fontSize: 13, padding: "9px 15px", borderRadius: 9, cursor: api.busy ? "default" : "pointer" }}>
        {api.busy ? "Merging…" : `Keep this · merge ${others.length} other${others.length === 1 ? "" : "s"} in`}
      </button>
    </div>
  );
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 10, fontWeight: 700, color: tone, background: `${tone}14`, borderRadius: 999, padding: "2px 8px" }}>{children}</span>;
}
