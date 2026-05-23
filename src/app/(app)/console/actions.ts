"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { isSuper, isAdminPlus } from "@/lib/types";

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

export async function reassignPointPerson(candidateId: string, ownerId: string | null) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("candidates").update({ point_person_id: ownerId }).eq("id", candidateId);
  if (error) return { error: error.message };
  revalidatePath("/console");
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
  id?: string; phase_id: string; text: string; assignee_id: string | null; due_date: string | null; done: boolean;
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
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const supabase = createServerSupabase();
  const { error } = await supabase.from("candidates").insert({ ...data, source: "user_created", not_interested: false });
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}

export async function bulkImportCandidates(
  rows: { name: string; email: string | null; school_id: string | null; stage: string | null; gpa: string | null; area_of_study: string | null }[]
) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const supabase = createServerSupabase();
  const { error } = await supabase.from("candidates").insert(
    rows.map((r) => ({ ...r, source: "user_created", not_interested: false }))
  );
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true, count: rows.length };
}

export async function upsertGoal(school_id: string, goal_sourced: number, goal_contacted: number, goal_applied: number) {
  const profile = await getCurrentProfile();
  if (!profile || !isAdminPlus(profile.role)) return { error: "Forbidden" };
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("school_goals")
    .upsert({ school_id, goal_sourced, goal_contacted, goal_applied }, { onConflict: "school_id" });
  if (error) return { error: error.message };
  revalidatePath("/console");
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

export async function inviteUser(email: string, full_name: string, role: string, school_id: string | null) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) return { error: "Forbidden" };
  const serviceDb = createServiceClient();
  const { data, error } = await serviceDb.auth.admin.inviteUserByEmail(email, {
    data: { full_name, role, school_id },
  });
  if (error) return { error: error.message };
  if (data?.user) {
    await serviceDb.from("profiles").upsert(
      { id: data.user.id, full_name, role, school_id },
      { onConflict: "id" }
    );
  }
  revalidatePath("/console");
  return { ok: true };
}
