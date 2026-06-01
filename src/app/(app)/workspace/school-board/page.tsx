import { getWorkspaceContext } from "../data";
import BoardClient from "./BoardClient";

export default async function BoardPage() {
  const { profile, school, tierSchoolIds, serviceDb } = await getWorkspaceContext();

  const [{ data: candidates }, { data: favs }, { data: team }, { data: schools }] = await Promise.all([
    serviceDb.from("candidates").select("id, jazz_id, name, email, stage, gpa, area_of_study, linkedin, resume_link, point_person_id, not_interested, school_id").in("school_id", tierSchoolIds).order("name"),
    serviceDb.from("favorites").select("candidate_id").eq("user_id", profile.id),
    serviceDb.from("profiles").select("id, full_name, role").in("school_id", tierSchoolIds),
    serviceDb.from("schools").select("id, name, color_primary").in("id", tierSchoolIds),
  ]);

  const favSet = new Set((favs ?? []).map((f) => f.candidate_id));
  const enriched = (candidates ?? []).map((c) => ({ ...c, is_favorite: favSet.has(c.id) }));

  return (
    <BoardClient
      profile={profile}
      candidates={enriched}
      team={team ?? []}
      schools={schools ?? []}
      accent={school?.color_primary ?? "#DD5434"}
    />
  );
}
