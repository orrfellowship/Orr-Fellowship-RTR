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

function goalTone(pct: number): string {
  return pct >= 100 ? C.good : pct >= 70 ? C.gold : C.orange;
}

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
    const pctToAppliedGoal = g.goal_applied > 0 ? Math.round((applied / g.goal_applied) * 100) : 0;

    return { school: s, sourced, contacted, applied, finalists, fellows, active: active.length, goalAtt, yieldRate, depth, orrScore, g, gS, gC, gA, pctToAppliedGoal };
  });
}

type SchoolStats = ReturnType<typeof computeStats>[number];

function SummaryCard({ label, value, color, sub, tooltip }: { label: string; value: string | number; color: string; sub?: string; tooltip?: string }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 20px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, color: C.grayMute, fontFamily: HEAD }}>{label}</div>
        {tooltip && (
          <span title={tooltip} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: C.line, color: C.grayMute, fontSize: 9, fontWeight: 700, cursor: "help", flexShrink: 0 }}>?</span>
        )}
      </div>
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 32, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.grayMute, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

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

// ---- Drill-in modal ----
function DrillModal({ stats, mySchoolId, onClose }: { stats: SchoolStats; mySchoolId: string | null; onClose: () => void }) {
  const s = stats;
  const color = s.school.color_primary ?? C.navy2;
  const pct = s.pctToAppliedGoal;
  const tone = s.g.goal_applied > 0 ? goalTone(pct) : C.navy2;
  const isMe = s.school.id === mySchoolId;

  const statItems = [
    { label: "% to Goal", value: s.g.goal_applied > 0 ? `${pct}%` : "—", color: tone },
    { label: "Applied",   value: s.applied,   color: C.navy },
    { label: "Goal",      value: s.g.goal_applied > 0 ? s.g.goal_applied : "—", color: C.grayMute },
    { label: "Sourced",   value: s.sourced,   color: C.navy },
    { label: "Yield",     value: `${Math.round(s.yieldRate * 100)}%`, color: C.navy },
    { label: "Orr Score", value: s.orrScore,  color: C.navy2 },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,.32)" }}
      onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", border: `1px solid ${C.line}`, padding: "24px 28px 32px", width: "100%", maxWidth: 440, boxShadow: "0 -8px 40px rgba(0,0,0,.14)", position: "relative" }}
        onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: `${C.grayMute}22`, border: "none", color: C.grayMute, width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 700 }}>×</button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          {s.school.logo_url && (
            <img src={s.school.logo_url} alt="" style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 8, background: `${color}18`, padding: 4, flexShrink: 0 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          <div>
            <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 18, color: C.navy }}>
              {s.school.name}
              {isMe && <span style={{ marginLeft: 8, fontSize: 11, color, background: `${color}22`, padding: "2px 7px", borderRadius: 99, fontWeight: 700 }}>You</span>}
            </div>
            <div style={{ fontSize: 12, color: C.grayMute, textTransform: "capitalize" }}>{s.school.tier} · {s.active} active candidates</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
          {statItems.map((item) => (
            <div key={item.label} style={{ background: C.canvas, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: C.grayMute, marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 22, color: item.color, lineHeight: 1 }}>{item.value}</div>
            </div>
          ))}
        </div>

        {s.g.goal_applied > 0 && (
          <>
            <div style={{ height: 8, borderRadius: 99, background: C.line, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: tone, borderRadius: 99, transition: "width .6s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: C.grayMute }}>
              <span>{s.applied} of {s.g.goal_applied} applications</span>
              <span style={{ fontWeight: 700, color: tone }}>{pct}% to goal</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function StandingsClient({ schools, candidates, goals, mySchoolId }: {
  schools: SchoolRow[]; candidates: CandRow[]; goals: GoalRow[]; mySchoolId: string | null;
}) {
  const [subTab, setSubTab] = useState<"goal" | "funnel" | "h2h">("goal");
  const [drillId, setDrillId] = useState<string | null>(null);

  const initialA = mySchoolId ?? schools[0]?.id ?? "";
  const [h2hA, setH2hA] = useState(initialA);
  const [h2hB, setH2hB] = useState(schools.find((s) => s.id !== initialA)?.id ?? "");

  const stats    = useMemo(() => computeStats(schools, candidates, goals), [schools, candidates, goals]);
  const statsMap = useMemo(() => new Map(stats.map((s) => [s.school.id, s])), [stats]);

  const byTier = useMemo(() => {
    const tiers = [...new Set(stats.map((s) => s.school.tier))].sort();
    return tiers.map((tier) => ({
      tier,
      rows: stats.filter((s) => s.school.tier === tier).sort((a, b) => b.pctToAppliedGoal - a.pctToAppliedGoal || b.orrScore - a.orrScore),
    }));
  }, [stats]);

  const funnelSorted = useMemo(() => [...stats].sort((a, b) => b.sourced - a.sourced), [stats]);
  const maxSourced   = useMemo(() => Math.max(...funnelSorted.map((s) => s.sourced), 1), [funnelSorted]);

  // Summary stats
  const totalGoalApplied = stats.reduce((s, m) => s + m.g.goal_applied, 0);
  const totalApplied     = stats.reduce((s, m) => s + m.applied, 0);
  const overallPct       = totalGoalApplied > 0 ? Math.round((totalApplied / totalGoalApplied) * 100) : 0;
  const atGoalCount      = stats.filter((m) => m.g.goal_applied > 0 && m.applied >= m.g.goal_applied).length;
  const atRiskCount      = stats.filter((m) => m.orrScore < 50).length;
  const topSchool        = [...stats].sort((a, b) => b.orrScore - a.orrScore)[0] ?? null;

  const drillStats = drillId ? statsMap.get(drillId) ?? null : null;

  const subBtnStyle = (k: string): React.CSSProperties => ({
    border: "none", background: "none", cursor: "pointer", padding: "10px 18px",
    fontFamily: HEAD, fontSize: 14, fontWeight: subTab === k ? 700 : 600,
    color: subTab === k ? C.navy : C.grayMute,
    borderBottom: subTab === k ? `2px solid ${C.navy}` : "2px solid transparent",
  });

  return (
    <div>
      <h1 style={{ fontSize: 30, color: C.navy, margin: "0 0 4px", fontFamily: HEAD }}>Standings</h1>
      <p style={{ color: C.grayMute, margin: "0 0 20px" }}>Live pipeline across all participating schools.</p>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 26 }}>
        <SummaryCard
          label="Overall % to Goal"
          value={totalGoalApplied > 0 ? `${overallPct}%` : "—"}
          color={totalGoalApplied > 0 ? goalTone(overallPct) : C.grayMute}
          tooltip="Org-wide applied count as a percentage of the total applied goal across all schools."
        />
        <SummaryCard
          label="Schools at Goal"
          value={atGoalCount}
          color={C.good}
          tooltip="Schools that have met or exceeded their applied candidate goal."
        />
        <SummaryCard
          label="Schools at Risk"
          value={atRiskCount}
          color={C.orange}
          tooltip="Schools with an Orr Score below 50 — flagged as needing extra attention."
        />
        <SummaryCard
          label="Top Performer"
          value={topSchool?.school.name.split(" ")[0] ?? "—"}
          color={C.navy}
          sub={topSchool ? `${topSchool.orrScore} Orr Score` : undefined}
          tooltip="School with the highest Orr Score this cycle."
        />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.line}`, marginBottom: 26 }}>
        <button style={subBtnStyle("goal")}   onClick={() => setSubTab("goal")}>Goal Attainment</button>
        <button style={subBtnStyle("funnel")} onClick={() => setSubTab("funnel")}>Funnel</button>
        <button style={subBtnStyle("h2h")}    onClick={() => setSubTab("h2h")}>Head-to-Head</button>
      </div>

      {/* ─── GOAL ATTAINMENT ─── */}
      {subTab === "goal" && (
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
                  const pct   = s.pctToAppliedGoal;
                  const tone  = s.g.goal_applied > 0 ? goalTone(pct) : C.grayMute;
                  return (
                    <div key={s.school.id} onClick={() => setDrillId(s.school.id)} style={{
                      background: isMe ? `${color}0F` : "#fff",
                      border: `1px solid ${isMe ? color : C.line}`,
                      borderLeft: `4px solid ${color}`,
                      borderRadius: 12, padding: "14px 18px", cursor: "pointer",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = isMe ? `${color}18` : "#F0F4FA"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isMe ? `${color}0F` : "#fff"; }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 18, color: C.navy3, width: 28, textAlign: "center", flexShrink: 0 }}>
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
                          {/* Goal bars */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 9 }}>
                            {([
                              ["Sourced",   s.sourced,   s.g.goal_sourced,   s.gS] as [string, number, number, number],
                              ["Contacted", s.contacted, s.g.goal_contacted, s.gC] as [string, number, number, number],
                              ["Applied",   s.applied,   s.g.goal_applied,   s.gA] as [string, number, number, number],
                            ]).map(([lbl, act, goal, ratio]) => (
                              <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 10, color: C.grayMute, fontWeight: 600, width: 58, flexShrink: 0 }}>{lbl}</span>
                                <div style={{ flex: 1, height: 5, borderRadius: 99, background: C.line, overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${Math.min(ratio * 100, 100)}%`, background: goal > 0 ? goalTone(Math.round(ratio * 100)) : C.navy3, borderRadius: 99 }} />
                                </div>
                                <span style={{ fontSize: 10, color: C.grayMute, width: 44, textAlign: "right", flexShrink: 0 }}>
                                  {act}{goal > 0 ? `/${goal}` : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0, minWidth: 64 }}>
                          {s.g.goal_applied > 0 ? (
                            <>
                              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 28, color: tone, lineHeight: 1 }}>{pct}%</div>
                              <div style={{ fontSize: 10, color: C.grayMute, fontWeight: 600 }}>to goal</div>
                            </>
                          ) : (
                            <>
                              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 26, color: C.navy2, lineHeight: 1 }}>{s.orrScore}</div>
                              <div style={{ fontSize: 10, color: C.grayMute, fontWeight: 600 }}>Orr Score</div>
                            </>
                          )}
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
            const srcOnly  = Math.max(s.sourced  - s.contacted, 0);
            const cntdOnly = Math.max(s.contacted - s.applied,  0);
            return (
              <div key={s.school.id} onClick={() => setDrillId(s.school.id)} style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: `1px solid ${C.line}`, background: isMe ? `${color}08` : undefined, gap: 12, cursor: "pointer" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = isMe ? `${color}18` : "#F0F4FA"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isMe ? `${color}08` : ""; }}>
                <div style={{ width: 140, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  {s.school.logo_url && <img src={s.school.logo_url} alt="" style={{ height: 20, width: 20, objectFit: "contain", borderRadius: 3, flexShrink: 0 }} />}
                  <span style={{ fontSize: 13, fontWeight: isMe ? 700 : 600, color: C.gray, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.school.name}</span>
                </div>
                <div style={{ flex: 1, height: 18, display: "flex", alignItems: "center" }}>
                  <div style={{ width: `${(s.sourced / maxSourced) * 100}%`, height: "100%", display: "flex", borderRadius: 4, overflow: "hidden", gap: 1 }}>
                    {srcOnly  > 0 && <div style={{ flex: srcOnly,  background: `${C.navy3}66` }} />}
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
        const sA   = statsMap.get(h2hA) ?? null;
        const sB   = statsMap.get(h2hB) ?? null;
        const colA = sA?.school.color_primary ?? C.navy2;
        const colB = sB?.school.color_primary ?? C.orange;
        const rows: [string, number | string, number | string][] = sA && sB ? [
          ["Active Pipeline", sA.active,    sB.active],
          ["Sourced",         sA.sourced,   sB.sourced],
          ["Contacted",       sA.contacted, sB.contacted],
          ["Applied",         sA.applied,   sB.applied],
          ["Finalists",       sA.finalists, sB.finalists],
          ["Fellows",         sA.fellows,   sB.fellows],
          ["Orr Score",       sA.orrScore,  sB.orrScore],
          ["Yield Rate", `${(sA.yieldRate * 100).toFixed(0)}%`, `${(sB.yieldRate * 100).toFixed(0)}%`],
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

      {/* ─── DRILL-IN MODAL ─── */}
      {drillStats && (
        <DrillModal stats={drillStats} mySchoolId={mySchoolId} onClose={() => setDrillId(null)} />
      )}
    </div>
  );
}
