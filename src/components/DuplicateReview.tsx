"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCandidate } from "@/app/(app)/console/actions";
import { candidateSchoolDisplay } from "@/lib/candidateSchool";

// Finds candidate records that look like duplicates of each other — regardless
// of source (manual entry, bulk import, or JazzHR) — by matching on email or on
// name. Admins keep one and delete the rest. This complements the JazzHR match
// review (which links a NEW JazzHR applicant to an existing sourced candidate).

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB",
};
const HEAD = "'Cabin', sans-serif";

export type DupCand = { id: string; name: string; email: string | null; school_id: string | null; university_raw?: string | null; stage: string | null; source: string | null };

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// Groups of 2+ candidates that share `key`. Name groups whose members all share
// one email are dropped (already covered by the email group).
export function findDuplicateGroups(candidates: DupCand[]): { reason: "email" | "name"; key: string; members: DupCand[] }[] {
  const byEmail = new Map<string, DupCand[]>();
  const byName = new Map<string, DupCand[]>();
  for (const c of candidates) {
    if (c.email && norm(c.email)) (byEmail.get(norm(c.email)) ?? byEmail.set(norm(c.email), []).get(norm(c.email))!).push(c);
    if (norm(c.name)) (byName.get(norm(c.name)) ?? byName.set(norm(c.name), []).get(norm(c.name))!).push(c);
  }
  const groups: { reason: "email" | "name"; key: string; members: DupCand[] }[] = [];
  for (const [key, members] of byEmail) if (members.length > 1) groups.push({ reason: "email", key, members });
  for (const [key, members] of byName) {
    if (members.length <= 1) continue;
    const emails = new Set(members.map((m) => norm(m.email)).filter(Boolean));
    if (emails.size === 1 && members.every((m) => m.email)) continue; // already an email group
    groups.push({ reason: "name", key, members });
  }
  return groups;
}

export default function DuplicateReview({ candidates, schools }: {
  candidates: DupCand[];
  schools: { id: string; name: string; tier?: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const groups = useMemo(() => findDuplicateGroups(candidates), [candidates]);
  const schoolName = (c: DupCand) => candidateSchoolDisplay(c, schools).label;

  const del = (c: DupCand) => {
    if (!confirm(`Delete "${c.name}"? This removes the record and its outreach/intros.`)) return;
    startTransition(() => { deleteCandidate(c.id).then((r: any) => { if (r?.error) alert(r.error); else router.refresh(); }); });
  };

  if (groups.length === 0) {
    return <div style={{ fontSize: 13.5, color: C.grayMute, fontStyle: "italic" }}>No duplicate candidates found — every record has a unique name and email.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: pending ? 0.7 : 1 }}>
      <div style={{ fontSize: 12.5, color: C.grayMute }}>{groups.length} possible duplicate group{groups.length === 1 ? "" : "s"} (matched by name or email). Keep one and delete the rest.</div>
      {groups.map((g, gi) => (
        <div key={gi} style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "8px 14px", background: C.canvas, fontSize: 11.5, fontWeight: 700, color: C.navy2, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Same {g.reason} · {g.reason === "email" ? g.key : g.members[0].name}
          </div>
          {g.members.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.gray }}>{c.name}</div>
                <div style={{ fontSize: 12, color: C.grayMute }}>
                  {[c.email, schoolName(c), c.stage, c.source === "jazzhr" ? "JazzHR" : c.source === "user_created" ? "Manual" : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button onClick={() => del(c)} style={{ border: `1px solid ${C.orange}`, background: "#fff", color: C.orange, fontWeight: 700, fontSize: 12, padding: "6px 12px", borderRadius: 8, cursor: "pointer", flexShrink: 0 }}>Delete</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
