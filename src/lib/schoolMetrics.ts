import { phaseOf, isActive } from "./stages";

export type SchoolMetric = {
  key: string;
  name: string;
  short: string;
  tier: "core" | "satellite" | "bonus";
  logo: string;
  enrollment: number; // TODO: add schools.enrollment_estimate to schema
  sourced: number;
  contacted: number;
  applied: number;
  finalists: number;
  fellows: number;
  active: number;
  goal: number;
  goalSourced: number;
  goalContacted: number;
  pctToGoal: number;
  yield: number;
  yieldRate: number;
  orrScore: number;
  depth: number;
  gS: number;
  gC: number;
  gA: number;
  atGoal: boolean;
  atRisk: boolean;
  color: string;
};

export function goalColor(pct: number): string {
  if (pct >= 100) return "#10b981";
  if (pct >= 75) return "#11123E";
  if (pct >= 50) return "#f59e0b";
  return "#ef4444";
}

type RawCandidate = { id: string; school_id: string | null; stage: string | null };
type RawSchool = { id: string; name: string; tier: string; color_primary?: string | null; logo_url?: string | null };
type RawGoal = { school_id: string; goal_sourced: number; goal_contacted: number; goal_applied: number };

const PH_ORDER: Record<string, number> = {
  sourced: 0, contacted: 1, applied: 2, advanced: 3, finalist: 4, fellow: 5,
};

export function computeSchoolMetrics(
  candidates: RawCandidate[],
  schools: RawSchool[],
  goals: RawGoal[],
): SchoolMetric[] {
  const goalMap = new Map(goals.map((g) => [g.school_id, g]));

  const metrics: SchoolMetric[] = schools.map((school) => {
    const sc = candidates.filter((c) => c.school_id === school.id && isActive(c.stage));
    const ph = (c: RawCandidate) => phaseOf(c.stage) ?? "";

    const sourced   = sc.filter((c) => ["sourced","contacted","applied","advanced","finalist","fellow"].includes(ph(c))).length;
    const contacted = sc.filter((c) => ["contacted","applied","advanced","finalist","fellow"].includes(ph(c))).length;
    const applied   = sc.filter((c) => ["applied","advanced","finalist","fellow"].includes(ph(c))).length;
    const finalists = sc.filter((c) => ["finalist","fellow"].includes(ph(c))).length;
    const fellows   = sc.filter((c) => ph(c) === "fellow").length;

    const g = goalMap.get(school.id) ?? { goal_sourced: 0, goal_contacted: 0, goal_applied: 0 };

    const gS = g.goal_sourced   > 0 ? Math.min(sourced   / g.goal_sourced,   1) : 0;
    const gC = g.goal_contacted > 0 ? Math.min(contacted / g.goal_contacted, 1) : 0;
    const gA = g.goal_applied   > 0 ? Math.min(applied   / g.goal_applied,   1) : 0;
    // Contacted is no longer a goal — attainment is sourced + applied only.
    const denom = (g.goal_sourced > 0 ? 1 : 0) + (g.goal_applied > 0 ? 1 : 0);
    const goalAtt = denom > 0 ? (gS + gA) / denom : 0;

    const yieldRate = sourced > 0 ? Math.min(applied / sourced, 1) : 0;

    const depth = sc.length > 0
      ? sc.reduce((sum, c) => sum + (PH_ORDER[ph(c)] ?? 0), 0) / (sc.length * 5)
      : 0;

    const orrScore = Math.round((goalAtt * 0.50 + yieldRate * 0.35 + depth * 0.15) * 100);
    const pctToGoal = g.goal_applied > 0 ? Math.round((applied / g.goal_applied) * 100) : 0;
    const yieldPct  = sourced > 0 ? Math.round(yieldRate * 100) : 0;

    return {
      key:          school.id,
      name:         school.name,
      short:        school.name.split(" ")[0],
      tier:         school.tier as "core" | "satellite" | "bonus",
      logo:         school.logo_url ?? "",
      enrollment:   0,
      sourced,
      contacted,
      applied,
      finalists,
      fellows,
      active:       sc.length,
      goal:         g.goal_applied,
      goalSourced:  g.goal_sourced,
      goalContacted: g.goal_contacted,
      pctToGoal,
      yield:        yieldPct,
      yieldRate,
      orrScore,
      depth,
      gS,
      gC,
      gA,
      atGoal:  pctToGoal >= 100,
      atRisk:  pctToGoal < 50 && sourced > 0,
      color:   school.color_primary ?? "#485F92",
    };
  });

  return metrics.sort((a, b) => b.orrScore - a.orrScore);
}
