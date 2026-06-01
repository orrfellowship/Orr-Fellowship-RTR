import { getWorkspaceContext } from "../data";
import { createServiceClient } from "@/lib/supabase/server";
import StandingsClient from "@/components/StandingsClient";

export default async function StandingsPage() {
  const { school } = await getWorkspaceContext();
  const serviceDb = createServiceClient();

  const [{ data: allSchools }, { data: allCandidates }, { data: allGoals }] = await Promise.all([
    serviceDb.from("schools").select("id, name, tier, color_primary, logo_url").order("name"),
    serviceDb.from("candidates").select("id, name, email, school_id, stage, gpa, area_of_study, jazz_id, linkedin").order("name"),
    serviceDb.from("school_goals").select("school_id, goal_sourced, goal_contacted, goal_applied"),
  ]);

  return (
    <StandingsClient
      schools={allSchools ?? []}
      candidates={(allCandidates ?? []).map((c) => ({ id: c.id, school_id: c.school_id, stage: c.stage }))}
      goals={allGoals ?? []}
      mySchoolId={school?.id ?? null}
    />
  );
}
