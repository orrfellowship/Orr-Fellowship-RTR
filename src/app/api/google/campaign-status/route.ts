import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getAuthenticatedRtrAdmin } from "@/lib/gmail/server";
import { maskDemoRecipient } from "@/lib/gmail/demo-campaign";

export const runtime = "nodejs";

// Live progress for a queued campaign — polled by the "Sending…" screen until
// the queue drains. RLS on outreach_campaigns/outreach_sends scopes reads to
// the campaign's own creator (admins may see all), so a fellow can only watch
// their own campaigns.

const recipientStatus = (status: string): "sent" | "failed" | "excluded" | "pending" =>
  status === "sent" ? "sent"
  : status === "failed" ? "failed"
  : status === "skipped_dnc" || status === "skipped_quota" ? "excluded"
  : "pending";

export async function GET(request: Request) {
  const user = await getAuthenticatedRtrAdmin();
  if (!user) return NextResponse.json({ success: false, error: { code: "forbidden", message: "Admin access required." } }, { status: 403, headers: { "Cache-Control": "private, no-store" } });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: { code: "missing_id", message: "Campaign id is required." } }, { status: 400, headers: { "Cache-Control": "private, no-store" } });

  const supabase = await createServerSupabase();
  const { data: campaign } = await supabase.from("outreach_campaigns").select("id, status, total_count").eq("id", id).maybeSingle();
  if (!campaign) return NextResponse.json({ success: false, error: { code: "not_found", message: "Campaign not found." } }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

  const { data: sendRows } = await supabase.from("outreach_sends").select("to_email, status, error, gmail_message_id").eq("campaign_id", id);
  const rows = sendRows ?? [];
  const count = (s: string) => rows.filter((r) => (r as any).status === s).length;
  const pending = count("queued");
  const sent = count("sent");
  const failed = count("failed");
  const skipped = count("skipped_dnc") + count("skipped_quota");

  const recipients = rows.map((r) => {
    const status = recipientStatus((r as any).status);
    return {
      candidateName: maskDemoRecipient((r as any).to_email) ?? (r as any).to_email,
      maskedRecipient: null,
      status,
      messageId: (r as any).gmail_message_id ?? undefined,
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
