import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSuper } from "@/lib/types";
import ConsoleClient from "./ConsoleClient";

export default async function ConsolePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "fellow" || profile.role === "team_lead") redirect("/workspace");

  const supabase = createServerSupabase();

  const { data: schools } = await supabase
    .from("schools")
    .select("id, name, tier, color_primary, logo_url")
    .order("name");

  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, jazz_id, name, email, school_id, stage, gpa, area_of_study, university_raw, linkedin, resume_link, point_person_id, not_interested, grad_date")
    .order("name");

  const { data: favs } = await supabase
    .from("favorites")
    .select("candidate_id")
    .eq("user_id", profile.id);

  const { data: team } = await supabase
    .from("profiles")
    .select("id, full_name")
    .order("full_name");

  const { data: goals } = await supabase
    .from("school_goals")
    .select("school_id, goal_sourced, goal_contacted, goal_applied");

  const { data: phases } = await supabase
    .from("playbook_phases")
    .select("id, label, title, sort_order, school_id, playbook_tasks(id, text, assignee_id, due_date, done)")
    .order("sort_order");

  let ai: { candidate_id: string; resume_score: number | null; summary: string | null; flags: any; analyzed_at: string | null }[] = [];
  if (isSuper(profile.role)) {
    const { data } = await supabase.from("candidate_ai").select("candidate_id, resume_score, summary, flags, analyzed_at");
    ai = data ?? [];
  }

  const favSet = new Set((favs ?? []).map((f) => f.candidate_id));
  const enriched = (candidates ?? []).map((c) => ({ ...c, is_favorite: favSet.has(c.id) }));

  return (
    <ConsoleClient
      profile={profile}
      schools={schools ?? []}
      candidates={enriched}
      team={team ?? []}
      goals={goals ?? []}
      ai={ai}
      phases={phases ?? []}
    />
  );
}
