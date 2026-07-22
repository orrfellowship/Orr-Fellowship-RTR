import { createServiceClient } from "@/lib/supabase/server";
import { isAdminPlus, type Profile } from "@/lib/types";
import { evaluateCandidate } from "@/lib/triggers";
import { getTierSchoolIds, fetchAllRows } from "@/lib/queries";
import type { BadgeKey } from "@/lib/nav/config";

export interface ThisWeek { queueCount: number; tasksDone: number; tasksTotal: number; }
export interface NavData { badges: Partial<Record<BadgeKey, number>>; thisWeek: ThisWeek | null; }

// Sidebar badges + the fellow/lead "This Week" card. Returns empty/null pieces
// rather than guessed values when something can't be computed.
export async function loadNavData(profile: Profile): Promise<NavData> {
  const db = createServiceClient();
  const badges: Partial<Record<BadgeKey, number>> = {};

  // ---- admin / super: applicants total + users total ----
  if (isAdminPlus(profile.role)) {
    const { count: apps } = await db.from("candidates").select("id", { count: "exact", head: true });
    if (apps != null) badges.applicants = apps;
    // Users tab is available to all admins now, so show its count for admin+.
    const { count: users } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true);
    if (users != null) badges.users = users;
    return { badges, thisWeek: null };
  }

  // ---- fellow / team_lead ----
  const { ids: schoolIds } = await getTierSchoolIds(profile.school_id);
  if (schoolIds.length === 0) return { badges, thisWeek: { queueCount: 0, tasksDone: 0, tasksTotal: 0 } };

  const list = await fetchAllRows((from, to) => db
    .from("candidates")
    .select("id, stage, point_person_id, not_interested")
    .in("school_id", schoolIds)
    .range(from, to));
  badges.applicants = list.filter((c: any) => !c.not_interested).length;

  // last contact per candidate
  const ids = list.map((c: any) => c.id);
  const lastContact: Record<string, string> = {};
  if (ids.length) {
    const logs = await fetchAllRows((from, to) => db.from("outreach_log").select("candidate_id, created_at").in("candidate_id", ids).range(from, to));
    for (const l of logs) {
      const cid = (l as any).candidate_id, ts = (l as any).created_at;
      if (!lastContact[cid] || ts > lastContact[cid]) lastContact[cid] = ts;
    }
  }

  const now = Date.now();
  const lead = profile.role === "team_lead";
  let queueCount = 0, toClaim = 0;
  for (const c of list) {
    // Lead = school-wide (evaluate for whoever owns it); fellow = personal.
    const ctxId = lead ? (c as any).point_person_id : profile.id;
    const t = evaluateCandidate(c as any, { profileId: ctxId, lastContactISO: lastContact[(c as any).id], now });
    if (t) { queueCount++; if (t.kind === "claim") toClaim++; }
  }
  if (toClaim > 0) badges.toClaim = toClaim;

  // personal task progress
  let tasksTotal = 0, tasksDone = 0;
  try {
    const [{ data: aRows }, { data: legacy }] = await Promise.all([
      db.from("playbook_task_assignees").select("task_id").eq("profile_id", profile.id),
      db.from("playbook_tasks").select("id").eq("assignee_id", profile.id),
    ]);
    const taskIds = Array.from(new Set([...(aRows ?? []).map((r: any) => r.task_id), ...(legacy ?? []).map((r: any) => r.id)]));
    tasksTotal = taskIds.length;
    if (taskIds.length) {
      const { data: comps } = await db
        .from("playbook_task_completions")
        .select("task_id").eq("profile_id", profile.id).eq("state", "confirmed").in("task_id", taskIds);
      tasksDone = (comps ?? []).length;
    }
  } catch { /* tables may not exist pre-migration */ }

  return { badges, thisWeek: { queueCount, tasksDone, tasksTotal } };
}
