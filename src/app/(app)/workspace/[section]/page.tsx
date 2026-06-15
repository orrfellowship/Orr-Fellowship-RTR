import { redirect } from "next/navigation";
import { resolveViewer, getSchoolById, displaySchool } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isAdminPlus } from "@/lib/types";
import { canAccessWorkspaceSection } from "@/lib/nav/config";
import {
  getTierSchoolIds, getSchoolsCached, getGoalsCached, getResourcesCached,
  CAND_COLS_STANDINGS, CAND_COLS_WORKSPACE,
} from "@/lib/queries";
import WorkspaceClient from "../WorkspaceClient";

// slug (URL) → internal tab key used by WorkspaceClient
const TAB: Record<string, string> = {
  snapshot: "plan", "my-school": "board", standings: "standings",
  applicants: "all", playbook: "playbook", resources: "resources", budget: "budget",
};

// Each route renders exactly ONE section, so we only fetch what that section
// reads. Everything else is passed empty — the other tabs' code never runs.
export default async function WorkspaceSection({ params }: { params: { section: string } }) {
  const { profile } = await resolveViewer();
  if (!profile) redirect("/login");
  if (isAdminPlus(profile.role)) redirect("/console/overview");
  if (!canAccessWorkspaceSection(profile.role, params.section)) redirect("/workspace/snapshot");
  const S = TAB[params.section]; // internal tab key

  const need = {
    candidates: S === "plan" || S === "board",
    phases: S === "plan" || S === "playbook",
    team: S === "plan" || S === "board" || S === "playbook" || S === "all",
    allCandidates: S === "plan" || S === "standings" || S === "all",
    allSchools: S === "standings" || S === "all",
    allGoals: S === "plan" || S === "standings",
    events: S === "plan",
    resources: S === "resources",
    allProfiles: S === "plan" || S === "board" || S === "all",
    lastContact: S === "plan",
    budget: S === "budget",
  };
  // Favorites only matter to the board (candidates) and applicants (all) views.
  const wantFavs = need.candidates || S === "all";

  const serviceDb = createServiceClient();
  const schoolId = profile.school_id ?? "";
  // Collapse satellite/bonus to their tier group with Orr branding (see displaySchool).
  const school = displaySchool(await getSchoolById(schoolId));

  // Resolve the tier's schools (satellite/bonus share one team + playbook).
  // Shared, request-deduped loader — the layout's nav card resolves the same set.
  const { ids: tierSchoolIds, tier } = await getTierSchoolIds(schoolId);
  const groupName = tier === "satellite" ? "Satellite School" : tier === "bonus" ? "Bonus School" : null;
  const playbookSchoolId = tierSchoolIds[0] ?? schoolId;

  // Standings only reads id/school_id/stage; every other view needs the full row.
  const allCandSelect = S === "standings" ? CAND_COLS_STANDINGS : CAND_COLS_WORKSPACE;

  // Parallel, section-scoped fetches. Reference tables come from the shared
  // Data Cache (getSchoolsCached / getGoalsCached / getResourcesCached).
  const [candidates, favs, team, phases, allCandidates, allProfiles, allSchools, allGoals, resources] = await Promise.all([
    need.candidates ? serviceDb.from("candidates").select("id, jazz_id, name, email, stage, gpa, area_of_study, linkedin, resume_link, point_person_id, not_interested, source, created_by").in("school_id", tierSchoolIds).order("name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    wantFavs ? serviceDb.from("favorites").select("candidate_id").eq("user_id", profile.id).then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.team ? serviceDb.from("profiles").select("id, full_name, role").in("school_id", tierSchoolIds).then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.phases ? serviceDb.from("playbook_phases").select("id, label, title, sort_order, playbook_tasks(id, text, assignee_id, assignee_label, month_label, notes, due_date, done)").eq("school_id", playbookSchoolId).order("sort_order").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.allCandidates ? serviceDb.from("candidates").select(allCandSelect).order("name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.allProfiles ? serviceDb.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.allSchools ? getSchoolsCached() : Promise.resolve([] as any[]),
    need.allGoals ? getGoalsCached() : Promise.resolve([] as any[]),
    need.resources ? getResourcesCached() : Promise.resolve([] as any[]),
  ]);

  // Playbook task enrichment (only if phases were fetched).
  const phasesWithReview = (phases ?? []) as any[];
  for (const p of phasesWithReview) for (const t of (p.playbook_tasks ?? [])) { t.assignees = []; t.completions = []; }
  const allTaskIds = phasesWithReview.flatMap((p) => (p.playbook_tasks ?? []).map((t: any) => t.id));
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

  // Last-contact map drives the action queue (snapshot only).
  const candidateIds = (candidates ?? []).map((c: any) => c.id);
  const lastContactByCand: Record<string, string> = {};
  if (need.lastContact && candidateIds.length) {
    const { data: logs } = await serviceDb.from("outreach_log").select("candidate_id, created_at").in("candidate_id", candidateIds);
    for (const l of logs ?? []) {
      const prev = lastContactByCand[(l as any).candidate_id];
      if (!prev || (l as any).created_at > prev) lastContactByCand[(l as any).candidate_id] = (l as any).created_at;
    }
  }

  // Calendar (snapshot only).
  let events: any[] = [];
  if (need.events) {
    const eventSchoolIds = tierSchoolIds.filter(Boolean);
    const orFilter = `school_id.is.null${eventSchoolIds.length ? `,school_id.in.(${eventSchoolIds.join(",")})` : ""}`;
    const { data: eventRows } = await serviceDb.from("events").select("id, title, description, address, event_date, event_type, school_id, created_by").or(orFilter).order("event_date");
    const eventIds = (eventRows ?? []).map((e: any) => e.id);
    const rsvpByEvent: Record<string, { going: string[]; not_going: string[] }> = {};
    const myRsvp: Record<string, string> = {};
    const notesByEvent: Record<string, any[]> = {};
    if (eventIds.length) {
      const { data: rsvps } = await serviceDb.from("event_rsvps").select("event_id, profile_id, status").in("event_id", eventIds);
      for (const r of rsvps ?? []) {
        const e = (r as any).event_id;
        (rsvpByEvent[e] ??= { going: [], not_going: [] });
        if ((r as any).status === "going") rsvpByEvent[e].going.push((r as any).profile_id);
        else rsvpByEvent[e].not_going.push((r as any).profile_id);
        if ((r as any).profile_id === profile.id) myRsvp[e] = (r as any).status;
      }
      // Only notes targeted at this lead's school(s) — admin notes aren't org-wide.
      if (eventSchoolIds.length) {
        const { data: noteRows } = await serviceDb.from("event_notes").select("id, event_id, school_id, body, created_by").in("event_id", eventIds).in("school_id", eventSchoolIds);
        for (const n of noteRows ?? []) (notesByEvent[(n as any).event_id] ??= []).push(n);
      }
    }
    events = (eventRows ?? []).map((e: any) => ({ ...e, going: rsvpByEvent[e.id]?.going ?? [], not_going: rsvpByEvent[e.id]?.not_going ?? [], my_status: (myRsvp[e.id] as "going" | "not_going" | undefined) ?? null, notes: notesByEvent[e.id] ?? [] }));
  }

  // Budget (team-lead only): their tier's entries + the org allocation guidance.
  let budgetEntries: any[] = [];
  let budgetGuidance: any[] = [];
  if (need.budget) {
    const [{ data: be }, { data: bg }] = await Promise.all([
      serviceDb.from("budget_entries").select("id, school_id, kind, label, amount, notes, receipt_url, created_by").in("school_id", tierSchoolIds).order("created_at", { ascending: false }),
      serviceDb.from("budget_guidance").select("id, category, pct").order("sort_order"),
    ]);
    budgetEntries = be ?? [];
    budgetGuidance = bg ?? [];
  }

  const favSet = new Set((favs ?? []).map((f: any) => f.candidate_id));
  const enriched = (candidates ?? []).map((c: any) => ({ ...c, is_favorite: favSet.has(c.id) }));
  const allEnriched = (allCandidates ?? []).map((c: any) => ({ ...c, is_favorite: favSet.has(c.id) }));

  return (
    <WorkspaceClient
      profile={profile}
      initialSection={S}
      school={school ? { id: school.id, name: school.name, color_primary: school.color_primary, logo_url: school.logo_url } : null}
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
      budgetEntries={budgetEntries}
      budgetSchoolId={playbookSchoolId}
      budgetGuidance={budgetGuidance}
    />
  );
}
