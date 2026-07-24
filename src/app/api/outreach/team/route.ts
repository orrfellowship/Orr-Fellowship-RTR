import { NextResponse, after } from "next/server";
import { getCurrentProfile, isPreviewing } from "@/lib/auth";
import { isAdminPlus } from "@/lib/types";
import { GmailTestSendError, safeTestSendError } from "@/lib/gmail/test-send.server";
import { validateOutreachInput, enqueueUsersCampaign } from "@/lib/gmail/candidate-outreach.server";
import { resolveCampaignContent } from "@/lib/gmail/outreach-templates.server";
import { drainOutreachQueue } from "@/lib/gmail/outreach-queue.server";

export const runtime = "nodejs";

// Fellow-cohort send — ADMIN/SUPER ONLY. Sender/role come from the session;
// recipient IDs are resolved against classified fellow/team-lead profiles.

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
  if (!profile) return err(new GmailTestSendError("forbidden", "Sign in to send.", 403));
  if (!isAdminPlus(profile.role)) return err(new GmailTestSendError("forbidden", "Only an admin can email fellow cohorts.", 403));
  if (await isPreviewing()) return err(new GmailTestSendError("preview_read_only", "Exit View As mode before sending.", 403));

  let body: unknown;
  try { body = await request.json(); }
  catch { return err(new GmailTestSendError("invalid_json", "Send a valid JSON request.", 400)); }

  try {
    const input = validateOutreachInput(body);
    // This route is already admin-only; a template here just brings prefilled
    // content + its attachments along.
    const content = await resolveCampaignContent(profile.role, {
      subject: input.subject,
      body: input.body,
    }, input.templateId, input.replacements);
    const result = await enqueueUsersCampaign(profile.id, profile.role, {
      campaignName: input.campaignName, subject: content.subject, body: content.body,
      selectedUserIds: input.ids, idempotencyKey: input.idempotencyKey,
      templateId: content.templateId, attachments: content.attachments,
    });
    if (result.forbidden) return err(new GmailTestSendError("forbidden", "Only an admin can email fellow cohorts.", 403));
    after(() => drainOutreachQueue().catch((error) => console.error(JSON.stringify({ level: "error", event: "outreach_after_drain_failed", route: "team", message: error instanceof Error ? error.message : "Unknown error" }))));
    return NextResponse.json({
      success: true, campaignId: result.campaignId, total: result.queued + result.invalid,
      queued: result.queued, invalid: result.invalid, replayed: result.replayed,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return err(e instanceof GmailTestSendError ? e : new GmailTestSendError("enqueue_failed", "The campaign could not be queued.", 502));
  }
}
