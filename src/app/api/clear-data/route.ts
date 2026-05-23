import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isSuper } from "@/lib/types";

// POST /api/clear-data   body: { confirm: "DELETE ALL CANDIDATES" }
//
// Wipes candidate data so you can re-sync against a clean slate. Requires:
//   1. super-admin
//   2. the EXACT confirmation phrase in the body
// Both must hold or it refuses. Schools, profiles, playbook, and goals are
// left untouched — only candidates and their dependent rows are removed.
const CONFIRM_PHRASE = "DELETE ALL CANDIDATES";

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) {
    return NextResponse.json({ error: "Forbidden — super-admin only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== CONFIRM_PHRASE) {
    return NextResponse.json(
      { error: `Confirmation failed. Send { confirm: "${CONFIRM_PHRASE}" } to proceed.` },
      { status: 400 }
    );
  }

  const db = createServiceClient();

  // Count first so we can report what was removed.
  const { count: before } = await db
    .from("candidates")
    .select("*", { count: "exact", head: true });

  // candidate_ai, outreach_log, favorites, connections all FK-cascade on
  // candidate delete (ON DELETE CASCADE in the schema), so deleting candidates
  // cleans them up too. Delete all rows.
  const { error } = await db
    .from("candidates")
    .delete()
    .not("id", "is", null); // matches every row

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // reset the sync bookkeeping
  await db
    .from("sync_meta")
    .upsert({ id: 1, last_sync: null, total_cached: 0, last_status: "cleared" }, { onConflict: "id" });

  return NextResponse.json({ ok: true, deleted: before ?? 0 });
}
