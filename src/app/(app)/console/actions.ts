"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { isSuper, isAdminPlus, canManageResources } from "@/lib/types";
import { PLAYBOOK_DEFAULTS } from "@/lib/playbookDefaults";
import { routeToSchoolName } from "@/lib/stages";
import { queueClaimNudge } from "@/app/(app)/workspace/actions";

export async function toggleFavorite(candidateId: string, makeFav: boolean) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  if (makeFav) {
    await supabase.from("favorites").upsert({ user_id: user.id, candidate_id: candidateId });
  } else {
    await supabase.from("favorites").delete().eq("user_id", user.id).eq("candidate_id", candidateId);
  }
  revalidatePath("/console");
  return { ok: true };
}

export async function setNotInterested(candidateId: string, value: boolean) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("candidates").update({ not_interested: value }).eq("id", candidateId);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function reassignSchool(candidateId: string, schoolId: string | null) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { error } = await db.from("candidates").update({ school_id: schoolId }).eq("id", candidateId);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function reassignPointPerson(candidateId: string, ownerId: string | null) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("candidates").update({ point_person_id: ownerId }).eq("id", candidateId);
  if (error) return { error: error.message };
  await queueClaimNudge(candidateId, ownerId);
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function logOutreach(candidateId: string, body: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.from("outreach_log").insert({ candidate_id: candidateId, author_id: user.id, body });
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

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

export async function addPhase(schoolId: string, label: string, title: string, sortOrder: number) {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("playbook_phases")
    .insert({ school_id: schoolId, label, title, sort_order: sortOrder });
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function upsertTask(t: {
  id?: string; phase_id: string; text: string; assignee_id: string | null;
  assignee_label: string | null; month_label: string | null; notes: string | null;
  due_date: string | null; done: boolean;
}) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("playbook_tasks").upsert(t.id ? t : { ...t, id: undefined });
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function deleteTask(taskId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("playbook_tasks").delete().eq("id", taskId);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function addCandidate(data: {
  name: string; email: string | null; school_id: string | null;
  stage: string | null; gpa: string | null; area_of_study: string | null;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated" }; // any signed-in user may add
  const db = createServiceClient();
  const { error } = await db.from("candidates").insert({ ...data, source: "user_created", not_interested: false });
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function bulkImportCandidates(
  rows: { name: string; email: string | null; school_id: string | null; stage: string | null; gpa: string | null; area_of_study: string | null }[]
) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated" }; // any signed-in user may import
  const db = createServiceClient();
  const { error } = await db.from("candidates").insert(
    rows.map((r) => ({ ...r, source: "user_created", not_interested: false }))
  );
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true, count: rows.length };
}

export async function upsertGoal(school_id: string, goal_sourced: number, goal_contacted: number, goal_applied: number) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  await db.from("school_goals").delete().eq("school_id", school_id);
  const { error } = await db.from("school_goals").insert({ school_id, goal_sourced, goal_contacted, goal_applied });
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function upsertGroupGoal(schoolIds: string[], goal_sourced: number, goal_contacted: number, goal_applied: number) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  if (!schoolIds.length) return { ok: true };
  const db = createServiceClient();
  for (const school_id of schoolIds) {
    await db.from("school_goals").delete().eq("school_id", school_id);
  }
  const { error } = await db.from("school_goals").insert(
    schoolIds.map((school_id) => ({ school_id, goal_sourced, goal_contacted, goal_applied }))
  );
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function updateUser(user_id: string, role: string, school_id: string | null) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) return { error: "Forbidden" };
  const supabase = createServerSupabase();
  const { error } = await supabase.from("profiles").update({ role, school_id }).eq("id", user_id);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function updateUserName(user_id: string, full_name: string) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) return { error: "Forbidden" };
  const supabase = createServerSupabase();
  const { error } = await supabase.from("profiles").update({ full_name }).eq("id", user_id);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function removeUser(userId: string) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) return { error: "Forbidden" };
  if (userId === profile.id) return { error: "Cannot remove yourself" };
  const db = createServiceClient();
  await db.from("profiles").delete().eq("id", userId);
  try { await db.auth.admin.deleteUser(userId); } catch {}
  revalidatePath("/console");
  return { ok: true };
}

export async function addConnection(candidateId: string, relationship: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.from("connections").upsert({ fellow_id: user.id, candidate_id: candidateId, relationship });
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function getConnections(candidateId: string) {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
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

export async function deleteOutreach(logId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("outreach_log").delete().eq("id", logId);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function deleteConnection(connectionId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("connections").delete().eq("id", connectionId);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function updatePhase(phaseId: string, label: string, title: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("playbook_phases").update({ label, title }).eq("id", phaseId);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function deletePhase(phaseId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("playbook_phases").delete().eq("id", phaseId);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function deduplicateCandidates() {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) return { error: "Forbidden" };
  const serviceDb = createServiceClient();
  const { data: allCands, error } = await serviceDb
    .from("candidates")
    .select("id, email, jazz_id")
    .not("email", "is", null);
  if (error) return { error: error.message };

  const emailGroups = new Map<string, { id: string; jazz_id: string | null }[]>();
  for (const c of allCands ?? []) {
    if (!c.email) continue;
    const key = (c.email as string).toLowerCase();
    if (!emailGroups.has(key)) emailGroups.set(key, []);
    emailGroups.get(key)!.push({ id: c.id, jazz_id: c.jazz_id });
  }

  const toDelete: string[] = [];
  for (const [, group] of emailGroups) {
    if (group.length <= 1) continue;
    // Prefer records with a jazz_id (JazzHR-sourced); keep the first of those, delete rest
    const sorted = [...group].sort((a, b) => {
      if (a.jazz_id && !b.jazz_id) return -1;
      if (!a.jazz_id && b.jazz_id) return 1;
      return 0;
    });
    for (let i = 1; i < sorted.length; i++) toDelete.push(sorted[i].id);
  }

  if (toDelete.length > 0) {
    const { error: delErr } = await serviceDb.from("candidates").delete().in("id", toDelete);
    if (delErr) return { error: delErr.message };
  }

  revalidatePath("/console");
  return { ok: true, removed: toDelete.length };
}

function siteUrlForInvite() {
  return process.env.NEXT_PUBLIC_SITE_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
}

export async function inviteUser(email: string, full_name: string, role: string, school_id: string | null) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) return { error: "Forbidden" };
  const serviceDb = createServiceClient();
  const { data, error } = await serviceDb.auth.admin.inviteUserByEmail(email, {
    data: { full_name, role, school_id },
    redirectTo: `${siteUrlForInvite()}/auth/invite-callback`,
  });
  if (error) return { error: error.message };
  if (data?.user) {
    await serviceDb.from("profiles").upsert(
      { id: data.user.id, full_name, role, school_id, email: (data.user.email as string) ?? null },
      { onConflict: "id" }
    );
  }
  revalidatePath("/console");
  return { ok: true };
}

export async function bulkInviteUsers(
  rows: { email: string; full_name: string; role: string; school_id: string | null }[]
) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) return { error: "Forbidden" };
  const serviceDb = createServiceClient();

  let invited = 0;
  const failures: { email: string; error: string }[] = [];
  for (const r of rows) {
    const email = r.email.trim();
    if (!email) continue;
    const { data, error } = await serviceDb.auth.admin.inviteUserByEmail(email, {
      data: { full_name: r.full_name, role: r.role, school_id: r.school_id },
      redirectTo: `${siteUrlForInvite()}/auth/invite-callback`,
    });
    if (error) { failures.push({ email, error: error.message }); continue; }
    if (data?.user) {
      await serviceDb.from("profiles").upsert(
        { id: data.user.id, full_name: r.full_name, role: r.role, school_id: r.school_id, email: (data.user.email as string) ?? email },
        { onConflict: "id" }
      );
    }
    invited++;
  }
  revalidatePath("/console");
  return { ok: true, invited, failures };
}

// ---- JazzHR match review (Super-Admin) -------------------------------------
// Factual fields JazzHR owns; local data (owner/notes/favorites/outreach) is left alone.
function factualFromSnapshot(m: any, school_id: string | null) {
  const f: Record<string, any> = {
    jazz_id: m.jazz_id, name: m.name, email: m.email, phone: m.phone,
    apply_date: m.apply_date, linkedin: m.linkedin, resume_link: m.resume_link,
    stage: m.stage, job_title: m.job_title, university_raw: m.university_raw,
    gpa: m.gpa, grad_date: m.grad_date, area_of_study: m.area_of_study,
  };
  if (school_id) f.school_id = school_id;
  return f;
}

async function routeSchoolId(db: ReturnType<typeof createServiceClient>, universityRaw: string | null) {
  const name = routeToSchoolName(universityRaw);
  if (!name) return null;
  const { data } = await db.from("schools").select("id").eq("name", name).maybeSingle();
  return data?.id ?? null;
}

// Approve a name-only match: link the JazzHR applicant to the suspected candidate.
export async function approveJazzMatch(reviewId: string) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { data: rev } = await db.from("jazz_match_review").select("jazz_snapshot, candidate_id").eq("id", reviewId).single();
  if (!rev || !rev.candidate_id) return { error: "Review not found" };
  const m = rev.jazz_snapshot as any;
  const school_id = await routeSchoolId(db, m.university_raw);
  const { error } = await db.from("candidates").update(factualFromSnapshot(m, school_id)).eq("id", rev.candidate_id);
  if (error) return { error: error.message };
  await db.from("jazz_match_review").update({ status: "approved" }).eq("id", reviewId);
  revalidatePath("/console");
  return { ok: true };
}

// Reject a name-only match: import the JazzHR applicant as a separate candidate.
export async function rejectJazzMatch(reviewId: string) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { data: rev } = await db.from("jazz_match_review").select("jazz_snapshot").eq("id", reviewId).single();
  if (!rev) return { error: "Review not found" };
  const m = rev.jazz_snapshot as any;
  const school_id = await routeSchoolId(db, m.university_raw);
  const { error } = await db.from("candidates").insert({ ...m, school_id, not_interested: false });
  if (error) return { error: error.message };
  await db.from("jazz_match_review").update({ status: "rejected" }).eq("id", reviewId);
  revalidatePath("/console");
  return { ok: true };
}

// Unlink a candidate from JazzHR (clears jazz_id so it's no longer auto-refreshed).
export async function unlinkJazzCandidate(candidateId: string) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { error } = await db.from("candidates").update({ jazz_id: null }).eq("id", candidateId);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

// ---- RESOURCES (read: everyone; write: admin+) -----------------------------
export async function addResource(name: string, description: string | null, link: string | null) {
  const profile = await getCurrentProfile();
  if (!profile || !canManageResources(profile.role)) return { error: "Forbidden" };
  if (!name.trim()) return { error: "Name is required" };
  const db = createServiceClient();
  const { error } = await db.from("resources").insert({
    name: name.trim(), description: description?.trim() || null, link: link?.trim() || null, created_by: profile.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function updateResource(id: string, name: string, description: string | null, link: string | null) {
  const profile = await getCurrentProfile();
  if (!profile || !canManageResources(profile.role)) return { error: "Forbidden" };
  if (!name.trim()) return { error: "Name is required" };
  const db = createServiceClient();
  const { error } = await db.from("resources").update({
    name: name.trim(), description: description?.trim() || null, link: link?.trim() || null,
  }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function deleteResource(id: string) {
  const profile = await getCurrentProfile();
  if (!profile || !canManageResources(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { error } = await db.from("resources").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function seedPlaybook(schoolId: string, force = false) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();

  if (!force) {
    const { count } = await db.from("playbook_phases").select("id", { count: "exact", head: true }).eq("school_id", schoolId);
    if ((count ?? 0) > 0) return { error: "already_seeded" };
  } else {
    await db.from("playbook_phases").delete().eq("school_id", schoolId);
  }

  for (let i = 0; i < PLAYBOOK_DEFAULTS.length; i++) {
    const role = PLAYBOOK_DEFAULTS[i];
    const { data: phase, error: phaseErr } = await db
      .from("playbook_phases")
      .insert({ school_id: schoolId, title: role.title, label: role.title, sort_order: i })
      .select("id")
      .single();
    if (phaseErr || !phase) continue;

    const tasks = role.tasks.map((t) => ({
      phase_id: phase.id,
      text: t.text,
      month_label: t.month,
      done: false,
      assignee_id: null,
      assignee_label: role.title === "Oct/Nov Milestones" ? "team" : null,
      notes: null,
      due_date: null,
    }));
    if (tasks.length) await db.from("playbook_tasks").insert(tasks);
  }

  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}
