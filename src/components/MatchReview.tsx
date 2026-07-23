"use client";

import { useRouter } from "next/navigation";
import { approveJazzMatch, rejectJazzMatch } from "@/app/(app)/console/actions";
import { routeToSchoolName } from "@/lib/stages";
import { candidateSchoolDisplay } from "@/lib/candidateSchool";
import { ReviewDeck, type DeckApi } from "./ReviewDeck";

const C = {
  navy: "#11123E", navy2: "#485F92", orange: "#DD5434", gold: "#C9A227",
  gray: "#303333", grayMute: "#6E7385", line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B",
};
const HEAD = "var(--font-head)";

type Review = { id: string; jazz_snapshot: any; candidate_id: string | null; reason: string | null };
// Only the fields the side-by-side comparison reads (matched against a JazzHR
// snapshot). Kept minimal so a slim candidate projection can be passed in.
type Cand = {
  id: string; name: string; email: string | null; school_id: string | null;
  university_raw?: string | null;
  stage: string | null; area_of_study: string | null; gpa: string | null;
};
type SchoolLite = { id: string; name: string; tier?: string | null };

// Side-by-side review of JazzHR applicants that look like an existing sourced
// candidate but couldn't be auto-linked (different email, nickname, etc.).
// Admin / super-admin decides: Match (link) or Add as a new candidate — one at
// a time, or several at once via "Select multiple".
export default function MatchReview({ reviews, candidates, schools, open, onClose }: {
  reviews: Review[]; candidates: Cand[]; schools: SchoolLite[]; open: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const schoolName = (cand: Cand | null) => cand ? candidateSchoolDisplay(cand, schools).label : null;

  const approve = async (ids: string[]): Promise<{ error?: string }> => {
    for (const id of ids) { const r = await approveJazzMatch(id); if (r && "error" in r && r.error) return { error: r.error as string }; }
    router.refresh(); return {};
  };
  const reject = async (ids: string[]): Promise<{ error?: string }> => {
    for (const id of ids) { const r = await rejectJazzMatch(id); if (r && "error" in r && r.error) return { error: r.error as string }; }
    router.refresh(); return {};
  };

  if (!open) return null;

  const rowLabel = (r: Review) => {
    const snap = r.jazz_snapshot ?? {};
    const cand = candidates.find((c) => c.id === r.candidate_id) ?? null;
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.gray }}>{snap.name ?? "JazzHR applicant"}</div>
        <div style={{ fontSize: 11.5, color: C.grayMute }}>vs {cand?.name ?? "(deleted candidate)"}</div>
      </div>
    );
  };

  return (
    <ReviewDeck<Review>
      title="Match review"
      subtitle="JazzHR applicants that look like an existing sourced candidate. Match links them (keeping notes & owner); Add as new imports them separately."
      accent={C.orange}
      items={reviews}
      getKey={(r) => r.id}
      onClose={onClose}
      doneMessage={(n) => `Handled ${n} possible match${n === 1 ? "" : "es"}.`}
      bulk={{
        row: rowLabel,
        actions: [
          { label: (n) => `Match ${n} as same person`, tone: "primary", run: async (rows) => approve(rows.map((r) => r.id)) },
          { label: (n) => `Add ${n} as new`, tone: "default", run: async (rows) => reject(rows.map((r) => r.id)) },
        ],
        hint: "Match only rows you're sure are the same person; Add as new keeps them as separate candidates.",
      }}
      renderCard={(r, api) => (
        <MatchCard r={r} cand={candidates.find((c) => c.id === r.candidate_id) ?? null} schoolName={schoolName} api={api} onApprove={approve} onReject={reject} />
      )}
    />
  );
}

function MatchCard({ r, cand, schoolName, api, onApprove, onReject }: {
  r: Review; cand: Cand | null; schoolName: (c: Cand | null) => string | null; api: DeckApi;
  onApprove: (ids: string[]) => Promise<{ error?: string }>; onReject: (ids: string[]) => Promise<{ error?: string }>;
}) {
  const snap = r.jazz_snapshot ?? {};
  const jazzSchool = routeToSchoolName(snap.university_raw) ?? snap.university_raw ?? null;
  const rows: { label: string; jazz: string | null; cand: string | null }[] = [
    { label: "Name",   jazz: snap.name ?? null,           cand: cand?.name ?? null },
    { label: "Email",  jazz: snap.email ?? null,          cand: cand?.email ?? null },
    { label: "School", jazz: jazzSchool,                  cand: schoolName(cand) },
    { label: "Major",  jazz: snap.area_of_study ?? null,  cand: cand?.area_of_study ?? null },
    { label: "GPA",    jazz: snap.gpa ?? null,            cand: cand?.gpa ?? null },
    { label: "Stage",  jazz: snap.stage ?? null,          cand: cand?.stage ?? null },
  ];

  const act = async (fn: (ids: string[]) => Promise<{ error?: string }>) => {
    if (api.busy) return;
    api.setBusy(true); api.setError(null);
    const res = await fn([r.id]);
    api.setBusy(false);
    if (res.error) { api.setError(res.error); return; }
    api.resolve(r.id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: HEAD, fontSize: 14.5, fontWeight: 700, color: C.navy }}>Possible match</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: C.gold, background: `${C.gold}1e`, padding: "2px 7px", borderRadius: 999 }}>
          {r.reason === "nickname" ? "Nickname variant" : r.reason === "name_only" ? "Same name" : "Review"}
        </span>
      </div>

      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "88px 1fr 1fr" }}>
          <div style={{ background: C.canvas, borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }} />
          <ColHead label="JazzHR applicant" tone={C.navy2} />
          <ColHead label="Imported candidate" tone={C.orange} left />
          {rows.map((row) => {
            const differ = !!row.jazz && !!row.cand && row.jazz.trim().toLowerCase() !== row.cand.trim().toLowerCase();
            return <RowCells key={row.label} label={row.label} jazz={row.jazz} cand={row.cand} differ={differ} />;
          })}
        </div>
      </div>

      {!cand && <div style={{ fontSize: 12, color: C.orange }}>Suspected candidate was deleted — “Add as new” is safest.</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button disabled={api.busy} onClick={() => act(onApprove)}
          style={{ border: "none", background: C.good, color: "#fff", fontWeight: 700, fontSize: 13, padding: "9px 16px", borderRadius: 9, cursor: api.busy ? "default" : "pointer" }}>
          ✓ Match — same person
        </button>
        <button disabled={api.busy} onClick={() => act(onReject)}
          style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.gray, fontWeight: 700, fontSize: 13, padding: "9px 16px", borderRadius: 9, cursor: api.busy ? "default" : "pointer" }}>
          + Add as new candidate
        </button>
      </div>
    </div>
  );
}

function ColHead({ label, tone, left }: { label: string; tone: string; left?: boolean }) {
  return (
    <div style={{ padding: "9px 12px", borderBottom: `1px solid ${C.line}`, borderLeft: left ? `1px solid ${C.line}` : "none" }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: tone }}>{label}</span>
    </div>
  );
}

function RowCells({ label, jazz, cand, differ }: { label: string; jazz: string | null; cand: string | null; differ: boolean }) {
  const cell = (v: string | null, left?: boolean) => (
    <div style={{ padding: "8px 12px", borderTop: `1px solid ${C.line}`, borderLeft: left ? `1px solid ${C.line}` : "none", background: differ ? `${C.gold}10` : "#fff" }}>
      <span style={{ fontSize: 13, color: v ? C.gray : C.grayMute, fontWeight: 600 }}>{v ?? "—"}</span>
    </div>
  );
  return (
    <>
      <div style={{ padding: "8px 12px", borderTop: `1px solid ${C.line}`, background: C.canvas, borderRight: `1px solid ${C.line}` }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: C.grayMute }}>{label}</span>
      </div>
      {cell(jazz)}
      {cell(cand, true)}
    </>
  );
}
