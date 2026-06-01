"use client";

import { useState, useTransition } from "react";
import type { Profile } from "@/lib/types";
import { canReassign } from "@/lib/types";
import { C, HEAD } from "../constants";
import StagePill from "../StagePill";
import CandidateDrawer from "../CandidateDrawer";
import { toggleFavorite, reassignPointPerson } from "../actions";
import type { Cand, TeamMember } from "../types";

export default function BoardClient({ profile, candidates, team, accent }: {
  profile: Profile;
  candidates: Cand[];
  team: TeamMember[];
  accent: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const open = candidates.find((c) => c.id === openId) ?? null;
  const canAssign = canReassign(profile.role);

  const nameOf = (id: string | null) => {
    if (!id) return "Unassigned";
    if (id === profile.id) return "You";
    return team.find((t) => t.id === id)?.full_name ?? "—";
  };

  const onFav = (c: Cand) => startTransition(() => { toggleFavorite(c.id, !c.is_favorite); });

  return (
    <>
      <h1 style={{ fontSize: 30, color: C.navy, margin: 0 }}>My School Board</h1>
      <p style={{ color: C.grayMute }}>{candidates.length} candidates.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 18, marginTop: 16, alignItems: "start" }}>
        {/* Candidate table */}
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 0.6fr 1fr 1.2fr 40px", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, background: "#FAFBFE" }}>
            <div>Candidate</div><div>Major</div><div>GPA</div><div>Stage</div><div>Owner</div><div></div>
          </div>
          {candidates.map((c) => (
            <div key={c.id}
              onClick={() => setOpenId(c.id)}
              onMouseEnter={() => setHoveredId(c.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr 0.6fr 1fr 1.2fr 40px", padding: "13px 18px", borderBottom: `1px solid ${C.line}`, alignItems: "center", opacity: c.not_interested ? 0.5 : 1, cursor: "pointer", background: hoveredId === c.id ? C.canvas : "#fff", transition: "background 0.1s" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.gray }}>{c.name}</div>
                <div style={{ fontSize: 12, color: C.grayMute }}>{c.email}</div>
              </div>
              <div style={{ fontSize: 13.5 }}>{c.area_of_study}</div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.gpa}</div>
              <div><StagePill stage={c.stage} /></div>
              <div onClick={(e) => e.stopPropagation()}>
                {canAssign ? (
                  <select value={c.point_person_id ?? ""} onChange={(e) => startTransition(() => { reassignPointPerson(c.id, e.target.value || null); })}
                    style={{ fontSize: 12.5, fontWeight: 600, color: c.point_person_id ? C.navy : C.orange, border: `1px solid ${C.line}`, borderRadius: 7, padding: "5px 7px", background: "#fff", cursor: "pointer" }}>
                    <option value="">Unassigned</option>
                    {team.map((t) => <option key={t.id} value={t.id}>{t.id === profile.id ? `${t.full_name} (me)` : t.full_name}</option>)}
                  </select>
                ) : (
                  <span style={{ fontSize: 13, color: c.point_person_id ? C.grayMute : C.orange, fontWeight: 600 }}>{nameOf(c.point_person_id)}</span>
                )}
              </div>
              <div onClick={(e) => { e.stopPropagation(); onFav(c); }} style={{ cursor: "pointer", fontSize: 18, color: c.is_favorite ? C.gold : "#D8DCE5", textAlign: "center" }}>{c.is_favorite ? "★" : "☆"}</div>
            </div>
          ))}
          {candidates.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No candidates yet — run a sync or add one.</div>}
        </div>

        {/* Team panel */}
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, background: "#FAFBFE" }}>
            <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: C.grayMute, letterSpacing: 0.5 }}>Team · {team.length}</div>
          </div>
          {team.map((t) => {
            const owned = candidates.filter((c) => c.point_person_id === t.id && !c.not_interested).length;
            const isMe = t.id === profile.id;
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: isMe ? accent : C.navy, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                  {t.full_name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.gray, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.full_name}{isMe ? " (you)" : ""}
                    </div>
                    {t.role === "team_lead" && <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: accent, background: `${accent}18`, padding: "1px 5px", borderRadius: 4, flexShrink: 0 }}>Lead</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.grayMute }}>{owned} candidate{owned !== 1 ? "s" : ""}</div>
                </div>
              </div>
            );
          })}
          {team.length === 0 && <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: C.grayMute }}>No team members yet.</div>}
        </div>
      </div>

      {open && <CandidateDrawer c={open} onClose={() => setOpenId(null)} />}
    </>
  );
}
