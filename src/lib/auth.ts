import { cache } from "react";
import { cookies } from "next/headers";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { isAdminPlus, type Profile } from "@/lib/types";
import { ORR_ORANGE } from "@/lib/nav/config";

// Cookie holding the user id an admin is previewing ("view as").
export const VIEW_AS_COOKIE = "orr_view_as";

// Returns the logged-in user's profile, or null if unauthenticated / no profile.
// Every protected page calls this to decide what to render. Wrapped in React
// cache() so the layout and the page share one lookup per request (no double
// auth.getUser + profiles round-trip on every navigation).
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, school_id, is_active")
    .eq("id", user.id)
    .single();

  if (error || !data) return null;
  return data as Profile;
});

export const getProfileById = cache(async (id: string): Promise<Profile | null> => {
  const { data } = await createServiceClient()
    .from("profiles")
    .select("id, full_name, email, role, school_id, is_active")
    .eq("id", id)
    .maybeSingle();
  return (data as Profile) ?? null;
});

// Is an admin currently previewing as someone else? (used to keep preview read-only)
export function isPreviewing(): boolean {
  return !!cookies().get(VIEW_AS_COOKIE)?.value;
}

// Resolve who the UI should render for. Admins can "view as" another person; the
// pages/layout render for that target, while server-action authorization still
// uses the real admin (getCurrentProfile) and writes are blocked during preview.
export async function resolveViewer(): Promise<{
  profile: Profile | null;
  real: Profile | null;
  previewing: { realName: string; asName: string } | null;
}> {
  const real = await getCurrentProfile();
  if (!real || !isAdminPlus(real.role)) return { profile: real, real, previewing: null };
  const targetId = cookies().get(VIEW_AS_COOKIE)?.value;
  if (!targetId || targetId === real.id) return { profile: real, real, previewing: null };
  const target = await getProfileById(targetId);
  if (!target) return { profile: real, real, previewing: null };
  return { profile: target, real, previewing: { realName: real.full_name, asName: target.full_name } };
}

// School row for a profile, shared by the layout (brand/accent) and the section
// page. cache() dedupes the lookup within a single request render.
export type SchoolRow = { id: string; name: string; tier: string | null; color_primary: string | null; logo_url: string | null };
export const getSchoolById = cache(async (schoolId: string | null): Promise<SchoolRow | null> => {
  if (!schoolId) return null;
  const { data } = await createServiceClient()
    .from("schools")
    .select("id, name, tier, color_primary, logo_url")
    .eq("id", schoolId)
    .maybeSingle();
  return (data as SchoolRow) ?? null;
});

// Satellite & bonus schools intentionally share one team, playbook and identity,
// so a fellow's profile.school_id points at an arbitrary "representative" school
// in that tier. Presenting that school's real name/color makes it look like they
// were dropped into a random school — instead we show the tier group ("Satellite
// School" / "Bonus School") with Orr branding. Core schools are returned as-is.
export function tierGroupLabel(tier: string | null): string | null {
  return tier === "satellite" ? "Satellite School" : tier === "bonus" ? "Bonus School" : null;
}
export function displaySchool(school: SchoolRow | null): SchoolRow | null {
  if (!school) return school;
  const group = tierGroupLabel(school.tier);
  if (!group) return school;
  return { ...school, name: group, color_primary: ORR_ORANGE, logo_url: "/orr-emblem.png" };
}
