import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/", request.url));
}
