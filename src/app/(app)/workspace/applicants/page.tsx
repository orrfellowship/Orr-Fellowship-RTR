import { getWorkspaceContext } from "../data";
import { createServiceClient } from "@/lib/supabase/server";
import ApplicantsClient from "./ApplicantsClient";

export default async function ApplicantsPage() {
  await getWorkspaceContext(); // auth + role check
  const serviceDb = createServiceClient();

  const [{ data: allSchools }, { data: allCandidates }] = await Promise.all([
    serviceDb.from("schools").select("id, name, tier, color_primary, logo_url").order("name"),
    serviceDb.from("candidates").select("id, name, email, school_id, stage, gpa, area_of_study, jazz_id, linkedin").order("name"),
  ]);

  return <ApplicantsClient schools={allSchools ?? []} candidates={allCandidates ?? []} />;
}
