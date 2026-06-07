"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { canEditPlaybook, canEditEvents } from "@/lib/types";
import { queueNotification, supersedePending } from "@/lib/notify";

const CLAIM_DELAY_MS = 30 * 60 * 1000;

// Toggle a favorite for the current user (favorites table is per-user via RLS).
export async function toggleFavorite(candidateId: string, makeFav: boolean) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  if (makeFav) {
    await supabase.from("favorites").upsert({ user_id: user.id, candidate_id: candidateId });
  } else {
    await supabase.from("favorites").delete().eq("user_id", user.id).eq("candidate_id", candidateId);
  }
  revalidatePath("/workspace");
  return { ok: true };
}

// Flag / unflag not-interested. RLS allows this only within the user's school.
export async function setNotInterested(candidateId: string, value: boolean) {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("candidates")
    .update({ not_interested: value })
    .eq("id", candidateId);
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

// Log an outreach note. Author must be the current user (enforced by RLS).
export async function logOutreach(candidateId: string, body: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase
    .from("outreach_log")
    .insert({ candidate_id: candidateId, author_id: user.id, body });
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

// ---- POINT PERSON (team_lead+ only; DB trigger also enforces this) ----
export async function reassignPointPerson(candidateId: string, ownerId: string | null) {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("candidates")
    .update({ point_person_id: ownerId })
    .eq("id", candidateId);
  if (error) return { error: error.message };
  await queueClaimNudge(candidateId, ownerId);
  revalidatePath("/workspace");
  return { ok: true };
}

// Cancel any pending claim nudge for this candidate; if it's now owned by someone,
// queue a fresh 30-minute "start outreach" nudge to the new point person.
export async function queueClaimNudge(candidateId: string, ownerId: string | null) {
  await supersedePending({ candidateId, type: "claim_followup" });
  if (!ownerId) return;
  const { data: cand } = await createServiceClient().from("candidates").select("name").eq("id", candidateId).maybeSingle();
  const name = cand?.name ?? "a candidate";
  await queueNotification({
    recipientId: ownerId,
    type: "claim_followup",
    title: `You're the point person for ${name}`,
    body: `You were assigned ${name}. Reach out and log your first outreach.`,
    link: "/workspace",
    candidateId,
    sendAfter: new Date(Date.now() + CLAIM_DELAY_MS),
    dedupeKey: `claim:${candidateId}:${ownerId}`,
  });
}

// ---- DRAWER: fetch a candidate's outreach log (school-scoped via RLS) ----
export async function getOutreach(candidateId: string) {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("outreach_log")
    .select("id, body, created_at, author_id")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });
  if (error) return { error: error.message, log: [] as any[] };
  return { ok: true, log: data ?? [] };
}

// ---- WARM-INTRO: add a manual connection (current user knows this candidate) ----
// Anyone may log that they know a candidate — even one they don't own — so we use
// the service client. The connection is always recorded under the calling user.
export async function addConnection(candidateId: string, relationship: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const db = createServiceClient();
  const { error } = await db
    .from("connections")
    .upsert({ fellow_id: user.id, candidate_id: candidateId, relationship });
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

export async function getConnections(candidateId: string) {
  // Warm intros are visible to everyone (read-only unless it's yours).
  const db = createServiceClient();
  const { data, error } = await db
    .from("connections")
    .select("id, fellow_id, relationship, profiles(full_name)")
    .eq("candidate_id", candidateId);
  if (error) return { error: error.message, connections: [] as any[] };
  return {
    ok: true,
    connections: (data ?? []).map((c: any) => ({
      id: c.id as string,
      fellow_id: c.fellow_id as string,
      name: (c.profiles as any)?.full_name ?? "Team member",
      relationship: c.relationship as string,
    })),
  };
}

// ---- PLAYBOOK (team_lead of own school, or admin+; DB RLS enforces) ----
export async function addPhase(schoolId: string, label: string, title: string, sortOrder: number) {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("playbook_phases")
    .insert({ school_id: schoolId, label, title, sort_order: sortOrder });
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

export async function upsertTask(t: {
  id?: string; phase_id: string; text: string; assignee_id: string | null;
  assignee_label: string | null; month_label: string | null; notes: string | null;
  due_date: string | null; done: boolean;
}) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const profile = await getCurrentProfile();
  const elevated = profile ? canEditPlaybook(profile.role) : false; // team_lead / admin+

  // Fellows may only touch a task that is assigned specifically to them.
  // Team-assigned or unassigned tasks (and new-task creation) require team_lead+.
  if (!elevated) {
    if (!t.id) return { error: "Only team leads or admins can add tasks." };
    const { data: existing } = await supabase
      .from("playbook_tasks").select("assignee_id").eq("id", t.id).single();
    if (!existing || existing.assignee_id !== user.id) {
      return { error: "You can only update tasks assigned to you." };
    }
  }

  const payload = t.id ? t : { ...t, id: undefined };
  const { error } = await supabase.from("playbook_tasks").upsert(payload);
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

// ---- MULTI-ASSIGNEE (team_lead+) -------------------------------------------
// Replace the set of people assigned to a task. Keeps the legacy assignee_id in
// sync (first person, or null) so older reads still resolve a primary owner.
export async function setTaskAssignees(taskId: string, profileIds: string[]) {
  const profile = await getCurrentProfile();
  if (!profile || !canEditPlaybook(profile.role)) return { error: "Only team leads or admins can assign tasks." };
  const db = createServiceClient();
  await db.from("playbook_task_assignees").delete().eq("task_id", taskId);
  if (profileIds.length) {
    const { error } = await db.from("playbook_task_assignees").insert(profileIds.map((profile_id) => ({ task_id: taskId, profile_id })));
    if (error) return { error: error.message };
  }
  // Clear completions for people no longer assigned.
  if (profileIds.length) await db.from("playbook_task_completions").delete().eq("task_id", taskId).not("profile_id", "in", `(${profileIds.join(",")})`);
  else await db.from("playbook_task_completions").delete().eq("task_id", taskId);
  await db.from("playbook_tasks").update({ assignee_id: profileIds[0] ?? null, assignee_label: null }).eq("id", taskId);
  await recomputeTaskDone(db, taskId);
  revalidatePath("/workspace");
  return { ok: true };
}

// Effective assignee list = explicit assignees, or the legacy single assignee_id.
async function assigneeIdsOf(db: ReturnType<typeof createServiceClient>, taskId: string): Promise<string[]> {
  const { data: rows } = await db.from("playbook_task_assignees").select("profile_id").eq("task_id", taskId);
  const ids = (rows ?? []).map((r: any) => r.profile_id as string);
  if (ids.length) return ids;
  const { data: t } = await db.from("playbook_tasks").select("assignee_id").eq("id", taskId).maybeSingle();
  return t?.assignee_id ? [t.assignee_id as string] : [];
}

// Recompute the task's done/pending_review from per-assignee completion state so
// the existing overview stats keep working. Done = at least one assignee and all confirmed.
async function recomputeTaskDone(db: ReturnType<typeof createServiceClient>, taskId: string) {
  const ids = await assigneeIdsOf(db, taskId);
  const { data: comps } = await db.from("playbook_task_completions").select("profile_id, state").eq("task_id", taskId);
  const confirmed = new Set((comps ?? []).filter((c: any) => c.state === "confirmed").map((c: any) => c.profile_id));
  const anyPending = (comps ?? []).some((c: any) => c.state === "pending_review");
  const done = ids.length > 0 && ids.every((id) => confirmed.has(id));
  await db.from("playbook_tasks").update({ done, pending_review: !done && anyPending }).eq("id", taskId);
}

// A fellow (or anyone assigned) submits their portion of a task → pending_review.
// value=false retracts their submission. Operates on the calling user only.
export async function requestTaskComplete(taskId: string, value: boolean) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const db = createServiceClient();
  const ids = await assigneeIdsOf(db, taskId);
  const profile = await getCurrentProfile();
  const elevated = profile ? canEditPlaybook(profile.role) : false;
  if (!elevated && !ids.includes(user.id)) return { error: "You can only update tasks assigned to you." };
  if (value) await db.from("playbook_task_completions").upsert({ task_id: taskId, profile_id: user.id, state: "pending_review", updated_at: new Date().toISOString() });
  else await db.from("playbook_task_completions").delete().eq("task_id", taskId).eq("profile_id", user.id);
  await recomputeTaskDone(db, taskId);
  revalidatePath("/workspace");
  return { ok: true };
}

// Team lead / admin confirms a task. With forProfileId it confirms (value=true)
// or sends back (value=false) one assignee's submission. Without it (team /
// unassigned tasks, or the console), it toggles the whole task done directly.
export async function confirmTaskComplete(taskId: string, value: boolean, forProfileId?: string) {
  const profile = await getCurrentProfile();
  if (!profile || !canEditPlaybook(profile.role)) return { error: "Only team leads or admins can confirm tasks." };
  const db = createServiceClient();

  if (forProfileId) {
    if (value) await db.from("playbook_task_completions").upsert({ task_id: taskId, profile_id: forProfileId, state: "confirmed", updated_at: new Date().toISOString() });
    else await db.from("playbook_task_completions").delete().eq("task_id", taskId).eq("profile_id", forProfileId);
    await recomputeTaskDone(db, taskId);
    revalidatePath("/workspace");
    return { ok: true };
  }

  // Legacy / team-task path: toggle done directly. Mirror onto any assignees so
  // per-assignee bubbles agree with the master state.
  let { error } = await db.from("playbook_tasks").update({ done: value, pending_review: false }).eq("id", taskId);
  if (error) ({ error } = await db.from("playbook_tasks").update({ done: value }).eq("id", taskId));
  if (error) return { error: error.message };
  const ids = await assigneeIdsOf(db, taskId);
  if (ids.length) {
    await db.from("playbook_task_completions").delete().eq("task_id", taskId);
    if (value) await db.from("playbook_task_completions").insert(ids.map((profile_id) => ({ task_id: taskId, profile_id, state: "confirmed" })));
  }
  revalidatePath("/workspace");
  return { ok: true };
}

export async function deleteTask(taskId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("playbook_tasks").delete().eq("id", taskId);
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

export async function deleteOutreach(logId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("outreach_log").delete().eq("id", logId);
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

// Remove a warm intro. You may remove your own; team leads/admins may remove any.
export async function deleteConnection(connectionId: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const db = createServiceClient();
  const { data: conn } = await db.from("connections").select("fellow_id").eq("id", connectionId).maybeSingle();
  if (!conn) return { ok: true };
  const profile = await getCurrentProfile();
  const elevated = profile ? canEditPlaybook(profile.role) : false;
  if (conn.fellow_id !== user.id && !elevated) return { error: "You can only remove your own warm intros." };
  const { error } = await db.from("connections").delete().eq("id", connectionId);
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

export async function updatePhase(phaseId: string, label: string, title: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("playbook_phases").update({ label, title }).eq("id", phaseId);
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

export async function deletePhase(phaseId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("playbook_phases").delete().eq("id", phaseId);
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

// ---- NOTIFICATIONS (in-app bell) ------------------------------------------
export async function markNotificationsRead(ids: string[]) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const db = createServiceClient();
  let q = db.from("notifications").update({ read: true }).eq("recipient_id", user.id).eq("read", false);
  if (ids.length) q = q.in("id", ids);
  await q;
  revalidatePath("/workspace");
  return { ok: true };
}

// ---- RECRUITING CALENDAR EVENTS (team_lead+ create/edit; everyone RSVPs) ----
export async function addEvent(e: {
  title: string; description: string | null; event_date: string;
  event_type: "attend" | "info"; school_id: string | null;
}) {
  const profile = await getCurrentProfile();
  if (!profile || !canEditEvents(profile.role)) return { error: "Only team leads or admins can add events." };
  if (!e.title.trim() || !e.event_date) return { error: "Title and date are required." };
  const db = createServiceClient();
  const { error } = await db.from("events").insert({
    title: e.title.trim(), description: e.description?.trim() || null,
    event_date: e.event_date, event_type: e.event_type,
    school_id: e.school_id, created_by: profile.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

export async function updateEvent(id: string, patch: {
  title?: string; description?: string | null; event_date?: string; event_type?: "attend" | "info";
}) {
  const profile = await getCurrentProfile();
  if (!profile || !canEditEvents(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const clean: Record<string, any> = {};
  if (patch.title !== undefined) clean.title = patch.title.trim();
  if (patch.description !== undefined) clean.description = patch.description?.trim() || null;
  if (patch.event_date !== undefined) clean.event_date = patch.event_date;
  if (patch.event_type !== undefined) clean.event_type = patch.event_type;
  const { error } = await db.from("events").update(clean).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

export async function deleteEvent(id: string) {
  const profile = await getCurrentProfile();
  if (!profile || !canEditEvents(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { error } = await db.from("events").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/workspace");
  return { ok: true };
}

// RSVP to an event. status null clears it.
export async function setRsvp(eventId: string, status: "going" | "not_going" | null) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const db = createServiceClient();
  if (status === null) {
    await db.from("event_rsvps").delete().eq("event_id", eventId).eq("profile_id", user.id);
  } else {
    await db.from("event_rsvps").upsert({ event_id: eventId, profile_id: user.id, status });
  }
  revalidatePath("/workspace");
  return { ok: true };
}
