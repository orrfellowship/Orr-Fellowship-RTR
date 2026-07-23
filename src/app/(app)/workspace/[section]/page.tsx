import { Suspense } from "react";
import { redirect } from "next/navigation";
import { resolveViewer, getSchoolById, displaySchool } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isAdminPlus, type Profile } from "@/lib/types";
import { canAccessWorkspaceSection } from "@/lib/nav/config";
import {
  getTierSchoolIds, getSchoolsCached, getGoalsCached, getResourcesCached, fetchAllRows,
  getCandidateStageCounts, collapseStageCounts,
} from "@/lib/queries";
import WorkspaceClient from "../WorkspaceClient";
import { listCandidates } from "../../console/actions";
import SectionSkeleton from "@/components/nav/SectionSkeleton";
import EmailCampaignsClient from "@/components/EmailCampaignsClient";
import { getGmailConnectionStatusForUser } from "@/lib/gmail/server";
import type { GmailConnectionStatus } from "@/lib/gmail/types";
import { loadOutreachAudiences, loadRecentCampaigns } from "@/lib/gmail/candidate-outreach.server";
import { listOutreachTemplates } from "@/lib/gmail/outreach-templates.server";

// slug (URL) → internal tab key used by WorkspaceClient
const TAB: Record<string, string> = {
  snapshot: "plan", "my-school": "board", standings: "standings",
  applicants: "all", playbook: "playbook", resources: "resources", budget: "budget",
};

export default async function WorkspaceSection({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ gmail?: string; gmail_error?: string }> }) {
  const { section } = await params;
  const gmailQuery = await searchParams;
  const { profile } = await resolveViewer();
  if (!profile) redirect("/login");
  if (isAdminPlus(profile.role)) redirect("/console/overview");
  if (!canAccessWorkspaceSection(profile.role, section)) redirect("/workspace/snapshot");

  return (
    <Suspense fallback={<SectionSkeleton />}>
      <WorkspaceSectionData section={section} profile={profile} gmailQuery={gmailQuery} />
    </Suspense>
  );
}

// Each route renders exactly ONE section, so we only fetch what that section
// reads. Everything else is passed empty — the other tabs' code never runs.
async function WorkspaceSectionData({ section, profile, gmailQuery }: { section: string; profile: Profile; gmailQuery: { gmail?: string; gmail_error?: string } }) {
  // Live outreach composer — fellows/leads email their own assigned candidates.
  if (section === "email-campaigns") {
    let gmailConnection: GmailConnectionStatus = { connected: false, connectedEmail: null, connectedAt: null };
    try { gmailConnection = await getGmailConnectionStatusForUser(profile.id); } catch { /* show disconnected */ }
    const [audiences, recentCampaigns, templates] = await Promise.all([
      loadOutreachAudiences(profile), loadRecentCampaigns(profile), listOutreachTemplates(),
    ]);
    // Fellows/leads are template-locked (canFreeCompose stays false) — they pick
    // from admin templates; the send route enforces the same rule server-side.
    return <EmailCampaignsClient gmailConnection={gmailConnection} gmailNotice={{ result: gmailQuery.gmail, error: gmailQuery.gmail_error }} gmailCampaignSendEnabled audiences={audiences} recentCampaigns={recentCampaigns}
      templates={templates.map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body, attachments: t.attachments.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes })) }))} />;
  }

  const S = TAB[section]; // internal tab key

  const need = {
    candidates: S === "plan" || S === "board",
    phases: S === "plan" || S === "playbook",
    team: S === "plan" || S === "board" || S === "playbook" || S === "all",
    // Org-wide standings + the snapshot's counters read grouped stage counts;
    // the Candidates tab (S === "all") is server-paginated.
    allCandidates: S === "all",
    stageCounts: S === "plan" || S === "standings",
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

  // The Candidates tab (S === "all") is server-paginated; it doesn't load every row.
  const paginatedList = S === "all";

  // Parallel, section-scoped fetches. Reference tables come from the shared
  // Data Cache (getSchoolsCached / getGoalsCached / getResourcesCached).
  const [candidates, favs, team, phases, stageCountRows, allProfiles, allSchools, allGoals, resources] = await Promise.all([
    need.candidates ? fetchAllRows((from, to) => serviceDb.from("candidates").select("id, jazz_id, name, email, school_id, university_raw, stage, gpa, area_of_study, linkedin, resume_link, point_person_id, not_interested, direct_placement, source, created_by").in("school_id", tierSchoolIds).order("name").range(from, to)) : Promise.resolve([] as any[]),
    wantFavs ? serviceDb.from("favorites").select("candidate_id").eq("user_id", profile.id).then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.team ? serviceDb.from("profiles").select("id, full_name, email, role").in("school_id", tierSchoolIds).eq("is_active", true).order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    // Tier-wide phase read: the tier's playbook stays visible no matter which
    // of the group's school rows it was created under (the "representative"
    // row can shift as schools are added).
    need.phases ? serviceDb.from("playbook_phases").select("id, label, title, sort_order, playbook_tasks(id, text, assignee_id, assignee_label, month_label, notes, due_date, done)").in("school_id", tierSchoolIds.length ? tierSchoolIds : [playbookSchoolId]).order("sort_order").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.stageCounts ? getCandidateStageCounts() : Promise.resolve([]),
    need.allProfiles ? serviceDb.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
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
    const logs = await fetchAllRows((from, to) => serviceDb.from("outreach_log").select("candidate_id, created_at").in("candidate_id", candidateIds).range(from, to));
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
      serviceDb.from("budget_guidance").select("id, school_id, category, pct").order("sort_order"),
    ]);
    budgetEntries = be ?? [];
    budgetGuidance = bg ?? [];
  }

  // Candidates tab: first page + count. Full-set facets/slim data hydrate on
  // the client after paint so the route does not block TTFB on every candidate.
  const PAGE_SIZE = 50;
  const allPage = paginatedList
    ? await listCandidates({ variant: "workspace", page: 0, pageSize: PAGE_SIZE, mineOnly: true, sortKey: "name", sortDir: "asc" })
    : { rows: [] as any[], total: 0, ai: [] as any[] };
  const allFacets = { majors: [] as string[], stages: [] as string[], unroutedCount: 0, slim: [] as any[] };

  const favSet = new Set((favs ?? []).map((f: any) => f.candidate_id));
  const enriched = (candidates ?? []).map((c: any) => ({ ...c, is_favorite: favSet.has(c.id) }));
  const allEnriched = paginatedList ? allPage.rows : [];

  return (
    <WorkspaceClient
      profile={profile}
      initialSection={S}
      school={school ? { id: school.id, name: school.name, color_primary: school.color_primary, logo_url: school.logo_url } : null}
      candidates={enriched}
      stageCounts={collapseStageCounts(stageCountRows)}
      team={team ?? []}
      phases={phasesWithReview}
      allSchools={allSchools ?? []}
      allCandidates={allEnriched}
      allCandidatesTotal={paginatedList ? allPage.total : undefined}
      candidatesPageSize={PAGE_SIZE}
      facetMajors={allFacets.majors}
      facetStages={allFacets.stages}
      slimCandidates={allFacets.slim}
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
