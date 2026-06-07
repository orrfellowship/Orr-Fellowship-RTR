"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveJazzMatch, rejectJazzMatch } from "@/app/(app)/console/actions";
import { routeToSchoolName } from "@/lib/stages";

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434", gold: "#C9A227",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B",
};
const HEAD = "'Cabin', sans-serif";

type Review = { id: string; jazz_snapshot: any; candidate_id: string | null; reason: string | null };
type Cand = {
  id: string; name: string; email: string | null; school_id: string | null;
  stage: string | null; gpa: string | null; area_of_study: string | null;
  university_raw: string | null; linkedin: string | null;
};
type SchoolLite = { id: string; name: string };

// Side-by-side review of JazzHR applicants that look like an existing sourced
// candidate but couldn't be auto-linked (different email, nickname, etc.).
// Admin / super-admin decides: Match (link) or Add as a new candidate.
export default function MatchReview({ reviews, candidates, schools, compact = false }: {
  reviews: Review[]; candidates: Cand[]; schools: SchoolLite[]; compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const schoolName = (id: string | null) => (id ? schools.find((s) => s.id === id)?.name ?? null : null);

  const act = (id: string, fn: (id: string) => Promise<any>) => {
    setBusyId(id);
    startTransition(async () => {
      await fn(id);
      setBusyId(null);
      router.refresh();
    });
  };

  if (reviews.length === 0) {
    return (
      <div style={{ fontSize: 13.5, color: C.grayMute, fontStyle: "italic" }}>Nothing to review — all matches were confident.</div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, opacity: pending ? 0.7 : 1 }}>
      {reviews.map((r) => {
        const snap = r.jazz_snapshot ?? {};
        const cand = candidates.find((c) => c.id === r.candidate_id) ?? null;
        const jazzSchool = routeToSchoolName(snap.university_raw) ?? snap.university_raw ?? null;
        const rows: { label: string; jazz: string | null; cand: string | null }[] = [
          { label: "Name",   jazz: snap.name ?? null,           cand: cand?.name ?? null },
          { label: "Email",  jazz: snap.email ?? null,          cand: cand?.email ?? null },
          { label: "School", jazz: jazzSchool,                  cand: schoolName(cand?.school_id ?? null) },
          { label: "Major",  jazz: snap.area_of_study ?? null,  cand: cand?.area_of_study ?? null },
          { label: "GPA",    jazz: snap.gpa ?? null,            cand: cand?.gpa ?? null },
          { label: "Stage",  jazz: snap.stage ?? null,          cand: cand?.stage ?? null },
        ];
        const busy = busyId === r.id;
        return (
          <div key={r.id} style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", background: "#fff" }}>
            {/* reason badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: `1px solid ${C.line}`, background: C.canvas }}>
              <span style={{ fontFamily: HEAD, fontSize: 13, fontWeight: 700, color: C.navy }}>Possible match</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: C.gold, background: `${C.gold}1e`, padding: "2px 7px", borderRadius: 999 }}>
                {r.reason === "nickname" ? "Nickname variant" : r.reason === "name_only" ? "Same name" : "Review"}
              </span>
            </div>

            {/* two-column compare */}
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", alignItems: "stretch" }}>
              <div style={{ background: C.canvas, borderRight: `1px solid ${C.line}` }} />
              <ColHead label="JazzHR applicant" tone={C.navy2} />
              <ColHead label="Imported candidate" tone={C.orange} left />
              {rows.map((row) => {
                const differ = !!row.jazz && !!row.cand && row.jazz.trim().toLowerCase() !== row.cand.trim().toLowerCase();
                return (
                  <Row key={row.label} label={row.label} jazz={row.jazz} cand={row.cand} differ={differ} />
                );
              })}
            </div>

            {/* actions */}
            <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: `1px solid ${C.line}`, flexWrap: "wrap" }}>
              <button disabled={busy} onClick={() => act(r.id, approveJazzMatch)}
                style={{ border: "none", background: C.good, color: "#fff", fontWeight: 700, fontSize: 13, padding: "9px 16px", borderRadius: 9, cursor: busy ? "default" : "pointer" }}>
                ✓ Match — same person
              </button>
              <button disabled={busy} onClick={() => act(r.id, rejectJazzMatch)}
                style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 700, fontSize: 13, padding: "9px 16px", borderRadius: 9, cursor: busy ? "default" : "pointer" }}>
                + Add as new candidate
              </button>
              {!cand && <span style={{ fontSize: 12, color: C.orange, alignSelf: "center" }}>Suspected candidate was deleted — “Add as new” is safest.</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ColHead({ label, tone, left }: { label: string; tone: string; left?: boolean }) {
  return (
    <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.line}`, borderLeft: left ? `1px solid ${C.line}` : "none" }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: tone }}>{label}</span>
    </div>
  );
}

function Row({ label, jazz, cand, differ }: { label: string; jazz: string | null; cand: string | null; differ: boolean }) {
  const cell = (v: string | null, left?: boolean): JSX.Element => (
    <div style={{ padding: "9px 14px", borderTop: `1px solid ${C.line}`, borderLeft: left ? `1px solid ${C.line}` : "none", background: differ ? `${C.gold}10` : "#fff" }}>
      <span style={{ fontSize: 13, color: v ? C.gray : C.grayMute, fontWeight: 600 }}>{v ?? "—"}</span>
    </div>
  );
  return (
    <>
      <div style={{ padding: "9px 14px", borderTop: `1px solid ${C.line}`, background: C.canvas, borderRight: `1px solid ${C.line}` }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: C.grayMute }}>{label}</span>
      </div>
      {cell(jazz)}
      {cell(cand, true)}
    </>
  );
}
