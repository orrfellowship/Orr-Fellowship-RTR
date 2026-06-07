import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import WorkspaceClient from "./WorkspaceClient";

// Loads everything the fellow/lead workspace needs, server-side, then hands
// it to the interactive client view. RLS is in force on every query here.
export default async function WorkspacePage() {
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

  // Satellite/bonus schools are ONE team — fetch all schools in the same tier.
  const tier = (school as any)?.tier ?? null;
  const isTierGroup = tier === "satellite" || tier === "bonus";
  let tierSchoolIds: string[] = [schoolId];
  let groupName: string | null = null;
  // The group shares ONE playbook, held by the representative school (first by
  // name in the tier). Individual schools in the group don't get their own.
  let playbookSchoolId = schoolId;

  if (isTierGroup) {
    const { data: tierSchools } = await serviceDb
      .from("schools")
      .select("id, name")
      .eq("tier", tier)
      .order("name");
    tierSchoolIds = (tierSchools ?? []).map((s: any) => s.id);
    playbookSchoolId = (tierSchools ?? [])[0]?.id ?? schoolId;
    groupName = tier === "satellite" ? "Satellite School" : "Bonus School";
  }

  // Fetch candidates, team, and phases scoped to the full tier (or just the school).
  const [
    { data: candidates },
    { data: favs },
    { data: team },
    { data: phases },
  ] = await Promise.all([
    serviceDb
      .from("candidates")
      .select("id, jazz_id, name, email, stage, gpa, area_of_study, linkedin, resume_link, point_person_id, not_interested")
      .in("school_id", tierSchoolIds)
      .order("name"),
    supabase
      .from("favorites")
      .select("candidate_id")
      .eq("user_id", profile.id),
    serviceDb
      .from("profiles")
      .select("id, full_name, role")
      .in("school_id", tierSchoolIds),
    serviceDb
      .from("playbook_phases")
      .select("id, label, title, sort_order, playbook_tasks(id, text, assignee_id, assignee_label, month_label, notes, due_date, done)")
      .eq("school_id", playbookSchoolId)
      .order("sort_order"),
  ]);

  // pending_review is fetched separately so a missing column (pre-migration)
  // degrades gracefully instead of breaking the whole phases query.
  const phasesWithReview = (phases ?? []) as any[];
  const allTaskIds = phasesWithReview.flatMap((p) => (p.playbook_tasks ?? []).map((t: any) => t.id));
  // Default the multi-assignee fields so the client can rely on them.
  for (const p of phasesWithReview) for (const t of (p.playbook_tasks ?? [])) { t.assignees = []; t.completions = []; }
  if (allTaskIds.length) {
    const { data: prRows } = await serviceDb.from("playbook_tasks").select("id, pending_review").in("id", allTaskIds);
    if (prRows) {
      const pr = new Map(prRows.map((r: any) => [r.id, r.pending_review]));
      for (const p of phasesWithReview) for (const t of (p.playbook_tasks ?? [])) t.pending_review = pr.get(t.id) ?? false;
    }
    // Multi-assignee + per-assignee completion (tables may not exist pre-migration → ignore errors).
    const [{ data: aRows }, { data: cRows }] = await Promise.all([
      serviceDb.from("playbook_task_assignees").select("task_id, profile_id").in("task_id", allTaskIds),
      serviceDb.from("playbook_task_completions").select("task_id, profile_id, state").in("task_id", allTaskIds),
    ]);
    const byTaskA = new Map<string, string[]>();
    for (const r of aRows ?? []) { const k = (r as any).task_id; (byTaskA.get(k) ?? byTaskA.set(k, []).get(k)!).push((r as any).profile_id); }
    const byTaskC = new Map<string, { profile_id: string; state: string }[]>();
    for (const r of cRows ?? []) { const k = (r as any).task_id; (byTaskC.get(k) ?? byTaskC.set(k, []).get(k)!).push({ profile_id: (r as any).profile_id, state: (r as any).state }); }
    for (const p of phasesWithReview) for (const t of (p.playbook_tasks ?? [])) {
      t.assignees = byTaskA.get(t.id) ?? [];
      t.completions = byTaskC.get(t.id) ?? [];
    }
  }

  // Last outreach timestamp per candidate (drives the Action Queue follow-up nudges).
  const candidateIds = (candidates ?? []).map((c) => c.id);
  const lastContactByCand: Record<string, string> = {};
  if (candidateIds.length) {
    const { data: logs } = await serviceDb
      .from("outreach_log")
      .select("candidate_id, created_at")
      .in("candidate_id", candidateIds);
    for (const l of logs ?? []) {
      const prev = lastContactByCand[(l as any).candidate_id];
      if (!prev || (l as any).created_at > prev) lastContactByCand[(l as any).candidate_id] = (l as any).created_at;
    }
  }

  // Cross-school data for Standings — serviceDb bypasses RLS so fellows/leads can see org-wide pipeline
  const [{ data: allSchools }, { data: allCandidates }, { data: allGoals }, { data: resources }] = await Promise.all([
    serviceDb.from("schools").select("id, name, tier, color_primary, logo_url").order("name"),
    serviceDb.from("candidates").select("id, name, email, school_id, stage, gpa, area_of_study, jazz_id, linkedin, point_person_id, not_interested, resume_link").order("name"),
    serviceDb.from("school_goals").select("school_id, goal_sourced, goal_contacted, goal_applied"),
    serviceDb.from("resources").select("id, name, description, link, created_by, created_at").order("created_at", { ascending: false }),
  ]);

  const favSet = new Set((favs ?? []).map((f) => f.candidate_id));
  const enriched = (candidates ?? []).map((c) => ({ ...c, is_favorite: favSet.has(c.id) }));
  const allEnriched = (allCandidates ?? []).map((c) => ({ ...c, is_favorite: favSet.has(c.id) }));

  return (
    <WorkspaceClient
      profile={profile}
      school={school ? { id: school.id, name: school.name, color_primary: (school as any).color_primary, logo_url: (school as any).logo_url } : null}
      candidates={enriched}
      team={team ?? []}
      phases={phasesWithReview}
      allSchools={allSchools ?? []}
      allCandidates={allEnriched}
      allGoals={allGoals ?? []}
      groupName={groupName}
      lastContactByCand={lastContactByCand}
      resources={resources ?? []}
    />
  );
}
