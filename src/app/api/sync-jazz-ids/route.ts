import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isSuper } from "@/lib/types";
import { syncProspectMap } from "@/lib/jazzhr-sync-ids";
import { JazzAuthExpiredError } from "@/lib/jazzhr-client";

// POST: page through JazzHR /prospect and populate jazz_prospect_map (the
// string→numeric prospect bridge resume lookups depend on). Super-admin only.
export async function POST() {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) {
    return NextResponse.json({ error: "Forbidden — super-admin only" }, { status: 403 });
  }

  const ticket = process.env.JAZZHR_SANDCASTLE_TICKET;
  if (!ticket) {
    return NextResponse.json({ error: "JAZZHR_SANDCASTLE_TICKET not configured" }, { status: 500 });
  }

  try {
    const db = createServiceClient();
    const { synced, pages } = await syncProspectMap(ticket, db);
    return NextResponse.json({ ok: true, synced, pages });
  } catch (e: any) {
    if (e instanceof JazzAuthExpiredError) {
      return NextResponse.json({ error: e.message, needsRefresh: true }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
