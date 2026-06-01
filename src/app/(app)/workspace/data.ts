import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import type { School } from "./types";

export const getWorkspaceContext = cache(async () => {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "admin" || profile.role === "super_admin") redirect("/console");

  const supabase = createServerSupabase();
  const serviceDb = createServiceClient();
  const schoolId = profile.school_id ?? "";

  const { data: school } = await supabase
    .from("schools")
    .select("id, name, tier, color_primary, logo_url")
    .eq("id", schoolId)
    .maybeSingle();

  const tier = (school as any)?.tier ?? null;
  const isTierGroup = tier === "satellite" || tier === "bonus";
  let tierSchoolIds: string[] = [schoolId];
  let groupName: string | null = null;
  let playbookSchoolId = schoolId;

  if (isTierGroup) {
    const { data: tierSchools } = await serviceDb
      .from("schools")
      .select("id, name")
      .eq("tier", tier)
      .order("name");
    tierSchoolIds = (tierSchools ?? []).map((s: any) => s.id);
    playbookSchoolId = (tierSchools ?? [])[0]?.id ?? schoolId;
    groupName = tier === "satellite" ? "Satellite Group" : "Bonus Group";
  }

  const schoolForClient: School | null = school
    ? { id: school.id, name: school.name, color_primary: (school as any).color_primary, logo_url: (school as any).logo_url }
    : null;

  return { profile, school: schoolForClient, tierSchoolIds, playbookSchoolId, groupName, serviceDb, supabase };
});
