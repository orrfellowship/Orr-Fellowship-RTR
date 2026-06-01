import { getWorkspaceContext } from "../data";
import { canEditPlaybook } from "@/lib/types";
import PlanClient from "./PlanClient";

export default async function PlanPage() {
  const { profile, school, tierSchoolIds, playbookSchoolId, serviceDb } = await getWorkspaceContext();

  const [{ data: candidates }, { data: favs }, { data: team }, { data: phases }, { data: allGoals }] = await Promise.all([
    serviceDb.from("candidates").select("id, jazz_id, name, email, stage, gpa, area_of_study, linkedin, resume_link, point_person_id, not_interested, school_id").in("school_id", tierSchoolIds).order("name"),
    serviceDb.from("favorites").select("candidate_id").eq("user_id", profile.id),
    serviceDb.from("profiles").select("id, full_name, role").in("school_id", tierSchoolIds),
    serviceDb.from("playbook_phases").select("id, label, title, sort_order, playbook_tasks(id, text, assignee_id, assignee_label, month_label, notes, due_date, done)").eq("school_id", playbookSchoolId).order("sort_order"),
    serviceDb.from("school_goals").select("school_id, goal_sourced, goal_contacted, goal_applied"),
  ]);

  const favSet = new Set((favs ?? []).map((f) => f.candidate_id));
  const enriched = (candidates ?? []).map((c) => ({ ...c, is_favorite: favSet.has(c.id) }));
  const schoolGoal = (allGoals ?? []).find((g) => g.school_id === school?.id) ?? null;

  return (
    <PlanClient
      profile={profile}
      candidates={enriched}
      team={team ?? []}
      phases={phases ?? []}
      schoolGoal={schoolGoal}
      accent={school?.color_primary ?? "#DD5434"}
      canEdit={canEditPlaybook(profile.role)}
    />
  );
}
