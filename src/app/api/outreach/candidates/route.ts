import { NextResponse, after } from "next/server";
import { getCurrentProfile, isPreviewing } from "@/lib/auth";
import { GmailTestSendError, safeTestSendError } from "@/lib/gmail/test-send.server";
import { candidateOutreachSendingEnabled, validateOutreachInput, enqueueCandidateCampaign } from "@/lib/gmail/candidate-outreach.server";
import { resolveCampaignContent } from "@/lib/gmail/outreach-templates.server";
import { drainOutreachQueue } from "@/lib/gmail/outreach-queue.server";

export const runtime = "nodejs";

// Live outreach to real candidates. Sender + role come from the session.
// Fellows and team leads may enqueue assigned candidates; assignment and
// admin-template checks remain enforced by the server-side send pipeline.

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
  if (!candidateOutreachSendingEnabled(profile.role)) {
    return err(new GmailTestSendError("outreach_disabled", "Sending is not enabled for fellows or team leads yet.", 403));
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return err(new GmailTestSendError("invalid_json", "Send a valid JSON request.", 400)); }

  try {
    const input = validateOutreachInput(body);
    // Template enforcement: fellows/leads MUST send from an admin template.
    // They may edit its prefilled subject/body, while attachments still come
    // only from the server-side template snapshot.
    const content = await resolveCampaignContent(profile.role, {
      subject: input.subject,
      body: input.body,
    }, input.templateId, input.replacements);
    const result = await enqueueCandidateCampaign(profile.id, profile.role, {
      campaignName: input.campaignName, subject: content.subject, body: content.body,
      selectedCandidateIds: input.ids, idempotencyKey: input.idempotencyKey,
      templateId: content.templateId, attachments: content.attachments,
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
