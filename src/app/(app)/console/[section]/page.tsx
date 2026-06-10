import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { isSuper, isAdminPlus } from "@/lib/types";
import { canAccessConsoleSection } from "@/lib/nav/config";
import {
  getSchoolsCached, getGoalsCached, getResourcesCached,
  CAND_COLS_STANDINGS, CAND_COLS_CONSOLE,
} from "@/lib/queries";
import ConsoleClient from "../ConsoleClient";

// Each route renders one section → only fetch what that section reads.
export default async function ConsoleSection({ params }: { params: { section: string } }) {
  const profile = await getCurrentProfile();
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
    users: S === "users" && sup,
    favs: S === "applicants",
    calendar: S === "calendar",
  };

  const supabase = createServerSupabase();
  const serviceDb = createServiceClient();

  // Standings only reads id/school_id/stage; every other view needs the full row.
  const candSelect = S === "standings" ? CAND_COLS_STANDINGS : CAND_COLS_CONSOLE;

  // Reference tables (schools/goals/resources) come from the shared Data Cache.
  const [schools, candidates, favs, team, goals, phases, resources, reviewData, aiData, usersData, people] = await Promise.all([
    getSchoolsCached(),
    need.candidates ? supabase.from("candidates").select(candSelect).order("name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.favs ? supabase.from("favorites").select("candidate_id").eq("user_id", profile.id).then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.team ? supabase.from("profiles").select("id, full_name").order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.goals ? getGoalsCached() : Promise.resolve([] as any[]),
    need.phases ? supabase.from("playbook_phases").select("id, label, title, sort_order, school_id, playbook_tasks(id, text, assignee_id, assignee_label, month_label, notes, due_date, done)").order("sort_order").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.resources ? getResourcesCached() : Promise.resolve([] as any[]),
    need.reviews ? serviceDb.from("jazz_match_review").select("id, jazz_snapshot, candidate_id, reason").eq("status", "pending").order("created_at", { ascending: false }).then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.ai ? supabase.from("candidate_ai").select("candidate_id, resume_score, summary, flags, analyzed_at").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.users ? supabase.from("profiles").select("id, full_name, email, role, school_id, is_active").order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
    need.calendar ? serviceDb.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").then((r) => r.data ?? []) : Promise.resolve([] as any[]),
  ]);

  const favSet = new Set((favs ?? []).map((f: any) => f.candidate_id));
  const enriched = (candidates ?? []).map((c: any) => ({ ...c, is_favorite: favSet.has(c.id) }));

  // Admin calendar: every event (org-wide + all schools) enriched with RSVPs.
  let events: any[] = [];
  if (need.calendar) {
    const { data: eventRows } = await serviceDb.from("events").select("id, title, description, address, event_date, event_type, school_id, created_by").order("event_date");
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
    events = (eventRows ?? []).map((e: any) => ({ ...e, going: rsvpByEvent[e.id]?.going ?? [], not_going: rsvpByEvent[e.id]?.not_going ?? [], my_status: (myRsvp[e.id] as "going" | "not_going" | undefined) ?? null }));
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
      users={usersData ?? []}
      reviews={reviewData ?? []}
      resources={resources ?? []}
      events={events}
      people={people ?? []}
    />
  );
}
