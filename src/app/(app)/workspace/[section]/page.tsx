import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { isAdminPlus } from "@/lib/types";
import { canAccessWorkspaceSection } from "@/lib/nav/config";
import WorkspaceClient from "../WorkspaceClient";

// slug (URL) → internal tab key used by WorkspaceClient
const TAB: Record<string, string> = {
  snapshot: "plan", "my-school": "board", standings: "standings",
  applicants: "all", playbook: "playbook", resources: "resources",
};

export default async function WorkspaceSection({ params }: { params: { section: string } }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (isAdminPlus(profile.role)) redirect("/console/overview");
  // Unknown / disallowed section → home.
  if (!canAccessWorkspaceSection(profile.role, params.section)) redirect("/workspace/snapshot");
  const initialSection = TAB[params.section];

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
    const { data: tierSchools } = await serviceDb.from("schools").select("id, name").eq("tier", tier).order("name");
    tierSchoolIds = (tierSchools ?? []).map((s: any) => s.id);
    playbookSchoolId = (tierSchools ?? [])[0]?.id ?? schoolId;
    groupName = tier === "satellite" ? "Satellite School" : "Bonus School";
  }

  const [{ data: candidates }, { data: favs }, { data: team }, { data: phases }] = await Promise.all([
    serviceDb.from("candidates").select("id, jazz_id, name, email, stage, gpa, area_of_study, linkedin, resume_link, point_person_id, not_interested").in("school_id", tierSchoolIds).order("name"),
    supabase.from("favorites").select("candidate_id").eq("user_id", profile.id),
    serviceDb.from("profiles").select("id, full_name, role").in("school_id", tierSchoolIds),
    serviceDb.from("playbook_phases").select("id, label, title, sort_order, playbook_tasks(id, text, assignee_id, assignee_label, month_label, notes, due_date, done)").eq("school_id", playbookSchoolId).order("sort_order"),
  ]);

  const phasesWithReview = (phases ?? []) as any[];
  const allTaskIds = phasesWithReview.flatMap((p) => (p.playbook_tasks ?? []).map((t: any) => t.id));
  for (const p of phasesWithReview) for (const t of (p.playbook_tasks ?? [])) { t.assignees = []; t.completions = []; }
  if (allTaskIds.length) {
    const { data: prRows } = await serviceDb.from("playbook_tasks").select("id, pending_review").in("id", allTaskIds);
    if (prRows) {
      const pr = new Map(prRows.map((r: any) => [r.id, r.pending_review]));
      for (const p of phasesWithReview) for (const t of (p.playbook_tasks ?? [])) t.pending_review = pr.get(t.id) ?? false;
    }
    const [{ data: aRows }, { data: cRows }] = await Promise.all([
      serviceDb.from("playbook_task_assignees").select("task_id, profile_id").in("task_id", allTaskIds),
      serviceDb.from("playbook_task_completions").select("task_id, profile_id, state, updated_at").in("task_id", allTaskIds),
    ]);
    const byTaskA = new Map<string, string[]>();
    for (const r of aRows ?? []) { const k = (r as any).task_id; (byTaskA.get(k) ?? byTaskA.set(k, []).get(k)!).push((r as any).profile_id); }
    const byTaskC = new Map<string, { profile_id: string; state: string; updated_at: string }[]>();
    for (const r of cRows ?? []) { const k = (r as any).task_id; (byTaskC.get(k) ?? byTaskC.set(k, []).get(k)!).push({ profile_id: (r as any).profile_id, state: (r as any).state, updated_at: (r as any).updated_at }); }
    for (const p of phasesWithReview) for (const t of (p.playbook_tasks ?? [])) { t.assignees = byTaskA.get(t.id) ?? []; t.completions = byTaskC.get(t.id) ?? []; }
  }

  const candidateIds = (candidates ?? []).map((c) => c.id);
  const lastContactByCand: Record<string, string> = {};
  if (candidateIds.length) {
    const { data: logs } = await serviceDb.from("outreach_log").select("candidate_id, created_at").in("candidate_id", candidateIds);
    for (const l of logs ?? []) {
      const prev = lastContactByCand[(l as any).candidate_id];
      if (!prev || (l as any).created_at > prev) lastContactByCand[(l as any).candidate_id] = (l as any).created_at;
    }
  }

  const [{ data: allSchools }, { data: allCandidates }, { data: allGoals }, { data: resources }, { data: allProfiles }] = await Promise.all([
    serviceDb.from("schools").select("id, name, tier, color_primary, logo_url").order("name"),
    serviceDb.from("candidates").select("id, name, email, school_id, stage, gpa, area_of_study, jazz_id, linkedin, point_person_id, not_interested, resume_link").order("name"),
    serviceDb.from("school_goals").select("school_id, goal_sourced, goal_contacted, goal_applied"),
    serviceDb.from("resources").select("id, name, description, link, created_by, created_at").order("created_at", { ascending: false }),
    serviceDb.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const eventSchoolIds = tierSchoolIds.filter(Boolean);
  const orFilter = `school_id.is.null${eventSchoolIds.length ? `,school_id.in.(${eventSchoolIds.join(",")})` : ""}`;
  const { data: eventRows } = await serviceDb.from("events").select("id, title, description, event_date, event_type, school_id, created_by").or(orFilter).order("event_date");
  const eventIds = (eventRows ?? []).map((e: any) => e.id);
  const rsvpByEvent: Record<string, { going: string[]; not_going: string[] }> = {};
  const myRsvp: Record<string, string> = {};
  if (eventIds.length) {
    const { data: rsvps } = await serviceDb.from("event_rsvps").select("event_id, profile_id, status").in("event_id", eventIds);
    for (const r of rsvps ?? []) {
      const e = (r as any).event_id;
      (rsvpByEvent[e] ??= { going: [], not_going: [] });
      if ((r as any).status === "going") rsvpByEvent[e].going.push((r as any).profile_id);
      else rsvpByEvent[e].not_going.push((r as any).profile_id);
      if ((r as any).profile_id === profile.id) myRsvp[e] = (r as any).status;
    }
  }
  const events = (eventRows ?? []).map((e: any) => ({
    ...e, going: rsvpByEvent[e.id]?.going ?? [], not_going: rsvpByEvent[e.id]?.not_going ?? [],
    my_status: (myRsvp[e.id] as "going" | "not_going" | undefined) ?? null,
  }));

  const favSet = new Set((favs ?? []).map((f) => f.candidate_id));
  const enriched = (candidates ?? []).map((c) => ({ ...c, is_favorite: favSet.has(c.id) }));
  const allEnriched = (allCandidates ?? []).map((c) => ({ ...c, is_favorite: favSet.has(c.id) }));

  return (
    <WorkspaceClient
      profile={profile}
      initialSection={initialSection}
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
      events={events}
      allProfiles={allProfiles ?? []}
    />
  );
}
