import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import WorkspaceClient from "./WorkspaceClient";

// Loads everything the fellow/lead workspace needs, server-side, then hands
// it to the interactive client view. RLS is in force on every query here.
export default async function WorkspacePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "admin" || profile.role === "super_admin") redirect("/console");

  const supabase = createServerSupabase();
  const schoolId = profile.school_id ?? "";

  const { data: school } = await supabase
    .from("schools")
    .select("id, name, color_primary, logo_url")
    .eq("id", schoolId)
    .maybeSingle();

  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, jazz_id, name, email, stage, gpa, area_of_study, linkedin, resume_link, point_person_id, not_interested")
    .eq("school_id", schoolId)
    .order("name");

  const { data: favs } = await supabase
    .from("favorites")
    .select("candidate_id")
    .eq("user_id", profile.id);

  const { data: team } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("school_id", schoolId);

  const { data: phases } = await supabase
    .from("playbook_phases")
    .select("id, label, title, sort_order, playbook_tasks(id, text, assignee_id, due_date, done)")
    .eq("school_id", schoolId)
    .order("sort_order");

  const favSet = new Set((favs ?? []).map((f) => f.candidate_id));
  const enriched = (candidates ?? []).map((c) => ({ ...c, is_favorite: favSet.has(c.id) }));

  return (
    <WorkspaceClient
      profile={profile}
      school={school ?? null}
      candidates={enriched}
      team={team ?? []}
      phases={phases ?? []}
    />
  );
}
