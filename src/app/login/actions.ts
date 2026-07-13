"use server";

import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import { sendEmail, emailLayout } from "@/lib/email";

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
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Invalid email or password." };
  return { ok: true };
}

export async function sendPasswordReset(email: string, redirectTo: string) {
  const blocked = await checkProfileAllowed(email);
  if (blocked) return { error: blocked };
  // Generate a recovery link (admin) and deliver it via our SMTP — same as
  // invites. The link carries a hashed token the reset-callback verifies with
  // verifyOtp(); the PKCE code-exchange flow doesn't work for emailed links.
  const service = createServiceClient();
  const { data, error } = await service.auth.admin.generateLink({ type: "recovery", email: email.trim() });
  if (error) return { error: error.message };
  const tokenHash = (data?.properties as any)?.hashed_token as string | undefined;
  if (!tokenHash) return { error: "Could not generate a reset link." };
  const link = `${redirectTo}?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
  const html = emailLayout({
    heading: "Reset your password",
    intro: "We received a request to reset your Orr Recruiting password.",
    bodyHtml: "Click below to choose a new password. This link is single-use and will expire. If you didn't request this, you can ignore this email.",
    ctaLabel: "Set a new password",
    ctaUrl: link,
  });
  const sent = await sendEmail({ to: email.trim(), subject: "Reset your Orr Recruiting password", html });
  if (!sent.ok) return { error: `Couldn't send the reset email (${sent.error}).` };
  return { ok: true };
}
