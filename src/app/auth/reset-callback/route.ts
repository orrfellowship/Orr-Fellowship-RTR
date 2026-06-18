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

  const supabase = createServerSupabase();
  if (token_hash) {
    await supabase.auth.verifyOtp({ type, token_hash });
  } else if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/auth/set-password", request.url));
}
