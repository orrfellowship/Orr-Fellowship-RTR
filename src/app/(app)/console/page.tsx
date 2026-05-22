import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSuper } from "@/lib/types";
import ConsoleClient from "./ConsoleClient";

// Admin & Super-Admin console loader. AI data fetched ONLY for super-admins
// (RLS also enforces this — even if requested, non-supers get zero rows).
export default async function ConsolePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "fellow" || profile.role === "team_lead") redirect("/workspace");

  const supabase = createServerSupabase();

  const { data: schools } = await supabase
    .from("schools")
    .select("id, name, tier")
    .order("name");

  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, name, school_id, stage, gpa, area_of_study, point_person_id");

  const { data: goals } = await supabase
    .from("school_goals")
    .select("school_id, goal_sourced, goal_contacted, goal_applied");

  // AI signal — super-admin only.
  let ai: { candidate_id: string; resume_score: number | null }[] = [];
  if (isSuper(profile.role)) {
    const { data } = await supabase.from("candidate_ai").select("candidate_id, resume_score");
    ai = data ?? [];
  }

  return (
    <ConsoleClient
      profile={profile}
      schools={schools ?? []}
      candidates={candidates ?? []}
      goals={goals ?? []}
      ai={ai}
    />
  );
}
