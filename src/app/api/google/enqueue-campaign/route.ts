import { NextResponse, after } from "next/server";
import { isPreviewing } from "@/lib/auth";
import { getAuthenticatedRtrAdmin } from "@/lib/gmail/server";
import { GmailTestSendError, isGmailTestSendEnabled, safeTestSendError } from "@/lib/gmail/test-send.server";
import { validateDemoCampaignInput, prepareDemoEnqueueRecipients, parseTestRecipients } from "@/lib/gmail/demo-campaign.server";
import { enqueueOutreachCampaign, drainOutreachQueue } from "@/lib/gmail/outreach-queue.server";

export const runtime = "nodejs";

// Queue-based demo campaign: resolve the selected fictional candidates into
// ready-to-send rows, ENQUEUE them, and return immediately. The drainer is
// poked once here (after the response) so the first messages go out within
// seconds; db/phase16.sql's every-minute cron is the backstop that finishes
// the batch after the fellow has walked away.
//
// Real recipient addresses come from GMAIL_TEST_RECIPIENTS (server env), never
// the request body or the repo — so a tester can point this at real inboxes
// without committing addresses. Same gates as the synchronous smoke test
// (feature flag, same-origin, active admin, not previewing).

function jsonError(error: GmailTestSendError) {
  return NextResponse.json(safeTestSendError(error), { status: error.status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isGmailTestSendEnabled({
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_GMAIL_TEST_SEND: process.env.ENABLE_GMAIL_TEST_SEND,
    ENABLE_GMAIL_PRODUCTION_TEST_SEND: process.env.ENABLE_GMAIL_PRODUCTION_TEST_SEND,
  })) {
    return jsonError(new GmailTestSendError("feature_disabled", "Controlled Gmail campaign testing is disabled.", 404));
  }

  let sameOrigin = false;
  try {
    const origin = request.headers.get("origin");
    sameOrigin = !!origin && new URL(origin).origin === new URL(request.url).origin;
  } catch { sameOrigin = false; }
  if (!sameOrigin) return jsonError(new GmailTestSendError("invalid_origin", "Invalid request origin.", 403));

  const user = await getAuthenticatedRtrAdmin();
  if (!user) return jsonError(new GmailTestSendError("forbidden", "Active Admin or Super Admin access is required.", 403));
  if (await isPreviewing()) return jsonError(new GmailTestSendError("preview_read_only", "Exit View As mode before sending a Gmail campaign.", 403));

  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonError(new GmailTestSendError("invalid_json", "Send a valid JSON request.", 400)); }

  try {
    const input = validateDemoCampaignInput(body); // throws GmailTestSendError on bad input
    const testRecipients = parseTestRecipients(process.env.GMAIL_TEST_RECIPIENTS);
    const { recipients, excluded } = prepareDemoEnqueueRecipients(input, testRecipients);
    if (!recipients.length) {
      return jsonError(new GmailTestSendError("missing_recipients", "No selected mock candidates are eligible to email.", 400));
    }

    // senderUserId comes from the session (user.id) — never the request body.
    const result = await enqueueOutreachCampaign(user.id, {
      campaignName: input.campaignName, subject: input.subject, body: input.body,
      recipients, idempotencyKey: input.idempotencyKey,
    });

    // Start sending now (post-response) so the fellow sees progress immediately.
    after(() => drainOutreachQueue().catch(() => { /* cron backstop finishes it */ }));

    return NextResponse.json({
      success: true,
      campaignId: result.campaignId,
      total: recipients.length,
      queued: result.queued,
      invalid: result.invalid,
      replayed: result.replayed,
      excluded: excluded.map((e) => ({ candidateName: e.candidateName, maskedRecipient: e.maskedRecipient, exclusionReason: e.exclusionReason })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const known = error instanceof GmailTestSendError
      ? error
      : new GmailTestSendError("campaign_enqueue_failed", "The campaign could not be queued.", 502);
    return jsonError(known);
  }
}
