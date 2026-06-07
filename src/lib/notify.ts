import { createServiceClient } from "@/lib/supabase/server";

// In-app + email notification queue. Rows are inserted here (optionally with a
// future `send_after`); the /api/cron route later emails any that are due.
// Always written with the service client (trusted server code only).

export type NotificationType =
  | "claim_followup"   // 30-min nudge after a candidate is assigned to you
  | "no_contact"       // daily digest: candidate you own has gone quiet
  | "applied"          // daily digest: a candidate you own applied
  | "weekly_snapshot"  // weekly nudge to check your snapshot
  | "tagged"           // someone tagged you on a warm intro (Phase 4)
  | "event_reminder";  // day-before reminder for an "attend" event

export async function queueNotification(n: {
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  candidateId?: string | null;
  sendAfter?: Date | null;
  dedupeKey?: string | null;
}): Promise<{ ok: boolean; skipped?: boolean }> {
  const db = createServiceClient();

  // Dedupe: don't re-queue an identical pending notification.
  if (n.dedupeKey) {
    const { data: existing } = await db
      .from("notifications")
      .select("id")
      .eq("recipient_id", n.recipientId)
      .eq("dedupe_key", n.dedupeKey)
      .is("emailed_at", null)
      .eq("superseded", false)
      .limit(1);
    if (existing && existing.length) return { ok: true, skipped: true };
  }

  const { error } = await db.from("notifications").insert({
    recipient_id: n.recipientId,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link ?? null,
    candidate_id: n.candidateId ?? null,
    send_after: (n.sendAfter ?? new Date()).toISOString(),
    dedupe_key: n.dedupeKey ?? null,
  });
  return { ok: !error };
}

// Cancel pending (unsent) notifications — used when a claim is reassigned before
// its 30-minute delay elapses, so the stale nudge never sends.
export async function supersedePending(opts: { candidateId: string; type: NotificationType; exceptRecipientId?: string }) {
  const db = createServiceClient();
  let q = db.from("notifications").update({ superseded: true })
    .eq("candidate_id", opts.candidateId)
    .eq("type", opts.type)
    .is("emailed_at", null)
    .eq("superseded", false);
  if (opts.exceptRecipientId) q = q.neq("recipient_id", opts.exceptRecipientId);
  await q;
}
