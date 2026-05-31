import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const type = searchParams.get("type");

  if (code) {
    const supabase = createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }

  // After accepting an invite or clicking a password-reset link, send the user
  // to the set-password page so they can establish/update their password.
  if (type === "invite" || type === "recovery") {
    return NextResponse.redirect(new URL("/auth/set-password", request.url));
  }

  return NextResponse.redirect(new URL("/", request.url));
}
