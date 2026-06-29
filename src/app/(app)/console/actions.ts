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
import { cookies } from "next/headers";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { getCurrentProfile, isPreviewing, VIEW_AS_COOKIE } from "@/lib/auth";
import { isSuper, isAdminPlus, canManageResources, canReassign } from "@/lib/types";
import { PLAYBOOK_DEFAULTS } from "@/lib/playbookDefaults";
import { routeToSchoolName, routeToSchoolNameByEmail } from "@/lib/stages";
import { sendEmail, emailLayout, emailConfigured } from "@/lib/email";
import { queueClaimNudge } from "@/app/(app)/workspace/actions";
import { evaluateCandidate } from "@/lib/triggers";
import { getTierSchoolIds, fetchAllRows, getSchoolsCached, CAND_COLS_CONSOLE, CAND_COLS_WORKSPACE } from "@/lib/queries";
import { representativeSchoolId } from "@/lib/candidateSchool";
import { planDuplicateDeletions } from "@/lib/duplicates";

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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { error } = await db.from("candidates").update({ school_id: schoolId }).eq("id", candidateId);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function reassignPointPerson(candidateId: string, ownerId: string | null) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const supabase = createServerSupabase();
  const { error } = await supabase.from("candidates").update({ point_person_id: ownerId }).eq("id", candidateId);
  if (error) return { error: error.message };
  await queueClaimNudge(candidateId, ownerId);
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function logOutreach(candidateId: string, body: string) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const supabase = createServerSupabase();
  const { error } = await supabase.from("playbook_tasks").upsert(t.id ? t : { ...t, id: undefined });
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function deleteTask(taskId: string) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const supabase = createServerSupabase();
  const { error } = await supabase.from("playbook_tasks").delete().eq("id", taskId);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

// Fallback routing for manually-entered candidates: if no school was chosen but
// the candidate has a recognizable school email (e.g. @purdue.edu), send them to
// that school. Satellite/bonus domains still route to the grouped tier and keep
// the specific school name separately.
async function routeSchoolByEmail(
  db: ReturnType<typeof createServiceClient>, school_id: string | null, email: string | null,
): Promise<{ school_id: string | null; university_raw: string | null }> {
  if (school_id) return { school_id, university_raw: null }; // only fill in when the person didn't pick a school
  const name = routeToSchoolNameByEmail(email);
  if (!name) return { school_id: null, university_raw: null };
  const { data: rows } = await db.from("schools").select("id, name, tier");
  const schools = rows ?? [];
  const matched = schools.find((s: any) => String(s.name).toLowerCase() === name.toLowerCase());
  if (!matched) return { school_id: null, university_raw: null };
  if (matched.tier === "satellite" || matched.tier === "bonus") {
    return { school_id: representativeSchoolId(schools as any[], matched.tier) ?? matched.id, university_raw: matched.name };
  }
  return { school_id: matched.id, university_raw: null };
}

export async function addCandidate(data: {
  name: string; email: string | null; school_id: string | null;
  stage: string | null; gpa: string | null; area_of_study: string | null;
  university_raw?: string | null; point_person_id?: string | null; linkedin?: string | null;
}) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated" }; // any signed-in user may add
  const db = createServiceClient();
  // No school selected? Route off a school email address if we recognize it.
  const routed = await routeSchoolByEmail(db, data.school_id, data.email);
  const school_id = data.school_id || routed.school_id;
  const university_raw = data.university_raw ?? routed.university_raw;
  // Only team leads / admins may assign a point person; ignore it from anyone else.
  const point_person_id = canReassign(profile.role) ? (data.point_person_id ?? null) : null;
  // Manually-entered candidates start in the "sourced" phase (stage key "new");
  // JazzHR advances them from there. Respect an explicit stage if one is given.
  const { error } = await db.from("candidates").insert({ ...data, school_id, university_raw, point_person_id, stage: data.stage || "new", source: "user_created", not_interested: false, created_by: profile.id });
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function updateCandidate(id: string, fields: {
  name?: string; email?: string | null; school_id?: string | null;
  university_raw?: string | null; gpa?: string | null; area_of_study?: string | null;
  linkedin?: string | null; grad_date?: string | null;
}) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated" };
  if (fields.name !== undefined && !fields.name.trim()) return { error: "Name can't be empty." };

  const db = createServiceClient();
  // Editing is limited to the person who added the candidate.
  const { data: existing } = await db.from("candidates").select("created_by").eq("id", id).maybeSingle();
  if (!existing) return { error: "Candidate not found." };
  if ((existing as any).created_by !== profile.id) return { error: "Only the person who added this candidate can edit it." };

  // Only persist keys that were actually provided, so a partial edit never wipes
  // an untouched column. Trim text; empty strings become null for nullable fields.
  const clean = (v: string | null | undefined) => {
    if (v === undefined) return undefined;
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  const updates: Record<string, any> = {};
  if (fields.name !== undefined) updates.name = fields.name.trim();
  for (const k of ["email", "university_raw", "gpa", "area_of_study", "linkedin", "grad_date"] as const) {
    if (fields[k] !== undefined) updates[k] = clean(fields[k]);
  }
  if (fields.school_id !== undefined) updates.school_id = fields.school_id || null;
  if (Object.keys(updates).length === 0) return { ok: true };

  const { error } = await db.from("candidates").update(updates).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

// Import partial info for candidates already in the system. Rows are matched to
// existing candidates by email (case-insensitive); a provided value is written
// only when that field is currently blank (never overwrites), and rows whose
// email isn't found are skipped. Currently fills in LinkedIn URLs.
export async function importCandidateInfo(
  rows: { email: string; linkedin?: string | null }[],
): Promise<{ ok?: true; updated: number; skipped: number; error?: string }> {
  if (isPreviewing()) return { error: "Exit preview to make changes.", updated: 0, skipped: 0 };
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated", updated: 0, skipped: 0 };

  const byEmail = new Map<string, { linkedin: string }>();
  for (const r of rows) {
    const email = (r.email ?? "").trim().toLowerCase();
    const linkedin = (r.linkedin ?? "").trim();
    if (email) byEmail.set(email, { linkedin });
  }
  if (byEmail.size === 0) return { ok: true, updated: 0, skipped: rows.length };

  const db = createServiceClient();
  // Match in memory (case-insensitive email), paging past the 1000-row cap.
  const all = await fetchAllRows<{ id: string; email: string | null; linkedin: string | null }>(
    (from, to) => db.from("candidates").select("id, email, linkedin").not("email", "is", null).range(from, to),
  );
  const matched = new Set<string>();
  let updated = 0;
  for (const c of all) {
    const email = (c.email ?? "").trim().toLowerCase();
    const inp = byEmail.get(email);
    if (!inp) continue;
    matched.add(email);
    // Fill blanks only — never overwrite an existing LinkedIn.
    if (inp.linkedin && !(c.linkedin ?? "").trim()) {
      const { error } = await db.from("candidates").update({ linkedin: inp.linkedin }).eq("id", c.id);
      if (!error) updated++;
    }
  }
  const skipped = byEmail.size - matched.size; // input emails with no candidate match
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true, updated, skipped };
}

export async function deleteCandidate(id: string) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { error } = await db.from("candidates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

// Delete many candidates at once (admin+). Used to clean up a bad import.
export async function bulkDeleteCandidates(ids: string[]): Promise<{ ok?: true; deleted: number; error?: string }> {
  if (isPreviewing()) return { error: "Exit preview to make changes.", deleted: 0 };
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden", deleted: 0 };
  if (!ids.length) return { ok: true, deleted: 0 };
  const db = createServiceClient();
  let deleted = 0;
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { error } = await db.from("candidates").delete().in("id", slice);
    if (error) { revalidatePath("/console"); revalidatePath("/workspace"); return { error: error.message, deleted }; }
    deleted += slice.length;
  }
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true, deleted };
}

export async function bulkImportCandidates(
  rows: { name: string; email: string | null; school_id: string | null; stage: string | null; gpa: string | null; area_of_study: string | null; university_raw?: string | null; point_person_id?: string | null; linkedin?: string | null }[]
) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authenticated" }; // any signed-in user may import
  if (rows.length === 0) return { ok: true, count: 0 };
  const db = createServiceClient();

  // Build a name→id map ONCE so email-based routing needs no per-row query. The
  // previous version issued one DB lookup per emailed row, which made big imports
  // crawl (and could time out) — the real cap on import size.
  const { data: schoolRows } = await db.from("schools").select("id, name, tier");
  const schools = schoolRows ?? [];
  const idByName = new Map<string, string>(schools.map((s: any) => [s.name, s.id]));
  const routeByEmail = (email: string | null) => {
    const name = routeToSchoolNameByEmail(email);
    if (!name) return { school_id: null as string | null, university_raw: null as string | null };
    const matched = schools.find((s: any) => String(s.name).toLowerCase() === name.toLowerCase());
    if (!matched) return { school_id: null as string | null, university_raw: null as string | null };
    if (matched.tier === "satellite" || matched.tier === "bonus") {
      return {
        school_id: representativeSchoolId(schools as any[], matched.tier) ?? matched.id,
        university_raw: matched.name as string,
      };
    }
    return { school_id: idByName.get(name) ?? null, university_raw: null as string | null };
  };

  // Only team leads / admins may assign point people on import.
  const allowPP = canReassign(profile.role);
  const prepared = rows.map((r) => {
    const routed = r.school_id ? { school_id: r.school_id, university_raw: null } : routeByEmail(r.email);
    return {
      ...r,
      // No school chosen for this row? Route off a recognized school email.
      school_id: r.school_id || routed.school_id,
      university_raw: r.university_raw ?? routed.university_raw,
      point_person_id: allowPP ? (r.point_person_id ?? null) : null,
      stage: r.stage || "new", source: "user_created", not_interested: false, created_by: profile.id,
    };
  });

  // Insert in chunks so there's no practical cap on import size — a single giant
  // insert can blow past request/statement limits. If a chunk fails, stop and
  // report how many rows already landed rather than silently losing the rest.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < prepared.length; i += CHUNK) {
    const { error } = await db.from("candidates").insert(prepared.slice(i, i + CHUNK));
    if (error) {
      revalidatePath("/console");
      revalidatePath("/workspace");
      return inserted > 0
        ? { error: `Imported ${inserted} of ${prepared.length} before an error: ${error.message}` }
        : { error: error.message };
    }
    inserted += Math.min(CHUNK, prepared.length - i);
  }
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true, count: inserted };
}

// ---- Server-side candidate pagination --------------------------------------
// One page of candidates, filtered/sorted/counted in the database so the client
// never holds the whole table. Used by the console + workspace candidate lists.
// Limitations (acceptable at 500/page): GPA is a text column so Min-GPA and the
// GPA sort compare lexically; the stage sort is alphabetical (not phase order).
const UUID_NONE = "00000000-0000-0000-0000-000000000000";
export type CandidatePageParams = {
  variant: "console" | "workspace"; // which column set to return
  page: number;                 // 0-based
  pageSize: number;
  scope?: string;               // "all" | <school_id> | "tier:satellite" | "tier:bonus"
  unroutedOnly?: boolean;
  q?: string;
  major?: string;               // "All majors" → ignored
  stage?: string;               // "All stages" → ignored
  minGpa?: string;
  favOnly?: boolean;
  mineOnly?: boolean;           // point_person_id == me
  creator?: string;             // "anyone" | "jazzhr" | <profile_id>
  sortKey?: "name" | "school" | "major" | "gpa" | "stage";
  sortDir?: "asc" | "desc";
};
export async function listCandidates(
  p: CandidatePageParams,
): Promise<{ rows: any[]; total: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { rows: [], total: 0 };
  const db = createServiceClient();

  // This user's favorites — drives the favOnly filter and the per-row star.
  const favRows = await fetchAllRows<{ candidate_id: string }>((from, to) =>
    db.from("favorites").select("candidate_id").eq("user_id", profile.id).range(from, to));
  const favSet = new Set(favRows.map((r) => r.candidate_id));

  const cols: string = p.variant === "workspace" ? CAND_COLS_WORKSPACE : CAND_COLS_CONSOLE;
  let qb: any = db.from("candidates").select(cols as any, { count: "exact" });

  if (p.scope === "tier:satellite" || p.scope === "tier:bonus") {
    const tier = p.scope.slice(5);
    const ids = ((await getSchoolsCached()) as any[]).filter((s) => s.tier === tier).map((s) => s.id);
    qb = qb.in("school_id", ids.length ? ids : [UUID_NONE]);
  } else if (p.scope && p.scope !== "all") {
    qb = qb.eq("school_id", p.scope);
  }
  if (p.unroutedOnly) qb = qb.is("school_id", null);

  if (p.q && p.q.trim()) {
    // Strip PostgREST filter-syntax characters so the search can't break the query.
    const term = p.q.trim().replace(/[%,()\\*]/g, " ").trim();
    if (term) qb = qb.or(`name.ilike.%${term}%,email.ilike.%${term}%,area_of_study.ilike.%${term}%`);
  }
  if (p.major && p.major !== "All majors") qb = qb.eq("area_of_study", p.major);
  if (p.stage && p.stage !== "All stages") qb = qb.eq("stage", p.stage);
  if (p.minGpa && p.minGpa.trim() && !Number.isNaN(parseFloat(p.minGpa))) qb = qb.gte("gpa", p.minGpa.trim());
  if (p.favOnly) qb = qb.in("id", favSet.size ? [...favSet] : [UUID_NONE]);
  if (p.mineOnly) qb = qb.eq("point_person_id", profile.id);
  if (p.creator === "jazzhr") qb = qb.eq("source", "jazzhr");
  else if (p.creator && p.creator !== "anyone") qb = qb.eq("created_by", p.creator);

  const sortCol = p.sortKey === "school" ? "school_id" : p.sortKey === "major" ? "area_of_study"
    : (p.sortKey === "gpa" || p.sortKey === "stage") ? p.sortKey : "name";
  qb = qb.order(sortCol, { ascending: p.sortDir !== "desc", nullsFirst: false });
  if (sortCol !== "name") qb = qb.order("name", { ascending: true });

  const from = Math.max(0, p.page) * p.pageSize;
  const { data, count, error } = await qb.range(from, from + p.pageSize - 1);
  if (error) return { rows: [], total: 0 };
  const rows = (data ?? []).map((c: any) => ({ ...c, is_favorite: favSet.has(c.id) }));
  return { rows, total: count ?? rows.length };
}

// Lightweight, full-set data the candidate pages still need even when the table
// itself is paginated: the distinct Major/Stage dropdown values, and a slim
// projection of every candidate for duplicate detection, JazzHR match review and
// the "already exists" import warnings. Far smaller than the full rows.
export type SlimCandidate = { id: string; name: string; email: string | null; school_id: string | null; jazz_id: string | null; source: string | null; stage: string | null; area_of_study: string | null; gpa: string | null; university_raw: string | null };
export type CandidateFacets = {
  majors: string[];
  stages: string[];
  unroutedCount: number;
  slim: SlimCandidate[];
};
export async function getCandidateFacets(includeSlim: boolean): Promise<CandidateFacets> {
  const db = createServiceClient();
  const rows = await fetchAllRows<SlimCandidate>(
    (from, to) => db.from("candidates").select("id, name, email, school_id, jazz_id, source, stage, area_of_study, gpa, university_raw").order("name").range(from, to),
  );
  const majors = Array.from(new Set(rows.map((r) => r.area_of_study).filter((m): m is string => !!m))).sort((a, b) => a.localeCompare(b));
  const stages = Array.from(new Set(rows.map((r) => r.stage).filter((s): s is string => !!s))).sort((a, b) => a.localeCompare(b));
  const unroutedCount = rows.filter((r) => !r.school_id).length;
  const slim = includeSlim ? rows : [];
  return { majors, stages, unroutedCount, slim };
}

export async function upsertGoal(school_id: string, goal_sourced: number, goal_contacted: number, goal_applied: number) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  if (!isSuper(profile.role) && role === "super_admin") return { error: "Only a super admin can grant super-admin access." };
  const guard = await guardSuperTarget(db, profile.role, user_id);
  if (guard) return { error: guard };
  const assignedCandidates = await fetchAllRows<{ id: string }>((from, to) =>
    db.from("candidates").select("id").eq("point_person_id", user_id).range(from, to));
  const { error } = await db.from("profiles").update({ role, school_id }).eq("id", user_id);
  if (error) return { error: error.message };
  if (assignedCandidates.length) {
    const { error: restoreError } = await db.from("candidates")
      .update({ point_person_id: user_id })
      .in("id", assignedCandidates.map((c) => c.id));
    if (restoreError) return { error: restoreError.message };
  }
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

export async function updateUserName(user_id: string, full_name: string) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const supabase = createServerSupabase();
  const { error } = await supabase.from("outreach_log").delete().eq("id", logId);
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function deleteConnection(connectionId: string) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) return { error: "Forbidden" };
  const serviceDb = createServiceClient();
  // Page through — a single select caps at 1000, which would leave most
  // duplicates unmerged once the table grows past that.
  const allCands = await fetchAllRows<{ id: string; email: string | null; jazz_id: string | null }>(
    (from, to) => serviceDb.from("candidates").select("id, email, jazz_id").not("email", "is", null).range(from, to),
  );

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

// Delete every email + name duplicate in one sweep, keeping one survivor per
// cluster (see planDuplicateDeletions — matches the Duplicate Review's matching).
// Pass dryRun to just count what would be removed (used to confirm before delete).
export async function deleteDuplicateCandidates(dryRun = false): Promise<{ ok?: true; count: number; error?: string }> {
  if (isPreviewing()) return { error: "Exit preview to make changes.", count: 0 };
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden", count: 0 };
  const db = createServiceClient();
  // Page through so the sweep covers the whole table, not just the first 1000.
  const cands = await fetchAllRows<{ id: string; name: string; email: string | null; school_id: string | null; jazz_id: string | null }>(
    (from, to) => db.from("candidates").select("id, name, email, school_id, jazz_id").range(from, to),
  );
  const toDelete = planDuplicateDeletions(cands ?? []);
  if (dryRun || toDelete.length === 0) return { ok: true, count: toDelete.length };

  let deleted = 0;
  const CHUNK = 200;
  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const slice = toDelete.slice(i, i + CHUNK);
    const { error } = await db.from("candidates").delete().in("id", slice);
    if (error) { revalidatePath("/console"); revalidatePath("/workspace"); return { error: error.message, count: deleted }; }
    deleted += slice.length;
  }
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true, count: deleted };
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
  let kind: "invite" | "recovery" = "invite";
  let res = await db.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { full_name, role, school_id },
      redirectTo: `${siteUrlForInvite()}/auth/invite-callback`,
    },
  });
  if (res.error && /regist|already|exist/i.test(res.error.message)) {
    kind = "recovery";
    res = await db.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${siteUrlForInvite()}/auth/reset-callback` },
    });
  }
  if (res.error) return { error: res.error.message };
  const user = res.data?.user;
  // Build our OWN link carrying the hashed token, which the callback verifies
  // with verifyOtp(). Admin-generated links can't use the PKCE code-exchange
  // flow (there's no code_verifier cookie in the recipient's browser), which is
  // what left users with "Auth session missing" on the set-password screen.
  const tokenHash = (res.data?.properties as any)?.hashed_token as string | undefined;
  // Link points at the /auth/confirm interstitial, which only verifies the
  // single-use token on an explicit click (POST) — keeps email scanners from
  // burning it first. `type` mirrors the generated link kind.
  const link = tokenHash
    ? `${siteUrlForInvite()}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${kind}`
    : undefined;
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  if (!isSuper(profile.role) && role === "super_admin") return { error: "Only a super admin can invite a super admin." };
  const serviceDb = createServiceClient();
  const res = await sendInvite(serviceDb, email.trim(), full_name, role, school_id);
  if ("error" in res) return { error: res.error };
  revalidatePath("/console");
  return { ok: true };
}

// Self-service notification test. Inserts a real in-app notification for the
// caller (so it shows in their own bell) and immediately emails it through the
// same SMTP path the cron flush uses — so one click exercises both channels
// end-to-end without waiting for the scheduled job. Only notifies the caller.
export async function sendTestNotification() {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };

  const db = createServiceClient();
  const nowIso = new Date().toISOString();
  const { data: inserted, error } = await db
    .from("notifications")
    .insert({
      recipient_id: profile.id,
      type: "weekly_snapshot", // reuse a valid type so the DB check constraint passes
      title: "Test notification",
      body: "You triggered this test. Seeing it in your bell and inbox means notifications are working.",
      link: "/workspace",
      send_after: nowIso,
    })
    .select("id")
    .single();
  if (error || !inserted) return { error: error?.message ?? "Could not create the notification." };

  // Email it now via the same path the flusher uses, then mark it emailed so the
  // next cron flush won't send a duplicate.
  let email: { ok: boolean; configured: boolean; error?: string } = { ok: false, configured: emailConfigured() };
  if (profile.email) {
    const res = await sendEmail({
      to: profile.email,
      subject: "Orr Recruiting — test notification",
      html: emailLayout({
        heading: "Test notification",
        bodyHtml: "<div>You triggered this from the app. If you're reading it, the in-app bell and email path are both wired up.</div>",
        ctaLabel: "Open workspace",
        ctaUrl: `${siteUrlForInvite()}/workspace`,
      }),
    });
    email = { ok: res.ok, configured: emailConfigured(), error: res.ok ? undefined : res.error };
    if (res.ok) await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", inserted.id);
  }

  revalidatePath("/workspace");
  return { ok: true, email };
}

// Admin sets a candidate's LinkedIn URL from the snapshot flashcard. Unlike
// updateCandidate (which restricts edits to the candidate's creator), this is
// gated to admins and writes via the service client to any candidate.
export async function setCandidateLinkedin(id: string, url: string) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const linkedin = (url ?? "").trim();
  if (!linkedin) return { error: "Enter a LinkedIn URL (or skip)." };
  const db = createServiceClient();
  const { error } = await db.from("candidates").update({ linkedin }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/console/snapshot");
  return { ok: true };
}

// Admin marks a help request handled. Supersedes every admin's copy of the
// request (matched by its shared dedupe_key) so it clears for the whole team.
export async function resolveHelpRequest(dedupeKey: string) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  if (!dedupeKey?.startsWith("help:")) return { error: "Invalid request." };
  const db = createServiceClient();
  const { error } = await db
    .from("notifications")
    .update({ superseded: true })
    .eq("type", "help_request")
    .eq("dedupe_key", dedupeKey);
  if (error) return { error: error.message };
  revalidatePath("/console/snapshot");
  return { ok: true };
}

// Super Admin clears a Direct Placement Potential item from their snapshot:
// unflag the candidate and supersede the related notifications so they drop off
// every Super Admin's bell + queue. Super-admin only — it's their queue.
export async function resolveDirectPlacement(candidateId: string) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { error } = await db
    .from("candidates")
    .update({ direct_placement: false, direct_placement_by: null, direct_placement_at: null })
    .eq("id", candidateId);
  if (error) return { error: error.message };
  await db
    .from("notifications")
    .update({ superseded: true })
    .eq("type", "direct_placement")
    .eq("candidate_id", candidateId);
  revalidatePath("/console/snapshot");
  return { ok: true };
}

export async function bulkInviteUsers(
  rows: { email: string; full_name: string; role: string; school_id: string | null }[]
) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  const { data: rows } = await db.from("schools").select("id, name, tier");
  const schools = rows ?? [];
  const matched = schools.find((s: any) => String(s.name).toLowerCase() === name.toLowerCase());
  if (!matched) return null;
  if (matched.tier === "satellite" || matched.tier === "bonus") {
    return representativeSchoolId(schools as any[], matched.tier) ?? matched.id;
  }
  return matched.id;
}

// Approve a name-only match: link the JazzHR applicant to the suspected candidate.
export async function approveJazzMatch(reviewId: string) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !canManageResources(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const { error } = await db.from("resources").delete().eq("id", id);
  if (error) return { error: error.message };
  bustCache(["resources"], ["/console", "/workspace"]);
  return { ok: true };
}

export async function seedPlaybook(schoolId: string, force = false) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();

  if (!force) {
    const { count } = await db.from("playbook_phases").select("id", { count: "exact", head: true }).eq("school_id", schoolId);
    if ((count ?? 0) > 0) return { error: "already_seeded" };
  } else {
    await db.from("playbook_phases").delete().eq("school_id", schoolId);
  }

  // The playbook is organized by DATE, not by role. Flatten every role's tasks,
  // group them by month, and de-duplicate identical tasks within a month so each
  // date shows a clean task list.
  const MONTH_ORDER = ["July", "August", "September", "Oct/Nov"];
  const byMonth = new Map<string, string[]>();
  const seen = new Map<string, Set<string>>();
  for (const role of PLAYBOOK_DEFAULTS) {
    for (const t of role.tasks) {
      const month = t.month;
      if (!byMonth.has(month)) { byMonth.set(month, []); seen.set(month, new Set()); }
      const key = t.text.trim();
      if (seen.get(month)!.has(key)) continue;
      seen.get(month)!.add(key);
      byMonth.get(month)!.push(t.text);
    }
  }
  const months = [...byMonth.keys()].sort((a, b) => {
    const ia = MONTH_ORDER.indexOf(a), ib = MONTH_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  for (let i = 0; i < months.length; i++) {
    const month = months[i];
    const { data: phase, error: phaseErr } = await db
      .from("playbook_phases")
      .insert({ school_id: schoolId, title: month, label: month, sort_order: i })
      .select("id")
      .single();
    if (phaseErr || !phase) continue;

    const tasks = byMonth.get(month)!.map((text) => ({
      phase_id: phase.id,
      text,
      month_label: null,
      done: false,
      assignee_id: null,
      assignee_label: null,
      notes: null,
      due_date: null,
    }));
    if (tasks.length) await db.from("playbook_tasks").insert(tasks);
  }

  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true };
}

// One-time, non-destructive migration: convert existing ROLE-based playbooks to
// DATE-based ones in place. Tasks are regrouped under month phases and de-duped
// within a month; assignees and completions on the duplicates are merged onto
// the kept task first, so nothing is lost. Idempotent — re-running is a no-op.
const PLAYBOOK_MONTH_ORDER = ["July", "August", "September", "Oct/Nov"];

async function migrateSchoolPlaybook(
  db: ReturnType<typeof createServiceClient>, schoolId: string,
): Promise<{ changed: boolean; merged: number }> {
  const { data: phases } = await db.from("playbook_phases").select("id, title, sort_order").eq("school_id", schoolId).order("sort_order");
  if (!phases || phases.length === 0) return { changed: false, merged: 0 };
  const phaseTitle = new Map(phases.map((p: any) => [p.id as string, ((p.title as string) ?? "").trim()]));
  const phaseIds = phases.map((p: any) => p.id as string);

  const { data: tasks } = await db.from("playbook_tasks").select("id, phase_id, text, month_label, assignee_id, due_date, notes, done").in("phase_id", phaseIds);
  if (!tasks || tasks.length === 0) return { changed: false, merged: 0 };
  const taskIds = tasks.map((t: any) => t.id as string);

  const { data: assignees } = await db.from("playbook_task_assignees").select("task_id, profile_id").in("task_id", taskIds);
  const { data: completions } = await db.from("playbook_task_completions").select("task_id, profile_id, state, updated_at").in("task_id", taskIds);
  const assigneesByTask = new Map<string, string[]>();
  for (const a of assignees ?? []) (assigneesByTask.get((a as any).task_id) ?? assigneesByTask.set((a as any).task_id, []).get((a as any).task_id)!).push((a as any).profile_id);
  const compsByTask = new Map<string, { profile_id: string; state: string; updated_at: string }[]>();
  for (const c of completions ?? []) (compsByTask.get((c as any).task_id) ?? compsByTask.set((c as any).task_id, []).get((c as any).task_id)!).push(c as any);

  // A task's month: its month_label, else its phase title if that's already a
  // month (so a second run is a no-op), else July.
  const monthOf = (t: any): string => {
    const ml = ((t.month_label as string) ?? "").trim();
    if (ml) return ml;
    const pt = phaseTitle.get(t.phase_id) ?? "";
    return PLAYBOOK_MONTH_ORDER.includes(pt) ? pt : "July";
  };

  const phaseRank = new Map(phases.map((p: any, i: number) => [p.id as string, i]));
  const ordered = [...tasks].sort((a: any, b: any) => (phaseRank.get(a.phase_id)! - phaseRank.get(b.phase_id)!));

  // month -> normalized text -> tasks (first is canonical, kept)
  const groups = new Map<string, Map<string, any[]>>();
  for (const t of ordered) {
    const m = monthOf(t);
    if (!groups.has(m)) groups.set(m, new Map());
    const key = ((t.text as string) ?? "").trim().toLowerCase();
    const g = groups.get(m)!;
    (g.get(key) ?? g.set(key, []).get(key)!).push(t);
  }
  const months = [...groups.keys()].sort((a, b) => {
    const ia = PLAYBOOK_MONTH_ORDER.indexOf(a), ib = PLAYBOOK_MONTH_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  // Reuse a phase already titled exactly the month, else create one.
  const monthPhaseId = new Map<string, string>();
  const kept = new Set<string>();
  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    const existing = phases.find((p: any) => ((p.title as string) ?? "").trim() === m && !kept.has(p.id));
    if (existing) {
      monthPhaseId.set(m, existing.id);
      kept.add(existing.id);
      await db.from("playbook_phases").update({ title: m, label: m, sort_order: i }).eq("id", existing.id);
    } else {
      const { data: created } = await db.from("playbook_phases").insert({ school_id: schoolId, title: m, label: m, sort_order: i }).select("id").single();
      if (created) { monthPhaseId.set(m, (created as any).id); kept.add((created as any).id); }
    }
  }

  let merged = 0;
  const dupTaskIds: string[] = [];
  for (const m of months) {
    const phaseId = monthPhaseId.get(m)!;
    for (const [, groupTasks] of groups.get(m)!) {
      const canonical = groupTasks[0];
      const dups = groupTasks.slice(1);

      const mergedAssignees = new Set<string>(assigneesByTask.get(canonical.id) ?? []);
      const mergedComps = new Map<string, { state: string; updated_at: string }>();
      for (const c of compsByTask.get(canonical.id) ?? []) mergedComps.set(c.profile_id, { state: c.state, updated_at: c.updated_at });
      let anyDone = !!canonical.done;
      let assigneeId: string | null = canonical.assignee_id ?? null;

      for (const d of dups) {
        for (const pid of assigneesByTask.get(d.id) ?? []) mergedAssignees.add(pid);
        for (const c of compsByTask.get(d.id) ?? []) {
          const ex = mergedComps.get(c.profile_id);
          if (!ex || (ex.state !== "confirmed" && c.state === "confirmed")) mergedComps.set(c.profile_id, { state: c.state, updated_at: c.updated_at });
        }
        if (d.done) anyDone = true;
        if (!assigneeId && d.assignee_id) assigneeId = d.assignee_id;
        dupTaskIds.push(d.id);
        merged++;
      }

      await db.from("playbook_tasks").update({ phase_id: phaseId, month_label: null, done: anyDone, assignee_id: assigneeId }).eq("id", canonical.id);
      if (mergedAssignees.size) {
        await db.from("playbook_task_assignees").upsert([...mergedAssignees].map((pid) => ({ task_id: canonical.id, profile_id: pid })), { onConflict: "task_id,profile_id", ignoreDuplicates: true });
      }
      if (mergedComps.size) {
        await db.from("playbook_task_completions").upsert([...mergedComps].map(([pid, v]) => ({ task_id: canonical.id, profile_id: pid, state: v.state, updated_at: v.updated_at })), { onConflict: "task_id,profile_id" });
      }
    }
  }

  // Remove the merged-away duplicates (cascades their now-copied assignees/completions).
  if (dupTaskIds.length) await db.from("playbook_tasks").delete().in("id", dupTaskIds);
  // Drop the now-empty old role phases (every task was repointed to a month phase).
  const oldPhaseIds = phaseIds.filter((id) => !kept.has(id));
  if (oldPhaseIds.length) await db.from("playbook_phases").delete().in("id", oldPhaseIds);

  return { changed: true, merged };
}

export async function migratePlaybooksToDates() {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) return { error: "Only a super admin can run this." };
  const db = createServiceClient();
  const { data: schools } = await db.from("schools").select("id");
  let schoolsChanged = 0, merged = 0;
  for (const s of schools ?? []) {
    const r = await migrateSchoolPlaybook(db, (s as any).id);
    if (r.changed) schoolsChanged++;
    merged += r.merged;
  }
  revalidatePath("/console");
  revalidatePath("/workspace");
  return { ok: true as const, schoolsChanged, merged };
}

// ---- VIEW AS (admin read-only preview of another person) -------------------
export async function setViewAs(userId: string | null) {
  const me = await getCurrentProfile();
  if (!me || !isAdminPlus(me.role)) return { error: "Forbidden" };
  const jar = cookies();
  if (userId && userId !== me.id) jar.set(VIEW_AS_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
  else jar.delete(VIEW_AS_COOKIE);
  return { ok: true };
}

// ---- BUDGETS — admins add allocations; team leads add expenses (w/ receipt) --
export async function addBudgetEntry(e: {
  school_id: string | null; kind: "allocation" | "expense"; label: string;
  amount: number; notes: string | null; receipt_url?: string | null;
}) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
  if (isPreviewing()) return { error: "Exit preview to make changes." };
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
    const cands = await fetchAllRows((from, to) => db.from("candidates").select("id, name, stage, point_person_id, not_interested").in("school_id", schoolIds).range(from, to));
    const list = cands as any[];
    const ids = list.map((c) => c.id);
    const lastContact: Record<string, string> = {};
    if (ids.length) {
      const logs = await fetchAllRows((from, to) => db.from("outreach_log").select("candidate_id, created_at").in("candidate_id", ids).range(from, to));
      for (const l of logs) { const cid = (l as any).candidate_id, ts = (l as any).created_at; if (!lastContact[cid] || ts > lastContact[cid]) lastContact[cid] = ts; }
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

// Admin's recommended spending split by category for one budget scope.
export async function setBudgetGuidance(school_id: string | null, items: { category: string; pct: number }[]) {
  if (isPreviewing()) return { error: "Exit preview to make changes." };
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const db = createServiceClient();
  const del = db.from("budget_guidance").delete();
  const { error: deleteError } = school_id ? await del.eq("school_id", school_id) : await del.is("school_id", null);
  if (deleteError) return { error: deleteError.message };
  const rows = items.filter((i) => i.category.trim()).map((i, idx) => ({
    school_id,
    category: i.category.trim(),
    pct: Number(i.pct) || 0,
    sort_order: idx,
    created_by: profile.id,
  }));
  if (rows.length) { const { error } = await db.from("budget_guidance").insert(rows); if (error) return { error: error.message }; }
  bustCache([], ["/console", "/workspace"]);
  return { ok: true };
}
