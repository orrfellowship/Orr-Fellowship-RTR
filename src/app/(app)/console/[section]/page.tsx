import { Suspense } from "react";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/auth";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { isAdminPlus, isSuper, type Profile } from "@/lib/types";
import { canAccessConsoleSection } from "@/lib/nav/config";
import {
  getSchoolsCached, getGoalsCached, getResourcesCached, fetchAllRows,
  CAND_COLS_STANDINGS, CAND_COLS_PIPELINE, CAND_COLS_CONSOLE,
} from "@/lib/queries";
import ConsoleClient from "../ConsoleClient";
import AdminSnapshotClient from "../AdminSnapshotClient";
import { isActive } from "@/lib/stages";
import { listCandidates } from "../actions";
import { candidateSchoolDisplay, findMisrouted } from "@/lib/candidateSchool";
import { findDuplicateGroups } from "@/lib/duplicates";
import SectionSkeleton from "@/components/nav/SectionSkeleton";
import EmailCampaignsClient from "@/components/EmailCampaignsClient";
import { getGmailConnectionStatusForUser } from "@/lib/gmail/server";
import type { GmailConnectionStatus } from "@/lib/gmail/types";
import { loadOutreachAudiences, loadRecentCampaigns } from "@/lib/gmail/candidate-outreach.server";

export default async function ConsoleSection({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ gmail?: string; gmail_error?: string }>;
}) {
  const { section } = await params;
  const query = await searchParams;
  const { profile, real } = await resolveViewer();
  if (!profile) redirect("/login");
  if (!isAdminPlus(profile.role)) redirect("/workspace/snapshot");
  if (!canAccessConsoleSection(profile.role, section)) redirect("/console/overview");

  return (
    <Suspense fallback={<SectionSkeleton />}>
      <ConsoleSectionData section={section} profile={profile} authenticatedUserId={(real ?? profile).id} gmailQuery={query} />
    </Suspense>
  );
}

// Each route renders one section → only fetch what that section reads. Keeping
// the expensive work below Suspense lets the authenticated shell paint first.
async function ConsoleSectionData({
  section,
  profile,
  authenticatedUserId,
  gmailQuery,
}: {
  section: string;
  profile: Profile;
  authenticatedUserId: string;
  gmailQuery: { gmail?: string; gmail_error?: string };
}) {
  const S = section;

  // Live outreach composer. Loads the viewer's audiences (all candidates + team
  // for admins) and their Gmail connection summary; no credential fields cross
  // this boundary.
  if (S === "email-campaigns") {
    let gmailConnection: GmailConnectionStatus = { connected: false, connectedEmail: null, connectedAt: null };
    let statusUnavailable = false;
    try {
      gmailConnection = await getGmailConnectionStatusForUser(authenticatedUserId);
    } catch {
      statusUnavailable = true;
    }
    const [audiences, recentCampaigns] = await Promise.all([loadOutreachAudiences(profile), loadRecentCampaigns(profile)]);
    return <EmailCampaignsClient
      gmailConnection={gmailConnection}
      gmailNotice={{
        result: gmailQuery.gmail,
        error: gmailQuery.gmail_error ?? (statusUnavailable ? "status_unavailable" : undefined),
      }}
      gmailCampaignSendEnabled
      audiences={audiences}
      recentCampaigns={recentCampaigns}
    />;
  }

  // Admin Weekly Snapshot: categorized tasks (open help requests + candidates
  // missing a LinkedIn). Fetched on its own — it doesn't need the big section load.
  if (S === "snapshot") {
    const db = createServiceClient();
    const sup = isSuper(profile.role);
    const [helpRes, candRows, schools] = await Promise.all([
      db.from("notifications")
        .select("id, title, body, dedupe_key, created_at")
        .eq("recipient_id", profile.id).eq("type", "help_request").eq("superseded", false)
        .order("created_at", { ascending: false }),
      fetchAllRows<{ id: string; name: string; email: string | null; school_id: string | null; university_raw: string | null; area_of_study: string | null; gpa: string | null; linkedin: string | null; stage: string | null; not_interested: boolean; direct_placement: boolean; direct_placement_by: string | null; direct_placement_at: string | null }>(
        (from, to) => db.from("candidates")
          .select("id, name, email, school_id, university_raw, area_of_study, gpa, linkedin, stage, not_interested, direct_placement, direct_placement_by, direct_placement_at")
          .eq("not_interested", false)
          .order("name")
          .range(from, to),
      ),
      getSchoolsCached(),
    ]);
    const missingLinkedin = (candRows ?? [])
      .filter((c) => isActive(c.stage) && !c.not_interested && (!c.linkedin || c.linkedin.trim() === ""))
      .map((c) => ({ id: c.id, name: c.name, email: c.email, school: candidateSchoolDisplay(c, schools ?? []).label, area_of_study: c.area_of_study, gpa: c.gpa }));
    const helpRequests = (helpRes.data ?? []).map((h: any) => ({ id: h.id, title: h.title, body: h.body, dedupeKey: h.dedupe_key, created_at: h.created_at }));

    // Direct Placement Potential queue — Super Admin only (team-lead flagged).
    let directPlacement: { id: string; name: string; email: string | null; school: string | null; area_of_study: string | null; gpa: string | null; flaggedBy: string; flaggedAt: string | null }[] = [];
    if (sup) {
      const flagged = (candRows ?? []).filter((c) => c.direct_placement && isActive(c.stage) && !c.not_interested);
      const byIds = Array.from(new Set(flagged.map((c) => c.direct_placement_by).filter((v): v is string => !!v)));
      const nameById = new Map<string, string>();
      if (byIds.length) {
        const { data: profs } = await db.from("profiles").select("id, full_name").in("id", byIds);
        for (const p of profs ?? []) nameById.set((p as any).id, (p as any).full_name);
      }
      directPlacement = flagged
        .map((c) => ({
          id: c.id, name: c.name, email: c.email,
          school: candidateSchoolDisplay(c, schools ?? []).label,
          area_of_study: c.area_of_study, gpa: c.gpa,
          flaggedBy: (c.direct_placement_by && nameById.get(c.direct_placement_by)) || "A team lead",
          flaggedAt: c.direct_placement_at,
        }))
        .sort((a, b) => (b.flaggedAt ?? "").localeCompare(a.flaggedAt ?? ""));
    }

    // Data-quality tasks: possible duplicate records and candidates filed
    // somewhere other than where their imported school text routes. Both link
    // to the review panels on the Candidates tab.
    const dupRows = (candRows ?? []).map((c) => ({ id: c.id, name: c.name, email: c.email, school_id: c.school_id, university_raw: c.university_raw, stage: c.stage, source: null }));
    const duplicateGroups = findDuplicateGroups(dupRows).length;
    const misrouted = findMisrouted(candRows ?? [], schools ?? []).length;

    return <AdminSnapshotClient helpRequests={helpRequests} missingLinkedin={missingLinkedin} directPlacement={directPlacement} duplicateGroups={duplicateGroups} misrouted={misrouted} isSuper={sup} />;
  }

  const need = {
    candidates: ["overview", "applicants", "standings", "schools", "sync", "review"].includes(S),
    goals: ["overview", "standings", "schools"].includes(S),
    team: ["applicants", "playbook"].includes(S),
    phases: S === "playbook",
    resources: S === "resources",
    reviews: ["applicants", "sync", "review"].includes(S),
    users: S === "users" || S === "schools", // schools tab needs profiles for per-school teammate counts
    favs: S === "applicants",
    calendar: S === "calendar",
    budget: S === "budget",
  };

  const supabase = await createServerSupabase();
  const serviceDb = createServiceClient();

  const candSelect = S === "standings"
    ? CAND_COLS_STANDINGS
    : (S === "overview" || S === "schools") ? CAND_COLS_PIPELINE : CAND_COLS_CONSOLE;
  // The Candidates tab is server-paginated; it doesn't load the full
  // table. Other sections (overview/standings/schools/sync/review) still need it.
  const paginatedList = S === "applicants";

  // Reference tables (schools/goals/resources) come from the shared Data Cache.
  const [schools, candidates, favs, team, goals, phases, resources, reviewData, usersData, people, budgetEntries, budgetGuidance] = await Promise.all([
    getSchoolsCached(),
    need.candidates && !paginatedList ? fetchAllRows((from, to) => supabase.from("candidates").select(candSelect).order("name").range(from, to)) : Promise.resolve([] as any[]),
    need.favs ? supabase.from("favorites").select("candidate_id").eq("user_id", profile.id).then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.team ? supabase.from("profiles").select("id, full_name, school_id, role").order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.goals ? getGoalsCached() : Promise.resolve([] as any[]),
    need.phases ? supabase.from("playbook_phases").select("id, label, title, sort_order, school_id, playbook_tasks(id, text, assignee_id, assignee_label, month_label, notes, due_date, done)").order("sort_order").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.resources ? getResourcesCached() : Promise.resolve([] as any[]),
    need.reviews ? serviceDb.from("jazz_match_review").select("id, jazz_snapshot, candidate_id, reason").eq("status", "pending").order("created_at", { ascending: false }).then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.users ? supabase.from("profiles").select("id, full_name, email, role, school_id, is_active").order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.calendar ? serviceDb.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.budget ? serviceDb.from("budget_entries").select("id, school_id, kind, label, amount, notes, receipt_url, created_by").order("created_at", { ascending: false }).then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.budget ? serviceDb.from("budget_guidance").select("id, school_id, category, pct").order("sort_order").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
  ]);

  // Candidates tab: first page + count. Full-set facets/slim data hydrate on
  // the client after paint so the route does not block TTFB on every candidate.
  const PAGE_SIZE = 100;
  const candPage = paginatedList
    ? await listCandidates({ variant: "console", page: 0, pageSize: PAGE_SIZE, sortKey: "name", sortDir: "asc" })
    : { rows: [] as any[], total: 0 };
  const facets = { majors: [] as string[], stages: [] as string[], unroutedCount: 0, slim: [] as any[] };

  const favSet = new Set((favs ?? []).map((f: any) => f.candidate_id));
  const enriched = paginatedList ? candPage.rows : (candidates ?? []).map((c: any) => ({ ...c, is_favorite: favSet.has(c.id) }));

  // User Management: attach each user's last sign-in from Supabase Auth.
  let usersWithAuth = (usersData ?? []) as any[];
  if (need.users && usersWithAuth.length) {
    try {
      const { data: authList } = await serviceDb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const lastById = new Map((authList?.users ?? []).map((u: any) => [u.id, u.last_sign_in_at ?? null]));
      usersWithAuth = usersWithAuth.map((u) => ({ ...u, last_sign_in_at: lastById.get(u.id) ?? null }));
    } catch { /* auth admin unavailable — show users without sign-in data */ }
  }

  // Admin calendar: every event (org-wide + all schools) enriched with RSVPs.
  let events: any[] = [];
  if (need.calendar) {
    const { data: eventRows } = await serviceDb.from("events").select("id, title, description, address, event_date, event_type, school_id, created_by").order("event_date");
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
      const { data: noteRows } = await serviceDb.from("event_notes").select("id, event_id, school_id, body, created_by").in("event_id", eventIds);
      for (const n of noteRows ?? []) (notesByEvent[(n as any).event_id] ??= []).push(n);
    }
    events = (eventRows ?? []).map((e: any) => ({ ...e, going: rsvpByEvent[e.id]?.going ?? [], not_going: rsvpByEvent[e.id]?.not_going ?? [], my_status: (myRsvp[e.id] as "going" | "not_going" | undefined) ?? null, notes: notesByEvent[e.id] ?? [] }));
  }

  return (
    <ConsoleClient
      profile={profile}
      initialSection={S}
      schools={schools ?? []}
      candidates={enriched}
      candidatesTotal={paginatedList ? candPage.total : undefined}
      candidatesPageSize={PAGE_SIZE}
      facetMajors={facets.majors}
      facetStages={facets.stages}
      facetUnrouted={facets.unroutedCount}
      slimCandidates={facets.slim}
      team={team ?? []}
      goals={goals ?? []}
      phases={phases ?? []}
      users={usersWithAuth}
      reviews={reviewData ?? []}
      resources={resources ?? []}
      events={events}
      people={people ?? []}
      budgetEntries={budgetEntries ?? []}
      budgetGuidance={budgetGuidance ?? []}
    />
  );
}
