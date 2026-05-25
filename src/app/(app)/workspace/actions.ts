"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

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
  revalidatePath("/workspace");
  return { ok: true };
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
export async function addConnection(candidateId: string, relationship: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase
    .from("connections")
    .upsert({ fellow_id: user.id, candidate_id: candidateId, relationship });
  if (error) return { error: error.message };
  revalidatePath("/workspace");
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
  const payload = t.id ? t : { ...t, id: undefined };
  const { error } = await supabase.from("playbook_tasks").upsert(payload);
  if (error) return { error: error.message };
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

export async function deleteConnection(connectionId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from("connections").delete().eq("id", connectionId);
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
