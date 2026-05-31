"use server";

import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";

export async function checkEmailAndSignIn(email: string, redirectTo: string) {
  const service = createServiceClient();
  const { data } = await service
    .from("profiles")
    .select("id, is_active")
    .eq("email", email)
    .single();

  if (!data) {
    return { error: "This email is not invited. Contact an admin to be added." };
  }
  if (!data.is_active) {
    return { error: "Your account is inactive. Contact an admin." };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });

  if (error) return { error: error.message };
  return { ok: true };
}
