"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

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

export async function addConnection(candidateId: string, relationship: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.from("connections").upsert({ fellow_id: user.id, candidate_id: candidateId, relationship });
  if (error) return { error: error.message };
  revalidatePath("/console");
  return { ok: true };
}
