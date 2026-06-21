import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

// Establishes the session from an admin-generated invite link, then sends the
// user to set their password. Prefers the token_hash flow (verifyOtp) since
// admin-generated links can't use PKCE code exchange; falls back to ?code= for
// any links still in flight.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token_hash = params.get("token_hash");
  const type = (params.get("type") as EmailOtpType | null) ?? "invite";
  const code = params.get("code");

  const supabase = createServerSupabase();
  let error = null;
  if (token_hash) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash }));
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    error = new Error("missing token");
  }
  // Don't drop a failed verify on set-password (no session -> "Auth session
  // missing"); send them somewhere that explains how to get a fresh link.
  if (error) {
    return NextResponse.redirect(new URL(`/auth/link-expired?type=${type}`, request.url));
  }
  return NextResponse.redirect(new URL("/auth/set-password", request.url));
}
