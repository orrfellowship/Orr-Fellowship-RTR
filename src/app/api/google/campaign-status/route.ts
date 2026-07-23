import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { maskDemoRecipient } from "@/lib/gmail/demo-campaign";
import { isAdminPlus } from "@/lib/types";

export const runtime = "nodejs";

// Live progress for a campaign — polled by the "Sending…" screen and the
// campaign-history "view" action. Any signed-in user may call it; RLS on
// outreach_campaigns/outreach_sends scopes reads to the campaign's own creator
// (admins may see all), so a fellow only ever sees their own campaigns.

export const recipientStatus = (status: string): "sent" | "failed" | "excluded" | "pending" =>
  status === "sent" ? "sent"
  : status === "failed" ? "failed"
  : status === "skipped_dnc" || status === "skipped_quota" || status === "canceled" ? "excluded"
  : "pending";

export async function GET(request: Request) {
  const user = await getCurrentProfile();
  if (!user) return NextResponse.json({ success: false, error: { code: "forbidden", message: "Sign in required." } }, { status: 403, headers: { "Cache-Control": "private, no-store" } });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: { code: "missing_id", message: "Campaign id is required." } }, { status: 400, headers: { "Cache-Control": "private, no-store" } });

  const supabase = await createServerSupabase();
  const { data: campaign, error: campaignError } = await supabase.from("outreach_campaigns").select("id, status, total_count").eq("id", id).maybeSingle();
  if (campaignError) return NextResponse.json({ success: false, error: { code: "status_unavailable", message: "Campaign status is temporarily unavailable." } }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  if (!campaign) return NextResponse.json({ success: false, error: { code: "not_found", message: "Campaign not found." } }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

  const { data: sendRows, error: sendsError } = await supabase.from("outreach_sends").select("to_email, status, error, gmail_message_id, replied_at, bounced_at").eq("campaign_id", id);
  if (sendsError) return NextResponse.json({ success: false, error: { code: "status_unavailable", message: "Recipient status is temporarily unavailable." } }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  const rows = sendRows ?? [];
  const count = (s: string) => rows.filter((r) => (r as any).status === s).length;
  const pending = count("queued");
  const sent = count("sent");
  const failed = count("failed");
  const skipped = count("skipped_dnc") + count("skipped_quota") + count("canceled");

  const recipients = rows.map((r) => {
    const status = recipientStatus((r as any).status);
    const recipientEmail = (r as any).to_email as string;
    return {
      candidateName: isAdminPlus(user.role)
        ? recipientEmail
        : maskDemoRecipient(recipientEmail) ?? recipientEmail,
      maskedRecipient: null,
      status,
      messageId: (r as any).gmail_message_id ?? undefined,
      replied: !!(r as any).replied_at,
      bounced: !!(r as any).bounced_at,
      failureReason: status === "failed" ? ((r as any).error ?? "Send failed") : undefined,
      exclusionReason: status === "excluded" ? ((r as any).error ?? "Skipped") : undefined,
    };
  });

  return NextResponse.json({
    success: true,
    status: (campaign as any).status as string,   // queued | sending | sent | partial | failed
    total: (campaign as any).total_count as number,
    sent, failed, skipped, pending,
    done: pending === 0,
    recipients,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
