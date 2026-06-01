"use client";

import { useState } from "react";
import { C, HEAD } from "../constants";
import StagePill from "../StagePill";
import ResumeModal from "@/components/ResumeModal";
import type { AllSchool, AllCand } from "../types";

export default function ApplicantsClient({ schools, candidates }: {
  schools: AllSchool[];
  candidates: AllCand[];
}) {
  const [filter, setFilter] = useState("All schools");
  const [resumeFor, setResumeFor] = useState<{ jazzId: string; name: string } | null>(null);

  const visible = filter === "All schools"
    ? candidates
    : candidates.filter((c) => schools.find((s) => s.id === c.school_id)?.name === filter);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
        <div>
          <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>Applicants</h1>
          <p style={{ color: C.grayMute, margin: "4px 0 0" }}>{visible.length} candidates · Read-only</p>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 600 }}>
          <option>All schools</option>
          {schools.map((s) => <option key={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 0.6fr 1fr 80px", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
          <div>Candidate</div><div>School</div><div>Major</div><div>GPA</div><div>Stage</div><div></div>
        </div>
        {visible.map((c) => {
          const sc = schools.find((s) => s.id === c.school_id);
          const schoolAccent = sc?.color_primary ?? C.navy2;
          return (
            <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 1fr 0.6fr 1fr 80px", padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.gray }}>{c.name}</div>
                <div style={{ fontSize: 12, color: C.grayMute }}>{c.email}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: schoolAccent }}>{sc?.name ?? <span style={{ color: C.grayMute, fontStyle: "italic" }}>Unrouted</span>}</div>
              <div style={{ fontSize: 13 }}>{c.area_of_study ?? "—"}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{c.gpa ?? "—"}</div>
              <div><StagePill stage={c.stage} /></div>
              <div style={{ display: "flex", gap: 6 }}>
                {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: C.navy2, textDecoration: "none", border: `1px solid ${C.line}`, borderRadius: 6, padding: "4px 8px" }}>in</a>}
                {c.jazz_id && <button onClick={() => setResumeFor({ jazzId: c.jazz_id!, name: c.name })}
                  style={{ fontSize: 11, fontWeight: 700, color: C.navy2, border: `1px solid ${C.line}`, borderRadius: 6, padding: "4px 8px", background: "#fff", cursor: "pointer" }}>CV</button>}
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No candidates yet.</div>}
      </div>

      {resumeFor && <ResumeModal jazzId={resumeFor.jazzId} name={resumeFor.name} onClose={() => setResumeFor(null)} />}
    </>
  );
}
