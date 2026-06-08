import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { isSuper, isAdminPlus } from "@/lib/types";
import { canAccessConsoleSection } from "@/lib/nav/config";
import ConsoleClient from "../ConsoleClient";

export default async function ConsoleSection({ params }: { params: { section: string } }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!isAdminPlus(profile.role)) redirect("/workspace/snapshot");
  // Per-section server guard (mirrors the sidebar's allowed routes). A hand-typed
  // /console/users by an admin (non-super) lands here and is bounced.
  if (!canAccessConsoleSection(profile.role, params.section)) redirect("/console/overview");
  const initialSection = params.section;

  const supabase = createServerSupabase();

  const { data: schools } = await supabase.from("schools").select("id, name, tier, color_primary, logo_url").order("name");
  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, jazz_id, name, email, school_id, stage, gpa, area_of_study, university_raw, linkedin, resume_link, point_person_id, not_interested, grad_date")
    .order("name");
  const { data: favs } = await supabase.from("favorites").select("candidate_id").eq("user_id", profile.id);
  const { data: team } = await supabase.from("profiles").select("id, full_name").order("full_name");
  const { data: goals } = await supabase.from("school_goals").select("school_id, goal_sourced, goal_contacted, goal_applied");
  const { data: phases } = await supabase
    .from("playbook_phases")
    .select("id, label, title, sort_order, school_id, playbook_tasks(id, text, assignee_id, assignee_label, month_label, notes, due_date, done)")
    .order("sort_order");
  const { data: resources } = await supabase.from("resources").select("id, name, description, link, created_by, created_at").order("created_at", { ascending: false });

  let ai: { candidate_id: string; resume_score: number | null; summary: string | null; flags: any; analyzed_at: string | null }[] = [];
  let users: { id: string; full_name: string; email: string; role: string; school_id: string | null; is_active: boolean }[] = [];
  let reviews: { id: string; jazz_snapshot: any; candidate_id: string | null; reason: string | null }[] = [];

  if (isAdminPlus(profile.role)) {
    const { data: reviewData } = await createServiceClient()
      .from("jazz_match_review").select("id, jazz_snapshot, candidate_id, reason").eq("status", "pending").order("created_at", { ascending: false });
    reviews = reviewData ?? [];
  }
  if (isSuper(profile.role)) {
    const [{ data: aiData }, { data: usersData }] = await Promise.all([
      supabase.from("candidate_ai").select("candidate_id, resume_score, summary, flags, analyzed_at"),
      supabase.from("profiles").select("id, full_name, email, role, school_id, is_active").order("full_name"),
    ]);
    ai = aiData ?? [];
    users = usersData ?? [];
  }

  const favSet = new Set((favs ?? []).map((f) => f.candidate_id));
  const enriched = (candidates ?? []).map((c) => ({ ...c, is_favorite: favSet.has(c.id) }));

  return (
    <ConsoleClient
      profile={profile}
      initialSection={initialSection}
      schools={schools ?? []}
      candidates={enriched}
      team={team ?? []}
      goals={goals ?? []}
      ai={ai}
      phases={phases ?? []}
      users={users}
      reviews={reviews}
      resources={resources ?? []}
    />
  );
}
