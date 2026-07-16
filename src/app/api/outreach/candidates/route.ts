import { NextResponse, after } from "next/server";
import { getCurrentProfile, isPreviewing } from "@/lib/auth";
import { GmailTestSendError, safeTestSendError } from "@/lib/gmail/test-send.server";
import { validateOutreachInput, enqueueCandidateCampaign } from "@/lib/gmail/candidate-outreach.server";
import { drainOutreachQueue } from "@/lib/gmail/outreach-queue.server";

export const runtime = "nodejs";

// Live outreach to real candidates. Sender + role come from the session; a
// fellow can only email their own assignments (enforced in the engine), admins
// can email any. Enqueues + pokes the drainer for instant first-send.

function err(e: GmailTestSendError) {
  return NextResponse.json(safeTestSendError(e), { status: e.status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  let sameOrigin = false;
  try {
    const origin = request.headers.get("origin");
    sameOrigin = !!origin && new URL(origin).origin === new URL(request.url).origin;
  } catch { sameOrigin = false; }
  if (!sameOrigin) return err(new GmailTestSendError("invalid_origin", "Invalid request origin.", 403));

  const profile = await getCurrentProfile();
  if (!profile) return err(new GmailTestSendError("forbidden", "Sign in to send outreach.", 403));
  if (await isPreviewing()) return err(new GmailTestSendError("preview_read_only", "Exit View As mode before sending.", 403));

  let body: unknown;
  try { body = await request.json(); }
  catch { return err(new GmailTestSendError("invalid_json", "Send a valid JSON request.", 400)); }

  try {
    const input = validateOutreachInput(body);
    const result = await enqueueCandidateCampaign(profile.id, profile.role, {
      campaignName: input.campaignName, subject: input.subject, body: input.body,
      selectedCandidateIds: input.ids, idempotencyKey: input.idempotencyKey,
    });
    after(() => drainOutreachQueue().catch((error) => console.error(JSON.stringify({ level: "error", event: "outreach_after_drain_failed", route: "candidates", message: error instanceof Error ? error.message : "Unknown error" }))));
    return NextResponse.json({
      success: true, campaignId: result.campaignId, total: result.queued + result.skippedDnc + result.skippedQuota + result.invalid,
      queued: result.queued, skippedDnc: result.skippedDnc, skippedQuota: result.skippedQuota, invalid: result.invalid,
      skippedUnassigned: result.skippedUnassigned, replayed: result.replayed,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return err(e instanceof GmailTestSendError ? e : new GmailTestSendError("enqueue_failed", "The campaign could not be queued.", 502));
  }
}
