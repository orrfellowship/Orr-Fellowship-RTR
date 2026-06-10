"use server";

import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";

async function checkProfileAllowed(email: string) {
  const service = createServiceClient();
  // Case-insensitive, trimmed match — auth stores emails lowercased, so a
  // mixed-case entry on the login/reset form must still resolve to the profile.
  const { data } = await service
    .from("profiles")
    .select("id, is_active")
    .ilike("email", email.trim())
    .maybeSingle();
  if (!data) return "This email is not invited. Contact an admin to be added.";
  if (!data.is_active) return "Your account is inactive. Contact an admin.";
  return null;
}

export async function signInWithEmailPassword(email: string, password: string) {
  const blocked = await checkProfileAllowed(email);
  if (blocked) return { error: blocked };
  const supabase = createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Invalid email or password." };
  return { ok: true };
}

export async function sendPasswordReset(email: string, redirectTo: string) {
  const blocked = await checkProfileAllowed(email);
  if (blocked) return { error: blocked };
  const supabase = createServerSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  if (error) return { error: error.message };
  return { ok: true };
}
