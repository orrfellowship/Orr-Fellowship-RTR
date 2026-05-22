import { createServerSupabase } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

// Returns the logged-in user's profile, or null if unauthenticated / no profile.
// Every protected page calls this to decide what to render.
export async function getCurrentProfile(): Promise<Profile | null> {
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
}
