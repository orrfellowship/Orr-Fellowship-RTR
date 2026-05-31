"use client";

import { useState, useMemo } from "react";
import { computeSchoolMetrics, goalColor, type SchoolMetric } from "@/lib/schoolMetrics";

const C = {
  navy: "#11123E", navy2: "#485F92", navy3: "#8591AD",
  orange: "#DD5434", blue: "#8AB9E2", gray: "#303333", grayMute: "#6E7385",
  line: "#E4E7EE", canvas: "#F7F8FB", gold: "#C9A227", good: "#2F8F6B",
};
const HEAD = "'Cabin', sans-serif";

type SchoolRow = { id: string; name: string; tier: string; color_primary: string | null; logo_url: string | null };
type CandRow   = { id: string; school_id: string | null; stage: string | null };
type GoalRow   = { school_id: string; goal_sourced: number; goal_contacted: number; goal_applied: number };

// Merge satellite/bonus schools into single virtual group entries before computing stats.
function buildMergedData(
  schools: SchoolRow[], candidates: CandRow[], goals: GoalRow[], mySchoolId: string | null
): { schools: SchoolRow[]; candidates: CandRow[]; goals: GoalRow[]; mySchoolId: string | null } {
  const GROUPED = new Set(["satellite", "bonus"]);
  const byTierMap = new Map<string, SchoolRow[]>();
  for (const tier of GROUPED) {
    const ts = schools.filter((s) => s.tier === tier);
    if (ts.length > 0) byTierMap.set(tier, ts);
  }
  if (byTierMap.size === 0) return { schools, candidates, goals, mySchoolId };

  const idToGroup = new Map<string, string>();
  for (const [tier, ts] of byTierMap) {
    for (const s of ts) idToGroup.set(s.id, `group-${tier}`);
  }

  const mergedSchools: SchoolRow[] = [
    ...Array.from(byTierMap.entries()).map(([tier]) => ({
      id: `group-${tier}`,
      name: tier === "satellite" ? "Satellite Group" : "Bonus Group",
      tier,
      color_primary: C.navy2,
      logo_url: null,
    })),
    ...schools.filter((s) => !GROUPED.has(s.tier)),
  ];

  const mergedCandidates = candidates.map((c) =>
    c.school_id && idToGroup.has(c.school_id) ? { ...c, school_id: idToGroup.get(c.school_id)! } : c
  );

  const mergedGoals: GoalRow[] = goals.filter((g) => !idToGroup.has(g.school_id));
  for (const [tier, ts] of byTierMap) {
    const rep = goals.find((g) => ts.some((s) => s.id === g.school_id));
    if (rep) mergedGoals.push({ school_id: `group-${tier}`, goal_sourced: rep.goal_sourced, goal_contacted: rep.goal_contacted, goal_applied: rep.goal_applied });
  }

  const mergedMyId = mySchoolId && idToGroup.has(mySchoolId) ? idToGroup.get(mySchoolId)! : mySchoolId;
  return { schools: mergedSchools, candidates: mergedCandidates, goals: mergedGoals, mySchoolId: mergedMyId };
}

// ---- Summary card ----
function SummaryCard({ label, value, color, sub, tooltip }: {
  label: string; value: string | number; color: string; sub?: string; tooltip?: string;
}) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 20px" }}>
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

// ---- SVG radar — 6 axes ----
function RadarChart({ m, color }: { m: SchoolMetric; color: string }) {
  const SZ = 150, cx = SZ / 2, cy = SZ / 2, R = 56;
  const axes = [
    { label: "Src Goal",  value: m.gS },
    { label: "Cntd Goal", value: m.gC },
    { label: "Appl Goal", value: m.gA },
    { label: "Yield",     value: m.yieldRate },
    { label: "Depth",     value: Math.min(m.depth * 2.5, 1) },
    { label: "Finalist",  value: m.sourced > 0 ? Math.min((m.finalists / m.sourced) * 4, 1) : 0 },
  ];
  const N = axes.length;
  const pt = (i: number, scale: number): [number, number] => {
    const a = (i * 2 * Math.PI) / N - Math.PI / 2;
    return [cx + scale * R * Math.cos(a), cy + scale * R * Math.sin(a)];
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
        const [x, y] = pt(i, 1.28);
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
function DrillModal({ m, mySchoolId, onClose }: { m: SchoolMetric; mySchoolId: string | null; onClose: () => void }) {
  const tone = m.goal > 0 ? goalColor(m.pctToGoal) : C.navy2;
  const isMe = m.key === mySchoolId;

  const statItems = [
    { label: "% to Goal", value: m.goal > 0 ? `${m.pctToGoal}%` : "—", color: tone },
    { label: "Applied",   value: m.applied,  color: C.navy },
    { label: "Goal",      value: m.goal > 0 ? m.goal : "—", color: C.grayMute },
    { label: "Sourced",   value: m.sourced,  color: C.navy },
    { label: "Yield",     value: `${m.yield}%`, color: C.navy },
    { label: "Orr Score", value: m.orrScore, color: C.navy2 },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,.32)" }}
      onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", border: `1px solid ${C.line}`, padding: "24px 28px 32px", width: "100%", maxWidth: 440, boxShadow: "0 -8px 40px rgba(0,0,0,.14)", position: "relative" }}
        onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: `${C.grayMute}22`, border: "none", color: C.grayMute, width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 16, fontWeight: 700 }}>×</button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          {m.logo ? (
            <img src={m.logo} alt="" style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 8, background: `${m.color}18`, padding: 4, flexShrink: 0 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: 8, background: m.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: HEAD, fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
              {m.short[0]}
            </div>
          )}
          <div>
            <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 18, color: C.navy }}>
              {m.name}
              {isMe && <span style={{ marginLeft: 8, fontSize: 11, color: m.color, background: `${m.color}22`, padding: "2px 7px", borderRadius: 99, fontWeight: 700 }}>You</span>}
            </div>
            <div style={{ fontSize: 12, color: C.grayMute, textTransform: "capitalize" }}>
              {m.tier} · {m.active} active candidate{m.active !== 1 ? "s" : ""}
              {m.enrollment > 0 ? ` · Enrollment ~${m.enrollment.toLocaleString()}` : ""}
            </div>
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

        {m.goal > 0 && (
          <>
            <div style={{ height: 8, borderRadius: 99, background: C.line, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(m.pctToGoal, 100)}%`, background: tone, borderRadius: 99, transition: "width .6s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: C.grayMute }}>
              <span>{m.applied} of {m.goal} applications</span>
              <span style={{ fontWeight: 700, color: tone }}>{m.pctToGoal}% to goal</span>
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
  const [subTab, setSubTab] = useState<"goal" | "funnel" | "matrix" | "h2h">("goal");
  const [drillId, setDrillId] = useState<string | null>(null);

  const merged = useMemo(
    () => buildMergedData(schools, candidates, goals, mySchoolId),
    [schools, candidates, goals, mySchoolId]
  );
  const resolvedMyId = merged.mySchoolId;

  const initialA = resolvedMyId ?? merged.schools[0]?.id ?? "";
  const [h2hA, setH2hA] = useState(initialA);
  const [h2hB, setH2hB] = useState(merged.schools.find((s) => s.id !== initialA)?.id ?? "");

  const stats    = useMemo(
    () => computeSchoolMetrics(merged.candidates, merged.schools, merged.goals),
    [merged]
  );
  const statsMap = useMemo(() => new Map(stats.map((m) => [m.key, m])), [stats]);

  const tierLabel = (tier: string) =>
    tier === "core" ? "Core Schools" : tier === "satellite" ? "Satellite Group" : tier === "bonus" ? "Bonus Group" : tier;

  const byTier = useMemo(() => {
    const tiers = [...new Set(stats.map((m) => m.tier))].sort();
    return tiers.map((tier) => ({
      tier,
      rows: stats.filter((m) => m.tier === tier).sort((a, b) => b.pctToGoal - a.pctToGoal || b.orrScore - a.orrScore),
    }));
  }, [stats]);

  const funnelSorted = useMemo(() => [...stats].sort((a, b) => b.sourced - a.sourced), [stats]);
  const maxSourced   = useMemo(() => Math.max(...funnelSorted.map((m) => m.sourced), 1), [funnelSorted]);

  // Summary stats
  const totalGoal    = stats.reduce((s, m) => s + m.goal, 0);
  const totalApplied = stats.reduce((s, m) => s + m.applied, 0);
  const overallPct   = totalGoal > 0 ? Math.round((totalApplied / totalGoal) * 100) : 0;
  const atGoalCount  = stats.filter((m) => m.atGoal).length;
  const atRiskCount  = stats.filter((m) => m.atRisk).length;
  const topSchool    = stats[0] ?? null; // already sorted by orrScore desc

  const drillMetric = drillId ? statsMap.get(drillId) ?? null : null;

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
          value={totalGoal > 0 ? `${overallPct}%` : "—"}
          color={totalGoal > 0 ? goalColor(overallPct) : C.grayMute}
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
          tooltip="Schools with fewer than 50% to goal AND active candidates in the pipeline."
        />
        <SummaryCard
          label="Top Performer"
          value={topSchool?.short ?? "—"}
          color={C.navy}
          sub={topSchool ? `${topSchool.orrScore} Orr Score` : undefined}
          tooltip="School with the highest Orr Score this cycle."
        />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.line}`, marginBottom: 26 }}>
        <button style={subBtnStyle("goal")}   onClick={() => setSubTab("goal")}>Goal Attainment</button>
        <button style={subBtnStyle("funnel")} onClick={() => setSubTab("funnel")}>Funnel Comparison</button>
        <button style={subBtnStyle("matrix")} onClick={() => setSubTab("matrix")}>Volume × Yield</button>
        <button style={subBtnStyle("h2h")}    onClick={() => setSubTab("h2h")}>Head-to-Head</button>
      </div>

      {/* ─── GOAL ATTAINMENT ─── */}
      {subTab === "goal" && (
        <div>
          {byTier.map(({ tier, rows }) => (
            <div key={tier} style={{ marginBottom: 32 }}>
              <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, letterSpacing: 1, marginBottom: 10 }}>
                {tierLabel(tier)}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {rows.map((m, rank) => {
                  const isMe = m.key === resolvedMyId;
                  const tone = m.goal > 0 ? goalColor(m.pctToGoal) : C.grayMute;
                  return (
                    <div key={m.key} onClick={() => setDrillId(m.key)} style={{
                      background: isMe ? `${m.color}0F` : "#fff",
                      border: `1px solid ${isMe ? m.color : C.line}`,
                      borderLeft: `4px solid ${m.color}`,
                      borderRadius: 12, padding: "14px 18px", cursor: "pointer",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = isMe ? `${m.color}18` : "#F0F4FA"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isMe ? `${m.color}0F` : "#fff"; }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 18, color: C.navy3, width: 28, textAlign: "center", flexShrink: 0 }}>
                          #{rank + 1}
                        </div>
                        {m.logo ? (
                          <img src={m.logo} alt="" style={{ height: 26, width: 26, objectFit: "contain", borderRadius: 4, flexShrink: 0 }} />
                        ) : (
                          <div style={{ height: 26, width: 26, borderRadius: 4, background: m.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: HEAD, flexShrink: 0 }}>
                            {m.short[0]}
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: C.gray, fontSize: 15 }}>
                            {m.name}
                            {isMe && <span style={{ marginLeft: 8, fontSize: 11, color: m.color, background: `${m.color}22`, padding: "2px 7px", borderRadius: 99, fontWeight: 700 }}>You</span>}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 9 }}>
                            {([
                              ["Sourced",   m.sourced,   m.goalSourced,   m.gS],
                              ["Contacted", m.contacted, m.goalContacted, m.gC],
                              ["Applied",   m.applied,   m.goal,          m.gA],
                            ] as [string, number, number, number][]).map(([lbl, act, gl, ratio]) => (
                              <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 10, color: C.grayMute, fontWeight: 600, width: 58, flexShrink: 0 }}>{lbl}</span>
                                <div style={{ flex: 1, height: 5, borderRadius: 99, background: C.line, overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${Math.min(ratio * 100, 100)}%`, background: gl > 0 ? goalColor(Math.round(ratio * 100)) : C.navy3, borderRadius: 99 }} />
                                </div>
                                <span style={{ fontSize: 10, color: C.grayMute, width: 44, textAlign: "right", flexShrink: 0 }}>
                                  {act}{gl > 0 ? `/${gl}` : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0, minWidth: 64 }}>
                          {m.goal > 0 ? (
                            <>
                              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 28, color: tone, lineHeight: 1 }}>{m.pctToGoal}%</div>
                              <div style={{ fontSize: 10, color: C.grayMute, fontWeight: 600 }}>to goal</div>
                            </>
                          ) : (
                            <>
                              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 26, color: C.navy2, lineHeight: 1 }}>{m.orrScore}</div>
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

      {/* ─── FUNNEL COMPARISON ─── */}
      {subTab === "funnel" && (
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "12px 18px 12px 160px", borderBottom: `1px solid ${C.line}`, gap: 16, fontFamily: HEAD, fontSize: 11, fontWeight: 700, color: C.grayMute, textTransform: "uppercase" }}>
            <span style={{ color: C.navy3 }}>▮ Sourced</span>
            <span style={{ color: C.blue }}>▮ Contacted</span>
            <span style={{ color: C.navy2 }}>▮ Applied</span>
          </div>
          {funnelSorted.map((m) => {
            const isMe    = m.key === resolvedMyId;
            const gPct    = m.goalSourced > 0 ? `${Math.round((m.sourced / m.goalSourced) * 100)}%` : null;
            const srcOnly  = Math.max(m.sourced  - m.contacted, 0);
            const cntdOnly = Math.max(m.contacted - m.applied,  0);
            return (
              <div key={m.key} onClick={() => setDrillId(m.key)} style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: `1px solid ${C.line}`, background: isMe ? `${m.color}08` : undefined, gap: 12, cursor: "pointer" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = isMe ? `${m.color}18` : "#F0F4FA"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isMe ? `${m.color}08` : ""; }}>
                <div style={{ width: 140, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  {m.logo ? (
                    <img src={m.logo} alt="" style={{ height: 20, width: 20, objectFit: "contain", borderRadius: 3, flexShrink: 0 }} />
                  ) : (
                    <div style={{ height: 20, width: 20, borderRadius: 3, background: m.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: HEAD, flexShrink: 0 }}>
                      {m.short[0]}
                    </div>
                  )}
                  <span style={{ fontSize: 13, fontWeight: isMe ? 700 : 600, color: C.gray, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                </div>
                <div style={{ flex: 1, height: 18, display: "flex", alignItems: "center" }}>
                  <div style={{ width: `${(m.sourced / maxSourced) * 100}%`, height: "100%", display: "flex", borderRadius: 4, overflow: "hidden", gap: 1 }}>
                    {srcOnly  > 0 && <div style={{ flex: srcOnly,  background: `${C.navy3}66` }} />}
                    {cntdOnly > 0 && <div style={{ flex: cntdOnly, background: C.blue, opacity: 0.85 }} />}
                    {m.applied > 0 && <div style={{ flex: m.applied, background: C.navy2 }} />}
                  </div>
                </div>
                <div style={{ width: 110, display: "flex", gap: 6, justifyContent: "flex-end", fontSize: 12, color: C.grayMute, flexShrink: 0, fontFamily: HEAD }}>
                  <span><b style={{ color: C.gray }}>{m.sourced}</b> / <b style={{ color: C.navy2 }}>{m.applied}</b></span>
                  {gPct && <span style={{ color: m.goalSourced > 0 && m.sourced >= m.goalSourced ? C.good : C.orange, fontWeight: 700 }}>{gPct}</span>}
                </div>
              </div>
            );
          })}
          {funnelSorted.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>No data yet.</div>}
        </div>
      )}

      {/* ─── VOLUME × YIELD MATRIX ─── */}
      {subTab === "matrix" && (() => {
        const W = 520, H = 380;
        const pad = { l: 52, r: 24, t: 28, b: 52 };
        const iW = W - pad.l - pad.r;
        const iH = H - pad.t - pad.b;
        const maxSrc = Math.max(...stats.map((m) => m.sourced), 4);
        const midX = maxSrc / 2;
        const toX = (v: number) => pad.l + (v / maxSrc) * iW;
        const toY = (v: number) => pad.t + (1 - v / 100) * iH; // 0% at bottom, 100% at top
        const hasData = stats.some((m) => m.sourced > 0);
        return (
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "20px 24px" }}>
            <div style={{ fontFamily: HEAD, fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 4 }}>Volume × Yield Matrix</div>
            <div style={{ fontSize: 12, color: C.grayMute, marginBottom: 16 }}>
              Sourced volume (x) vs yield — applied ÷ sourced (y). Click any school for details.
            </div>
            {!hasData ? (
              <div style={{ padding: 48, textAlign: "center", color: C.grayMute }}>No pipeline data yet.</div>
            ) : (
              <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxHeight: 380 }}>
                {/* Canvas */}
                <rect x={pad.l} y={pad.t} width={iW} height={iH} fill={C.canvas} rx={6} />

                {/* Quadrant fills */}
                <rect x={toX(midX)} y={pad.t}          width={iW / 2} height={iH / 2} fill="#10b98108" />
                <rect x={pad.l}     y={pad.t}          width={iW / 2} height={iH / 2} fill="#f59e0b08" />
                <rect x={toX(midX)} y={pad.t + iH / 2} width={iW / 2} height={iH / 2} fill="#ef444408" />
                <rect x={pad.l}     y={pad.t + iH / 2} width={iW / 2} height={iH / 2} fill="#ef444408" />

                {/* Quadrant dividers */}
                <line x1={toX(midX)} y1={pad.t} x2={toX(midX)} y2={pad.t + iH} stroke={C.line} strokeWidth={1.5} strokeDasharray="5,4" />
                <line x1={pad.l} y1={toY(50)} x2={pad.l + iW} y2={toY(50)} stroke={C.line} strokeWidth={1.5} strokeDasharray="5,4" />

                {/* Quadrant labels */}
                <text x={pad.l + iW * 0.75} y={pad.t + 14} textAnchor="middle" style={{ fontSize: 9, fill: "#10b981", fontFamily: HEAD, fontWeight: 700 }}>High Volume · High Yield</text>
                <text x={pad.l + iW * 0.25} y={pad.t + 14} textAnchor="middle" style={{ fontSize: 9, fill: "#f59e0b", fontFamily: HEAD, fontWeight: 700 }}>Low Volume · High Yield</text>
                <text x={pad.l + iW * 0.75} y={pad.t + iH - 6} textAnchor="middle" style={{ fontSize: 9, fill: "#ef4444", fontFamily: HEAD, fontWeight: 700 }}>High Volume · Low Yield</text>
                <text x={pad.l + iW * 0.25} y={pad.t + iH - 6} textAnchor="middle" style={{ fontSize: 9, fill: "#ef4444", fontFamily: HEAD, fontWeight: 700 }}>Low Volume · Low Yield</text>

                {/* X axis */}
                <line x1={pad.l} y1={pad.t + iH} x2={pad.l + iW} y2={pad.t + iH} stroke={C.line} strokeWidth={1} />
                {[0, Math.round(midX), maxSrc].map((v, i) => (
                  <g key={i}>
                    <line x1={toX(v)} y1={pad.t + iH} x2={toX(v)} y2={pad.t + iH + 5} stroke={C.grayMute} strokeWidth={1} />
                    <text x={toX(v)} y={pad.t + iH + 18} textAnchor="middle" style={{ fontSize: 10, fill: C.grayMute, fontFamily: HEAD }}>{v}</text>
                  </g>
                ))}
                <text x={pad.l + iW / 2} y={H - 4} textAnchor="middle" style={{ fontSize: 10, fill: C.grayMute, fontFamily: HEAD, fontWeight: 600 }}>Sourced Volume →</text>

                {/* Y axis */}
                <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + iH} stroke={C.line} strokeWidth={1} />
                {[0, 25, 50, 75, 100].map((v) => (
                  <g key={v}>
                    <line x1={pad.l - 5} y1={toY(v)} x2={pad.l} y2={toY(v)} stroke={C.grayMute} strokeWidth={1} />
                    <text x={pad.l - 8} y={toY(v)} textAnchor="end" dominantBaseline="middle" style={{ fontSize: 10, fill: C.grayMute, fontFamily: HEAD }}>{v}%</text>
                  </g>
                ))}
                <text x={13} y={pad.t + iH / 2} textAnchor="middle" dominantBaseline="middle"
                  transform={`rotate(-90 13 ${pad.t + iH / 2})`}
                  style={{ fontSize: 10, fill: C.grayMute, fontFamily: HEAD, fontWeight: 600 }}>Yield % →</text>

                {/* School dots */}
                {stats.map((m) => {
                  const x = toX(m.sourced);
                  const y = toY(m.yield);
                  const isMe = m.key === resolvedMyId;
                  const r = isMe ? 9 : 7;
                  return (
                    <g key={m.key} style={{ cursor: "pointer" }} onClick={() => setDrillId(m.key)}>
                      {/* larger invisible hit area */}
                      <circle cx={x} cy={y} r={r + 5} fill="transparent" />
                      <circle cx={x} cy={y} r={r} fill={m.color} opacity={0.9} stroke="#fff" strokeWidth={isMe ? 2.5 : 1.5} />
                      <text x={x} y={y - r - 5} textAnchor="middle" style={{ fontSize: 9, fill: C.gray, fontWeight: 700, fontFamily: HEAD, pointerEvents: "none" }}>
                        {m.short}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        );
      })()}

      {/* ─── HEAD-TO-HEAD ─── */}
      {subTab === "h2h" && (() => {
        const mA   = statsMap.get(h2hA) ?? null;
        const mB   = statsMap.get(h2hB) ?? null;
        const colA = mA?.color ?? C.navy2;
        const colB = mB?.color ?? C.orange;
        const rows: [string, number | string, number | string][] = mA && mB ? [
          ["Active Pipeline", mA.active,    mB.active],
          ["Sourced",         mA.sourced,   mB.sourced],
          ["Contacted",       mA.contacted, mB.contacted],
          ["Applied",         mA.applied,   mB.applied],
          ["Finalists",       mA.finalists, mB.finalists],
          ["Fellows",         mA.fellows,   mB.fellows],
          ["Orr Score",       mA.orrScore,  mB.orrScore],
          ["Yield Rate",      `${mA.yield}%`, `${mB.yield}%`],
        ] : [];
        return (
          <div>
            <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap", alignItems: "center" }}>
              <select value={h2hA} onChange={(e) => setH2hA(e.target.value)}
                style={{ padding: "10px 14px", borderRadius: 10, border: `2px solid ${colA}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 700 }}>
                {merged.schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span style={{ color: C.grayMute, fontWeight: 700, fontSize: 16 }}>vs</span>
              <select value={h2hB} onChange={(e) => setH2hB(e.target.value)}
                style={{ padding: "10px 14px", borderRadius: 10, border: `2px solid ${colB}`, fontSize: 14, background: "#fff", color: C.gray, fontWeight: 700 }}>
                {merged.schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {mA && mB && (
              <>
                <div style={{ display: "flex", gap: 32, justifyContent: "center", marginBottom: 28, flexWrap: "wrap" }}>
                  {([{ m: mA, col: colA }, { m: mB, col: colB }] as const).map(({ m, col }) => (
                    <div key={m.key} style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: HEAD, fontWeight: 700, color: col, marginBottom: 6 }}>{m.name}</div>
                      <RadarChart m={m} color={col} />
                      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 28, color: col, marginTop: 4 }}>
                        {m.orrScore} <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>Orr</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr", padding: "12px 20px", borderBottom: `1px solid ${C.line}`, background: "#FAFBFE", fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute }}>
                    <div style={{ color: colA }}>{mA.name}</div>
                    <div style={{ textAlign: "center" }}>Metric</div>
                    <div style={{ textAlign: "right", color: colB }}>{mB.name}</div>
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
            {(!mA || !mB) && (
              <div style={{ padding: 40, textAlign: "center", color: C.grayMute }}>Select two schools above to compare.</div>
            )}
          </div>
        );
      })()}

      {/* ─── DRILL-IN MODAL ─── */}
      {drillMetric && (
        <DrillModal m={drillMetric} mySchoolId={resolvedMyId} onClose={() => setDrillId(null)} />
      )}
    </div>
  );
}
