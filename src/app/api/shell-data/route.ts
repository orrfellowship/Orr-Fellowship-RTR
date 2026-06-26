import { NextResponse } from "next/server";
import { resolveViewer } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isAdminPlus } from "@/lib/types";
import { loadNavData } from "@/lib/nav/thisWeek";

export const dynamic = "force-dynamic";

export async function GET() {
  const { profile, real } = await resolveViewer();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceClient();
  const canViewAs = !!real && isAdminPlus(real.role);

  const [{ data: notifications }, navData, peopleRes] = await Promise.all([
    db.from("notifications")
      .select("id, type, title, body, link, read, created_at")
      .eq("recipient_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(30),
    loadNavData(profile),
    canViewAs
      ? db.from("profiles").select("id, full_name, role").eq("is_active", true).order("full_name")
      : Promise.resolve({ data: [] as any[] }),
  ]);

  return NextResponse.json({
    badges: navData.badges,
    thisWeek: navData.thisWeek,
    notifications: notifications ?? [],
    viewAsPeople: peopleRes.data ?? [],
  });
}
