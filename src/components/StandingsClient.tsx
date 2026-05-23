"use client";

import { useState, useMemo } from "react";
import { phaseOf, isActive } from "@/lib/stages";

const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD",
  orange: "#DD5434", blue: "#8AB9E2", gray: "#303333", grayMute: "#6E7385",
  line: "#E4E7EE", canvas: "#F7F8FB", gold: "#C9A227", good: "#2F8F6B",
};
const HEAD = "'Cabin', sans-serif";

type SchoolRow = { id: string; name: string; tier: string; color_primary: string | null; logo_url: string | null };
type CandRow  = { id: string; school_id: string | null; stage: string | null };
type GoalRow  = { school_id: string; goal_sourced: number; goal_contacted: number; goal_applied: number };

const PH_ORDER: Record<string, number> = {
  sourced: 0, contacted: 1, applied: 2, advanced: 3, finalist: 4, fellow: 5,
};

function computeStats(schools: SchoolRow[], candidates: CandRow[], goals: GoalRow[]) {
  const goalMap = new Map(goals.map((g) => [g.school_id, g]));
  return schools.map((s) => {
    const sc = candidates.filter((c) => c.school_id === s.id);
    const active = sc.filter((c) => isActive(c.stage));
    const g = goalMap.get(s.id) ?? { goal_sourced: 0, goal_contacted: 0, goal_applied: 0 };
    const ph = (c: CandRow) => phaseOf(c.stage) ?? "";

    const sourced   = active.filter((c) => ["sourced","contacted","applied","advanced","finalist","fellow"].includes(ph(c))).length;
    const contacted = active.filter((c) => ["contacted","applied","advanced","finalist","fellow"].includes(ph(c))).length;
    const applied   = active.filter((c) => ["applied","advanced","finalist","fellow"].includes(ph(c))).length;
    const finalists = active.filter((c) => ["finalist","fellow"].includes(ph(c))).length;
    const fellows   = active.filter((c) => ph(c) === "fellow").length;

    // goal attainment per axis (0–1)
    const gS = g.goal_sourced   > 0 ? Math.min(sourced   / g.goal_sourced,   1) : 0;
    const gC = g.goal_contacted > 0 ? Math.min(contacted / g.goal_contacted, 1) : 0;
    const gA = g.goal_applied   > 0 ? Math.min(applied   / g.goal_applied,   1) : 0;
    const denom = (g.goal_sourced > 0 ? 1 : 0) + (g.goal_contacted > 0 ? 1 : 0) + (g.goal_applied > 0 ? 1 : 0);
    const goalAtt = denom > 0 ? (gS + gC + gA) / denom : 0;

    const yieldRate = sourced > 0 ? Math.min(applied / sourced, 1) : 0;
    const depth = active.length > 0
      ? active.reduce((sum, c) => sum + (PH_ORDER[ph(c)] ?? 0), 0) / (active.length * 5)
      : 0;

    const orrScore = Math.round((goalAtt * 0.50 + yieldRate * 0.35 + depth * 0.15) * 100);
    return { school: s, sourced, contacted, applied, finalists, fellows, active: active.length, goalAtt, yieldRate, depth, orrScore, g, gS, gC, gA };
  });
}

type SchoolStats = ReturnType<typeof computeStats>[number];

// ---- SVG radar chart — 6 axes ----
function RadarChart({ stats, color }: { stats: SchoolStats; color: string }) {
  const SZ = 150, cx = SZ / 2, cy = SZ / 2, R = 56;
  const axes = [
    { label: "Src Goal",  value: stats.gS },
    { label: "Cntd Goal", value: stats.gC },
    { label: "Appl Goal", value: stats.gA },
    { label: "Yield",     value: stats.yieldRate },
    { label: "Depth",     value: Math.min(stats.depth * 2.5, 1) },
    { label: "Finalist",  value: stats.sourced > 0 ? Math.min(stats.finalists / stats.sourced * 4, 1) : 0 },
  ];
  const N = axes.length;
  const pt = (i: number, scale: number) => {
    const a = (i * 2 * Math.PI) / N - Math.PI / 2;
    return [cx + scale * R * Math.cos(a), cy + scale * R * Math.sin(a)] as [number, number];
  };
  const rings = [0.25, 0.5, 0.75, 1];
  const dataPts = axes.map((ax, i) => pt(i, ax.value));
  const toPath = (pts: [number, number][]) =>
    pts.map(([x, y], j) => `${j === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";

  return (
    <svg width={SZ} height={SZ}>
      {rings.map((s) => (
        <polygon key={s}
          points={Array.from({ length: N }, (_, i) => pt(i, s).join(",")).join(" ")}
          fill="none" stroke={C.line} strokeWidth={s === 1 ? 1.5 : 0.75} />
      ))}
      {Array.from({ length: N }, (_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={C.line} strokeWidth={0.75} />;
      })}
      <path d={toPath(dataPts)} fill={`${color}33`} stroke={color} strokeWidth={2} />
      {axes.map((ax, i) => {
        const [x, y] = pt(i, 1.25);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 8.5, fill: C.grayMute, fontFamily: HEAD, fontWeight: 600 }}>
            {ax.label}
          </text>
        );
      })}
    </svg>
  );
}

export default function StandingsClient({ schools, candidates, goals, mySchoolId }: {
  schools: SchoolRow[]; candidates: CandRow[]; goals: GoalRow[]; mySchoolId: string | null;
}) {
  const [subTab, setSubTab] = useState<"composite" | "funnel" | "h2h">("composite");

  const initialA = mySchoolId ?? schools[0]?.id ?? "";
  const [h2hA, setH2hA] = useState(initialA);
  const [h2hB, setH2hB] = useState(schools.find((s) => s.id !== initialA)?.id ?? "");

  const stats    = useMemo(() => computeStats(schools, candidates, goals), [schools, candidates, goals]);
  const statsMap = useMemo(() => new Map(stats.map((s) => [s.school.id, s])), [stats]);

  const byTier = useMemo(() => {
    const tiers = [...new Set(stats.map((s) => s.school.tier))].sort();
    return tiers.map((tier) => ({
      tier,
      rows: stats.filter((s) => s.school.tier === tier).sort((a, b) => b.orrScore - a.orrScore),
    }));
  }, [stats]);

  const funnelSorted = useMemo(() => [...stats].sort((a, b) => b.sourced - a.sourced), [stats]);
  const maxSourced   = useMemo(() => Math.max(...funnelSorted.map((s) => s.sourced), 1), [funnelSorted]);

  const subBtnStyle = (k: string): React.CSSProperties => ({
    border: "none", background: "none", cursor: "pointer", padding: "10px 18px",
    fontFamily: HEAD, fontSize: 14, fontWeight: subTab === k ? 700 : 600,
    color: subTab === k ? C.navy : C.grayMute,
    borderBottom: subTab === k ? `2px solid ${C.navy}` : "2px solid transparent",
  });

  return (
    <div>
      <h1 style={{ fontSize: 30, color: C.navy, margin: "0 0 4px" }}>Standings</h1>
      <p style={{ color: C.grayMute, margin: "0 0 16px" }}>Live pipeline across all participating schools.</p>

      <div style={{ display: "flex", borderBottom: `1px solid ${C.line}`, marginBottom: 26 }}>
        <button style={subBtnStyle("composite")} onClick={() => setSubTab("composite")}>Composite Score</button>
        <button style={subBtnStyle("funnel")}    onClick={() => setSubTab("funnel")}>Funnel</button>
        <button style={subBtnStyle("h2h")}       onClick={() => setSubTab("h2h")}>Head-to-Head</button>
      </div>

      {/* ─── COMPOSITE SCORE ─── */}
      {subTab === "composite" && (
        <div>
          {byTier.map(({ tier, rows }) => (
            <div key={tier} style={{ marginBottom: 32 }}>
              <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 1, marginBottom: 10 }}>
                {tier}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {rows.map((s, rank) => {
                  const isMe  = s.school.id === mySchoolId;
                  const color = s.school.color_primary ?? C.navy2;
                  const tone  = s.orrScore >= 75 ? C.good : s.orrScore >= 50 ? C.gold : C.orange;
                  return (
                    <div key={s.school.id} style={{
                      background: isMe ? `${color}0F` : "#fff",
                      border: `1px solid ${isMe ? color : C.line}`,
                      borderLeft: `4px solid ${color}`,
                      borderRadius: 12, padding: "14px 18px",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 20, color: C.navy3, width: 28, textAlign: "center", flexShrink: 0 }}>
                          #{rank + 1}
                        </div>
                        {s.school.logo_url && (
                          <img src={s.school.logo_url} alt="" style={{ height: 26, width: 26, objectFit: "contain", borderRadius: 4, flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: C.gray, fontSize: 15 }}>
                            {s.school.name}
                            {isMe && <span style={{ marginLeft: 8, fontSize: 11, color, background: `${color}22`, padding: "2px 7px", borderRadius: 99, fontWeight: 700 }}>You</span>}
                          </div>
                          <div style={{ display: "flex", gap: 14, marginTop: 5, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 11.5, color: C.grayMute }}>Sourced <b style={{ color: C.gray }}>{s.sourced}</b></span>
                            <span style={{ fontSize: 11.5, color: C.grayMute }}>Contacted <b style={{ color: C.gray }}>{s.contacted}</b></span>
                            <span style={{ fontSize: 11.5, color: C.grayMute }}>Applied <b style={{ color: C.gray }}>{s.applied}</b></span>
                            {s.finalists > 0 && <span style={{ fontSize: 11.5, color: C.gold }}>Finalists <b>{s.finalists}</b></span>}
                          </div>
                          <div style={{ marginTop: 8, height: 5, borderRadius: 99, background: C.line, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.min(s.orrScore, 100)}%`, background: tone, borderRadius: 99, transition: "width .6s" }} />
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 30, color: tone, lineHeight: 1 }}>{s.orrScore}</div>
                          <div style={{ fontSize: 10, color: C.grayMute, fontWeight: 600 }}>Orr Score</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {stats.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No schools configured yet.</div>}
        </div>
      )}

      {/* ─── FUNNEL ─── */}
      {subTab === "funnel" && (
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "12px 18px 12px 160px", borderBottom: `1px solid ${C.line}`, gap: 16, fontFamily: HEAD, fontSize: 11, fontWeight: 700, color: C.grayMute, textTransform: "uppercase" }}>
            <span style={{ color: C.navy3 }}>▮ Sourced</span>
            <span style={{ color: C.blue }}>▮ Contacted</span>
            <span style={{ color: C.navy2 }}>▮ Applied</span>
          </div>
          {funnelSorted.map((s) => {
            const isMe  = s.school.id === mySchoolId;
            const color = s.school.color_primary ?? C.navy2;
            const gPct  = s.g.goal_sourced > 0 ? `${Math.round((s.sourced / s.g.goal_sourced) * 100)}%` : null;
            const srcOnly = Math.max(s.sourced - s.contacted, 0);
            const cntdOnly = Math.max(s.contacted - s.applied, 0);
            return (
              <div key={s.school.id} style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: `1px solid ${C.line}`, background: isMe ? `${color}08` : undefined, gap: 12 }}>
                <div style={{ width: 140, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  {s.school.logo_url && <img src={s.school.logo_url} alt="" style={{ height: 20, width: 20, objectFit: "contain", borderRadius: 3, flexShrink: 0 }} />}
                  <span style={{ fontSize: 13, fontWeight: isMe ? 700 : 600, color: C.gray, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.school.name}</span>
                </div>
                {/* stacked funnel bar */}
                <div style={{ flex: 1, height: 18, display: "flex", alignItems: "center" }}>
                  <div style={{ width: `${(s.sourced / maxSourced) * 100}%`, height: "100%", display: "flex", borderRadius: 4, overflow: "hidden", gap: 1 }}>
                    {srcOnly > 0  && <div style={{ flex: srcOnly,  background: `${C.navy3}66` }} />}
                    {cntdOnly > 0 && <div style={{ flex: cntdOnly, background: C.blue, opacity: 0.85 }} />}
                    {s.applied > 0 && <div style={{ flex: s.applied, background: C.navy2 }} />}
                  </div>
                </div>
                <div style={{ width: 110, display: "flex", gap: 6, justifyContent: "flex-end", fontSize: 12, color: C.grayMute, flexShrink: 0, fontFamily: HEAD }}>
                  <span><b style={{ color: C.gray }}>{s.sourced}</b> / <b style={{ color: C.navy2 }}>{s.applied}</b></span>
                  {gPct && <span style={{ color: s.g.goal_sourced > 0 && s.sourced >= s.g.goal_sourced ? C.good : C.orange, fontWeight: 700 }}>{gPct}</span>}
                </div>
              </div>
            );
          })}
          {funnelSorted.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No data yet.</div>}
        </div>
      )}

      {/* ─── HEAD-TO-HEAD ─── */}
      {subTab === "h2h" && (() => {
        const sA    = statsMap.get(h2hA) ?? null;
        const sB    = statsMap.get(h2hB) ?? null;
        const colA  = sA?.school.color_primary ?? C.navy2;
        const colB  = sB?.school.color_primary ?? C.orange;
        const rows: [string, number | string, number | string][] = sA && sB ? [
          ["Active Pipeline", sA.active,   sB.active],
          ["Sourced",         sA.sourced,  sB.sourced],
          ["Contacted",       sA.contacted,sB.contacted],
          ["Applied",         sA.applied,  sB.applied],
          ["Finalists",       sA.finalists,sB.finalists],
          ["Fellows",         sA.fellows,  sB.fellows],
          ["Orr Score",       sA.orrScore, sB.orrScore],
          ["Yield Rate", `${(sA.yieldRate*100).toFixed(0)}%`, `${(sB.yieldRate*100).toFixed(0)}%`],
        ] : [];
        return (
          <div>
            <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap", alignItems: "center" }}>
              <select value={h2hA} onChange={(e) => setH2hA(e.target.value)}
                style={{ padding: "10px 14px", borderRadius: 10, border: `2px solid ${colA}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 700 }}>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span style={{ color: C.grayMute, fontWeight: 700, fontSize: 16 }}>vs</span>
              <select value={h2hB} onChange={(e) => setH2hB(e.target.value)}
                style={{ padding: "10px 14px", borderRadius: 10, border: `2px solid ${colB}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 700 }}>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {sA && sB && (
              <>
                <div style={{ display: "flex", gap: 32, justifyContent: "center", marginBottom: 28, flexWrap: "wrap" }}>
                  {[{ s: sA, col: colA }, { s: sB, col: colB }].map(({ s, col }) => (
                    <div key={s.school.id} style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: HEAD, fontWeight: 700, color: col, marginBottom: 6 }}>{s.school.name}</div>
                      <RadarChart stats={s} color={col} />
                      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 28, color: col, marginTop: 4 }}>
                        {s.orrScore} <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>Orr</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr", padding: "12px 20px", borderBottom: `1px solid ${C.line}`, background: "#FAFBFE", fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute }}>
                    <div style={{ color: colA }}>{sA.school.name}</div>
                    <div style={{ textAlign: "center" }}>Metric</div>
                    <div style={{ textAlign: "right", color: colB }}>{sB.school.name}</div>
                  </div>
                  {rows.map(([label, vA, vB]) => {
                    const nA = typeof vA === "number" ? vA : null;
                    const nB = typeof vB === "number" ? vB : null;
                    const winA = nA !== null && nB !== null && nA > nB;
                    const winB = nA !== null && nB !== null && nB > nA;
                    return (
                      <div key={label} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr", padding: "13px 20px", borderBottom: `1px solid ${C.line}`, alignItems: "center" }}>
                        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 18, color: winA ? colA : C.gray }}>{String(vA)}</div>
                        <div style={{ textAlign: "center", fontSize: 13, color: C.grayMute, fontWeight: 600 }}>{label}</div>
                        <div style={{ textAlign: "right", fontFamily: HEAD, fontWeight: 700, fontSize: 18, color: winB ? colB : C.gray }}>{String(vB)}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {(!sA || !sB) && (
              <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>Select two schools above to compare.</div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
