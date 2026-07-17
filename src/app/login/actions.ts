"use server";

import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { transactionalIdempotencyKey } from "@/lib/email";
import { queueTransactionalEmail } from "@/lib/transactional/weekly-assignment-digest";

async function allowedProfile(email: string) {
  const service = createServiceClient();
  // Case-insensitive, trimmed match — auth stores emails lowercased, so a
  // mixed-case entry on the login/reset form must still resolve to the profile.
  const { data } = await service
    .from("profiles")
    .select("id, email, full_name, is_active")
    .ilike("email", email.trim())
    .maybeSingle();
  if (!data) return { error: "This email is not invited. Contact an admin to be added." };
  if (!data.is_active) return { error: "Your account is inactive. Contact an admin." };
  return { profile: data };
}

export async function signInWithEmailPassword(email: string, password: string) {
  const allowed = await allowedProfile(email);
  if ("error" in allowed) return { error: allowed.error };
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Invalid email or password." };
  return { ok: true };
}

export async function sendPasswordReset(email: string, redirectTo: string) {
  const allowed = await allowedProfile(email);
  if ("error" in allowed) return { error: allowed.error };
  // Generate a recovery link (admin) and deliver it via our transactional email path — same as
  // invites. The link carries a hashed token the reset-callback verifies with
  // verifyOtp(); the PKCE code-exchange flow doesn't work for emailed links.
  const service = createServiceClient();
  const { data, error } = await service.auth.admin.generateLink({ type: "recovery", email: email.trim() });
  if (error) return { error: error.message };
  const tokenHash = (data?.properties as any)?.hashed_token as string | undefined;
  if (!tokenHash) return { error: "Could not generate a reset link." };
  const link = `${redirectTo}?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
  const sent = await queueTransactionalEmail({
    recipientId: allowed.profile.id, recipientEmail: allowed.profile.email ?? email.trim(), recipientName: allowed.profile.full_name,
    subject: "Reset your Orr Recruiting password", heading: "Reset your password",
    body: "We received a request to reset your password. This link is single-use and will expire. If you didn't request this, you can ignore this email.",
    ctaLabel: "Set a new password", ctaUrl: link,
    idempotencyKey: transactionalIdempotencyKey("password-reset", tokenHash),
  });
  if (!sent.ok) return { error: `Couldn't queue the reset email (${sent.error}).` };
  return { ok: true };
}
