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

// ---- candidate column sets -------------------------------------------------
// Standings only needs these three (computeSchoolMetrics / StandingsClient).
export const CAND_COLS_STANDINGS = "id, school_id, stage";
// Full set the applicants/board views render.
export const CAND_COLS_WORKSPACE =
  "id, name, email, school_id, stage, gpa, area_of_study, jazz_id, linkedin, point_person_id, not_interested, resume_link";
export const CAND_COLS_CONSOLE =
  "id, jazz_id, name, email, school_id, stage, gpa, area_of_study, university_raw, linkedin, resume_link, point_person_id, not_interested, grad_date";

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
