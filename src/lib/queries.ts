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
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) break; // mirror the existing `?? []` tolerance rather than crashing the page
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return all;
}

// ---- candidate column sets -------------------------------------------------
// Standings only needs these three (computeSchoolMetrics / StandingsClient).
export const CAND_COLS_STANDINGS = "id, school_id, stage";
// Full set the applicants/board views render.
export const CAND_COLS_WORKSPACE =
  "id, name, email, school_id, stage, gpa, area_of_study, jazz_id, linkedin, point_person_id, not_interested, resume_link, source, created_by";
export const CAND_COLS_CONSOLE =
  "id, jazz_id, name, email, school_id, stage, gpa, area_of_study, university_raw, linkedin, resume_link, point_person_id, not_interested, grad_date, source, created_by";

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
