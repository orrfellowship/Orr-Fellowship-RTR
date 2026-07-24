import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";

// Shared data layer for the workspace + console section routes.
//
//  • Column sets live here once so both areas stay in sync (and standings ships
//    only what computeSchoolMetrics actually reads — see CAND_COLS_STANDINGS).
//  • Reference tables (schools / goals / resources) change rarely and are the
//    same for every user, so they live in the Next Data Cache (unstable_cache)
//    and are shared across navigations and users. Mutations bust them with
//    revalidateTag — see the console actions.
//  • getTierSchoolIds is React-cache()'d so the layout's nav loader and the
//    section page collapse their identical tier lookup into one query/request.

// ---- unbounded reads -------------------------------------------------------
// PostgREST caps a single SELECT at 1000 rows (its `max-rows` default), so a
// plain `.select()` silently truncates once a table passes 1000 rows. Any list
// that scales with candidate count must page through with `.range()` until a
// short page comes back. `makeQuery` should apply the range to the built query
// (e.g. `db.from("candidates").select(...).order("name").range(from, to)`).
export async function fetchAllRows<T = any>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  // Page 0 alone first: most tables fit in one page, so this stays 1 request.
  const first = await makeQuery(0, pageSize - 1);
  if (first.error) return []; // mirror the existing `?? []` tolerance rather than crashing the page
  const all: T[] = [...(first.data ?? [])];
  if (all.length < pageSize) return all;
  // Bigger tables: fetch the remaining pages in parallel waves rather than one
  // at a time (no count round-trip needed — a short/empty page ends the scan).
  const WAVE = 4;
  for (let page = 1; ; page += WAVE) {
    const results = await Promise.all(
      Array.from({ length: WAVE }, (_, i) => {
        const from = (page + i) * pageSize;
        return makeQuery(from, from + pageSize - 1);
      }),
    );
    for (const r of results) {
      if (r.error) return all; // same tolerance: keep what we have
      const batch = r.data ?? [];
      all.push(...batch);
      if (batch.length < pageSize) return all;
    }
  }
}

// ---- aggregate candidate counts (phase19 RPCs) ---------------------------
// Standings / Overview / Schools and the snapshot's misrouted check only need
// per-school, per-stage COUNTS. One grouped RPC replaces paging the whole
// candidates table and shrinks the RSC payload to a few dozen rows.
export type StageCountRow = {
  school_id: string | null;
  university_raw: string | null;
  stage: string | null;
  not_interested: boolean;
  n: number;
};

export const getCandidateStageCounts = cache(async (): Promise<StageCountRow[]> => {
  const { data } = await createServiceClient().rpc("candidate_stage_counts");
  return ((data as any[]) ?? []).map((r) => ({ ...r, n: Number(r.n) }));
});

// Per-school DEI counts (total + diverse) for the Standings DEI check. Diverse =
// any candidate whose race is present and not "White" (declines/blanks excluded
// from the numerator but still counted in the total). Sensitive — only loaded
// for non-fellow viewers.
export type SchoolDeiCount = { school_id: string; total: number; diverse: number };
export const getSchoolDeiCounts = cache(async (): Promise<SchoolDeiCount[]> => {
  const { data } = await createServiceClient().rpc("school_dei_counts");
  return ((data as any[]) ?? []).map((r) => ({ school_id: r.school_id, total: Number(r.total), diverse: Number(r.diverse) }));
});

// Collapse to (school_id, stage) for consumers that don't split by raw
// university text (standings, workspace snapshot counters).
export function collapseStageCounts(
  rows: StageCountRow[],
): { school_id: string | null; stage: string | null; n: number }[] {
  const byKey = new Map<string, { school_id: string | null; stage: string | null; n: number }>();
  for (const r of rows) {
    const k = `${r.school_id ?? ""}|${r.stage ?? ""}`;
    const cur = byKey.get(k);
    if (cur) cur.n += r.n;
    else byKey.set(k, { school_id: r.school_id, stage: r.stage, n: r.n });
  }
  return [...byKey.values()];
}

// ---- candidate column sets -------------------------------------------------
// Standings only needs these three (computeSchoolMetrics / StandingsClient).
export const CAND_COLS_STANDINGS = "id, school_id, stage";
// Pipeline cards/goal summaries need school grouping and stage counts, not the
// full candidate record.
export const CAND_COLS_PIPELINE = "id, school_id, university_raw, stage";
// Full set the applicants/board views render.
export const CAND_COLS_WORKSPACE =
  "id, name, email, school_id, stage, gpa, area_of_study, university_raw, jazz_id, linkedin, point_person_id, not_interested, resume_link, source, created_by";
// Console is admin-only (non-fellow), so it may carry the sensitive race field.
export const CAND_COLS_CONSOLE =
  "id, jazz_id, name, email, school_id, stage, gpa, area_of_study, university_raw, linkedin, resume_link, point_person_id, not_interested, grad_date, race, source, created_by";

// ---- cached reference data -------------------------------------------------
export const getSchoolsCached = unstable_cache(
  async (): Promise<any[]> => {
    const { data } = await createServiceClient()
      .from("schools")
      .select("id, name, tier, color_primary, logo_url")
      .order("name");
    return data ?? [];
  },
  ["schools"],
  { tags: ["schools"], revalidate: 60 },
);

export const getGoalsCached = unstable_cache(
  async (): Promise<any[]> => {
    const { data } = await createServiceClient()
      .from("school_goals")
      .select("school_id, goal_sourced, goal_contacted, goal_applied");
    return data ?? [];
  },
  ["goals"],
  { tags: ["goals"], revalidate: 60 },
);

export const getResourcesCached = unstable_cache(
  async (): Promise<any[]> => {
    const { data } = await createServiceClient()
      .from("resources")
      .select("id, name, description, link, created_by, created_at")
      .order("created_at", { ascending: false });
    return data ?? [];
  },
  ["resources"],
  { tags: ["resources"], revalidate: 60 },
);

// ---- shared tier resolution (request-deduped) ------------------------------
// Satellite/bonus tiers share one team + playbook, so a fellow/lead's data
// spans every school in their tier. Returns the ids (ordered by name) and tier.
export const getTierSchoolIds = cache(
  async (schoolId: string | null): Promise<{ ids: string[]; tier: string | null }> => {
    if (!schoolId) return { ids: [], tier: null };
    const db = createServiceClient();
    const { data: school } = await db.from("schools").select("tier").eq("id", schoolId).maybeSingle();
    const tier = (school as any)?.tier ?? null;
    if (tier === "satellite" || tier === "bonus") {
      const { data: rows } = await db.from("schools").select("id").eq("tier", tier).order("name");
      return { ids: (rows ?? []).map((r: any) => r.id), tier };
    }
    return { ids: [schoolId], tier };
  },
);
