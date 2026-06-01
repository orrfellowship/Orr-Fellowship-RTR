import { getWorkspaceContext } from "../data";
import { canEditPlaybook } from "@/lib/types";
import { C } from "../constants";
import PlaybookPageClient from "./PlaybookPageClient";

export default async function PlaybookPage() {
  const { profile, school, playbookSchoolId, serviceDb } = await getWorkspaceContext();

  const [{ data: phases }, { data: team }] = await Promise.all([
    serviceDb.from("playbook_phases").select("id, label, title, sort_order, playbook_tasks(id, text, assignee_id, assignee_label, month_label, notes, due_date, done)").eq("school_id", playbookSchoolId).order("sort_order"),
    serviceDb.from("profiles").select("id, full_name, role").eq("school_id", profile.school_id ?? ""),
  ]);

  return (
    <PlaybookPageClient
      phases={phases ?? []}
      profile={profile}
      canEdit={canEditPlaybook(profile.role)}
      team={team ?? []}
      accent={school?.color_primary ?? C.orange}
    />
  );
}
