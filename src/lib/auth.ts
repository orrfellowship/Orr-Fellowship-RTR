import { cache } from "react";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

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
