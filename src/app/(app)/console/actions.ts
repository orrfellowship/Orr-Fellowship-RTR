"use server";

import { revalidatePath, revalidateTag } from "next/cache";

// Cache busting must never fail a successful write. revalidateTag can throw an
// internal invariant inside a server action on some Next 14.2.x builds; swallow
// it — the data is already saved and tagged caches also expire on their own TTL.
function bustCache(tags: string[], paths: string[]) {
  try {
    for (const t of tags) revalidateTag(t);
    for (const p of paths) revalidatePath(p);
  } catch { /* revalidation is best-effort */ }
}
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { isSuper, isAdminPlus, canManageResources } from "@/lib/types";
import { PLAYBOOK_DEFAULTS } from "@/lib/playbookDefaults";
import { routeToSchoolName } from "@/lib/stages";
import { sendEmail, emailLayout } from "@/lib/email";
import { queueClaimNudge } from "@/app/(app)/workspace/actions";
import { evaluateCandidate } from "@/lib/triggers";
import { getTierSchoolIds } from "@/lib/queries";

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
  university_raw?: string | null;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated" }; // any signed-in user may add
  const db = createServiceClient();
  // Manually-entered candidates start in the "sourced" phase (stage key "new");
  // JazzHR advances them from there. Respect an explicit stage if one is given.
  const { error } = await db.from("candidates").insert({ ...data, stage: data.stage || "new", source: "user_created", not_interested: false, created_by: profile.id });
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function deleteCandidate(id: string) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { error } = await db.from("candidates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function bulkImportCandidates(
  rows: { name: string; email: string | null; school_id: string | null; stage: string | null; gpa: string | null; area_of_study: string | null; university_raw?: string | null }[]
) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated" }; // any signed-in user may import
  const db = createServiceClient();
  const { error } = await db.from("candidates").insert(
    rows.map((r) => ({ ...r, stage: r.stage || "new", source: "user_created", not_interested: false, created_by: profile.id }))
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
  bustCache(["goals"], ["/console", "/workspace"]);
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
  bustCache(["goals"], ["/console", "/workspace"]);
  return { ok: true };
}

// Admins may manage users, but only super admins can grant, alter, or remove
// super-admin accounts. Returns an error string if the actor isn't allowed to
// touch the given target, else null.
async function guardSuperTarget(
  db: ReturnType<typeof createServiceClient>, actorRole: string, targetUserId: string,
): Promise<string | null> {
  if (isSuper(actorRole as any)) return null;
  const { data: target } = await db.from("profiles").select("role").eq("id", targetUserId).maybeSingle();
  if ((target as any)?.role === "super_admin") return "Only a super admin can modify a super admin.";
  return null;
}

export async function updateUser(user_id: string, role: string, school_id: string | null) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  if (!isSuper(profile.role) && role === "super_admin") return { error: "Only a super admin can grant super-admin access." };
  const guard = await guardSuperTarget(db, profile.role, user_id);
  if (guard) return { error: guard };
  const { error } = await db.from("profiles").update({ role, school_id }).eq("id", user_id);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function updateUserName(user_id: string, full_name: string) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const guard = await guardSuperTarget(db, profile.role, user_id);
  if (guard) return { error: guard };
  const { error } = await db.from("profiles").update({ full_name }).eq("id", user_id);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function removeUser(userId: string) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  if (userId === profile.id) return { error: "Cannot remove yourself" };
  const db = createServiceClient();
  const guard = await guardSuperTarget(db, profile.role, userId);
  if (guard) return { error: guard };
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
    .select("id, fellow_id, relationship, profiles!fellow_id(full_name)")
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

const ROLE_LABEL: Record<string, string> = {
  fellow: "a Fellow", team_lead: "a Team Lead", admin: "an Admin", super_admin: "a Super Admin",
};

// Create the auth user + invite link WITHOUT triggering Supabase's own email,
// then deliver the invite through our SMTP (email.ts → personal Gmail). This
// sidesteps Supabase Auth's email rate limit; the limiting factor becomes our
// own SMTP provider (Gmail caps ~500/day) instead.
async function sendInvite(
  db: ReturnType<typeof createServiceClient>,
  email: string, full_name: string, role: string, school_id: string | null,
): Promise<{ ok: true } | { error: string }> {
  // New invite. If the user already exists (e.g. a prior invite created them but
  // the email failed), fall back to a recovery link so they can still set their
  // password — re-running an invite is therefore idempotent.
  let res = await db.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { full_name, role, school_id },
      redirectTo: `${siteUrlForInvite()}/auth/invite-callback`,
    },
  });
  if (res.error && /regist|already|exist/i.test(res.error.message)) {
    res = await db.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${siteUrlForInvite()}/auth/reset-callback` },
    });
  }
  if (res.error) return { error: res.error.message };
  const link = res.data?.properties?.action_link;
  const user = res.data?.user;
  if (!link || !user) return { error: "Could not generate an invite link." };

  await db.from("profiles").upsert(
    { id: user.id, full_name, role, school_id, email: (user.email as string) ?? email },
    { onConflict: "id" },
  );

  const html = emailLayout({
    heading: "You're invited to Orr Recruiting",
    intro: `${full_name ? full_name + ", you've" : "You've"} been added as ${ROLE_LABEL[role] ?? "a team member"}.`,
    bodyHtml: "Click below to set your password and get started. This link is single-use and will expire.",
    ctaLabel: "Set your password",
    ctaUrl: link,
  });
  const sent = await sendEmail({ to: email, subject: "Your Orr Recruiting invite", html });
  if (!sent.ok) return { error: `User created, but the invite email failed to send (${sent.error}).` };
  return { ok: true };
}

export async function inviteUser(email: string, full_name: string, role: string, school_id: string | null) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  if (!isSuper(profile.role) && role === "super_admin") return { error: "Only a super admin can invite a super admin." };
  const serviceDb = createServiceClient();
  const res = await sendInvite(serviceDb, email.trim(), full_name, role, school_id);
  if ("error" in res) return { error: res.error };
  revalidatePath("/console");
  return { ok: true };
}

export async function bulkInviteUsers(
  rows: { email: string; full_name: string; role: string; school_id: string | null }[]
) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const canSuper = isSuper(profile.role);
  const serviceDb = createServiceClient();

  let invited = 0;
  const failures: { email: string; error: string }[] = [];
  for (const r of rows) {
    const email = r.email.trim();
    if (!email) continue;
    if (!canSuper && r.role === "super_admin") { failures.push({ email, error: "Only a super admin can invite a super admin." }); continue; }
    const res = await sendInvite(serviceDb, email, r.full_name, r.role, r.school_id);
    if ("error" in res) { failures.push({ email, error: res.error }); continue; }
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
  bustCache(["resources"], ["/console", "/workspace"]);
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
  bustCache(["resources"], ["/console", "/workspace"]);
  return { ok: true };
}

export async function deleteResource(id: string) {
  const profile = await getCurrentProfile();
  if (!profile || !canManageResources(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { error } = await db.from("resources").delete().eq("id", id);
  if (error) return { error: error.message };
  bustCache(["resources"], ["/console", "/workspace"]);
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

// ---- BUDGETS — admins add allocations; team leads add expenses (w/ receipt) --
export async function addBudgetEntry(e: {
  school_id: string | null; kind: "allocation" | "expense"; label: string;
  amount: number; notes: string | null; receipt_url?: string | null;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated" };
  const leadPlus = profile.role === "team_lead" || isAdminPlus(profile.role);
  if (e.kind === "allocation" && !isAdminPlus(profile.role)) return { error: "Only admins can add allocations." };
  if (e.kind === "expense" && !leadPlus) return { error: "Only team leads or admins can add expenses." };
  if (!e.label.trim()) return { error: "A label is required." };
  if (e.kind === "expense" && !e.receipt_url) return { error: "A receipt is required for expenses." };
  const db = createServiceClient();
  const { error } = await db.from("budget_entries").insert({
    school_id: e.school_id,
    kind: e.kind,
    label: e.label.trim(),
    amount: Number.isFinite(e.amount) ? e.amount : 0,
    notes: e.notes?.trim() || null,
    receipt_url: e.receipt_url || null,
    created_by: profile.id,
  });
  if (error) return { error: error.message };
  bustCache([], ["/console", "/workspace"]);
  return { ok: true };
}

// Upload a receipt image to the private "receipts" bucket; returns the storage path.
export async function uploadReceipt(formData: FormData): Promise<{ ok: true; path: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated" };
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "No file selected." };
  if (file.size > 8 * 1024 * 1024) return { error: "Receipt is too large (max 8 MB)." };
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${profile.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  const { error } = await createServiceClient().storage.from("receipts").upload(path, buf, {
    contentType: file.type || "application/octet-stream", upsert: false,
  });
  if (error) return { error: error.message };
  return { ok: true, path };
}

// Short-lived signed URL to view a private receipt.
export async function signedReceiptUrl(path: string): Promise<{ ok: true; url: string } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated" };
  const { data, error } = await createServiceClient().storage.from("receipts").createSignedUrl(path, 3600);
  if (error || !data) return { error: error?.message || "Could not open receipt." };
  return { ok: true, url: data.signedUrl };
}

export async function deleteBudgetEntry(id: string) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated" };
  const db = createServiceClient();
  // Admins can remove anything; others only their own entries.
  if (!isAdminPlus(profile.role)) {
    const { data: row } = await db.from("budget_entries").select("created_by").eq("id", id).maybeSingle();
    if ((row as any)?.created_by !== profile.id) return { error: "You can only remove your own entries." };
  }
  const { error } = await db.from("budget_entries").delete().eq("id", id);
  if (error) return { error: error.message };
  bustCache([], ["/console", "/workspace"]);
  return { ok: true };
}

// Read-only Weekly Snapshot summary for a user (admin viewing User Management):
// their action queue + personal task progress, computed the same way the snapshot does.
export async function getUserSnapshot(userId: string) {
  const me = await getCurrentProfile();
  if (!me || !isAdminPlus(me.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { data: target } = await db.from("profiles").select("id, full_name, role, school_id").eq("id", userId).maybeSingle();
  if (!target) return { error: "User not found." };
  const t = target as any;
  if (t.role === "admin" || t.role === "super_admin") return { ok: true as const, name: t.full_name, isAdmin: true, queue: [], tasksDone: 0, tasksTotal: 0 };

  const { ids: schoolIds } = await getTierSchoolIds(t.school_id);
  const queue: { name: string; why: string }[] = [];
  if (schoolIds.length) {
    const { data: cands } = await db.from("candidates").select("id, name, stage, point_person_id, not_interested").in("school_id", schoolIds);
    const list = (cands ?? []) as any[];
    const ids = list.map((c) => c.id);
    const lastContact: Record<string, string> = {};
    if (ids.length) {
      const { data: logs } = await db.from("outreach_log").select("candidate_id, created_at").in("candidate_id", ids);
      for (const l of logs ?? []) { const cid = (l as any).candidate_id, ts = (l as any).created_at; if (!lastContact[cid] || ts > lastContact[cid]) lastContact[cid] = ts; }
    }
    const now = Date.now();
    const lead = t.role === "team_lead";
    for (const c of list) {
      const ctxId = lead ? c.point_person_id : t.id;
      const tr = evaluateCandidate(c as any, { profileId: ctxId, lastContactISO: lastContact[c.id], now });
      if (tr) queue.push({ name: c.name, why: tr.why });
    }
  }

  let tasksTotal = 0, tasksDone = 0;
  try {
    const [{ data: aRows }, { data: legacy }] = await Promise.all([
      db.from("playbook_task_assignees").select("task_id").eq("profile_id", t.id),
      db.from("playbook_tasks").select("id").eq("assignee_id", t.id),
    ]);
    const taskIds = Array.from(new Set([...(aRows ?? []).map((r: any) => r.task_id), ...(legacy ?? []).map((r: any) => r.id)]));
    tasksTotal = taskIds.length;
    if (taskIds.length) {
      const { data: comps } = await db.from("playbook_task_completions").select("task_id").eq("profile_id", t.id).eq("state", "confirmed").in("task_id", taskIds);
      tasksDone = (comps ?? []).length;
    }
  } catch { /* pre-migration tables */ }

  return { ok: true as const, name: t.full_name, isAdmin: false, queue, tasksDone, tasksTotal };
}

// Admin's recommended spending split by category (org-wide guidance).
export async function setBudgetGuidance(items: { category: string; pct: number }[]) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  await db.from("budget_guidance").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  const rows = items.filter((i) => i.category.trim()).map((i, idx) => ({ category: i.category.trim(), pct: Number(i.pct) || 0, sort_order: idx, created_by: profile.id }));
  if (rows.length) { const { error } = await db.from("budget_guidance").insert(rows); if (error) return { error: error.message }; }
  bustCache([], ["/console", "/workspace"]);
  return { ok: true };
}
