import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/auth";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { isSuper, isAdminPlus } from "@/lib/types";
import { canAccessConsoleSection } from "@/lib/nav/config";
import {
  getSchoolsCached, getGoalsCached, getResourcesCached, fetchAllRows,
  CAND_COLS_STANDINGS, CAND_COLS_CONSOLE,
} from "@/lib/queries";
import ConsoleClient from "../ConsoleClient";

// Each route renders one section → only fetch what that section reads.
export default async function ConsoleSection({ params }: { params: { section: string } }) {
  const { profile } = await resolveViewer();
  if (!profile) redirect("/login");
  if (!isAdminPlus(profile.role)) redirect("/workspace/snapshot");
  if (!canAccessConsoleSection(profile.role, params.section)) redirect("/console/overview");
  const S = params.section;
  const sup = isSuper(profile.role);

  const need = {
    candidates: ["overview", "applicants", "standings", "schools", "sync", "review"].includes(S),
    goals: ["overview", "standings", "schools"].includes(S),
    team: ["applicants", "playbook"].includes(S),
    phases: S === "playbook",
    resources: S === "resources",
    reviews: ["applicants", "sync", "review"].includes(S),
    ai: S === "applicants" && sup,
    users: S === "users" || S === "schools", // schools tab needs profiles for per-school teammate counts
    favs: S === "applicants",
    calendar: S === "calendar",
    budget: S === "budget",
  };

  const supabase = createServerSupabase();
  const serviceDb = createServiceClient();

  // Standings only reads id/school_id/stage; every other view needs the full row.
  const candSelect = S === "standings" ? CAND_COLS_STANDINGS : CAND_COLS_CONSOLE;

  // Reference tables (schools/goals/resources) come from the shared Data Cache.
  const [schools, candidates, favs, team, goals, phases, resources, reviewData, aiData, usersData, people, budgetEntries, budgetGuidance] = await Promise.all([
    getSchoolsCached(),
    need.candidates ? fetchAllRows((from, to) => supabase.from("candidates").select(candSelect).order("name").range(from, to)) : Promise.resolve([] as any[]),
    need.favs ? supabase.from("favorites").select("candidate_id").eq("user_id", profile.id).then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.team ? supabase.from("profiles").select("id, full_name").order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.goals ? getGoalsCached() : Promise.resolve([] as any[]),
    need.phases ? supabase.from("playbook_phases").select("id, label, title, sort_order, school_id, playbook_tasks(id, text, assignee_id, assignee_label, month_label, notes, due_date, done)").order("sort_order").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.resources ? getResourcesCached() : Promise.resolve([] as any[]),
    need.reviews ? serviceDb.from("jazz_match_review").select("id, jazz_snapshot, candidate_id, reason").eq("status", "pending").order("created_at", { ascending: false }).then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.ai ? fetchAllRows((from, to) => supabase.from("candidate_ai").select("candidate_id, resume_score, summary, flags, analyzed_at").range(from, to)) : Promise.resolve([] as any[]),
    need.users ? supabase.from("profiles").select("id, full_name, email, role, school_id, is_active").order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.calendar ? serviceDb.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.budget ? serviceDb.from("budget_entries").select("id, school_id, kind, label, amount, notes, receipt_url, created_by").order("created_at", { ascending: false }).then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.budget ? serviceDb.from("budget_guidance").select("id, category, pct").order("sort_order").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
  ]);

  const favSet = new Set((favs ?? []).map((f: any) => f.candidate_id));
  const enriched = (candidates ?? []).map((c: any) => ({ ...c, is_favorite: favSet.has(c.id) }));

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
      team={team ?? []}
      goals={goals ?? []}
      ai={aiData ?? []}
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
