import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== "string") return NextResponse.json({ ok: false, error: "missing_email" }, { status: 400 });

    const db = createServiceClient();
    const { data, error } = await db.from("profiles").select("id, is_active").eq("email", email).single();
    if (error || !data) return NextResponse.json({ ok: false, error: "not_invited" }, { status: 403 });
    if (!data.is_active) return NextResponse.json({ ok: false, error: "inactive" }, { status: 403 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
