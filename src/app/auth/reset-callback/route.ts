import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

// Establishes the session from a password-reset link, then sends the user to
// set a new password. Prefers token_hash (verifyOtp); falls back to ?code=.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token_hash = params.get("token_hash");
  const type = (params.get("type") as EmailOtpType | null) ?? "recovery";
  const code = params.get("code");

  const supabase = await createServerSupabase();
  let error = null;
  if (token_hash) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash }));
  } else if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    error = new Error("missing token");
  }
  // A failed verify (expired/used token) would otherwise land on set-password
  // with no session -> "Auth session missing". Redirect to a recoverable page.
  if (error) {
    return NextResponse.redirect(new URL(`/auth/link-expired?type=${type}`, request.url));
  }
  return NextResponse.redirect(new URL("/auth/set-password", request.url));
}
