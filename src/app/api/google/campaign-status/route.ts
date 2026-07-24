import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { getTierSchoolIds } from "@/lib/queries";
import { maskDemoRecipient } from "@/lib/gmail/demo-campaign";
import { isAdminPlus } from "@/lib/types";

export const runtime = "nodejs";

// Live progress for a campaign — polled by the "Sending…" screen and the
// campaign-history "view" action. Authorization is explicit: a fellow sees only
// their own campaigns; a team lead also sees their whole tier team's; admins see
// all. (Uses the service client, so the check below is the gate — keep it tight.)

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

  const supabase = createServiceClient();
  const notFound = () => NextResponse.json({ success: false, error: { code: "not_found", message: "Campaign not found." } }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const { data: campaign, error: campaignError } = await supabase.from("outreach_campaigns").select("id, status, total_count, created_by").eq("id", id).maybeSingle();
  if (campaignError) return NextResponse.json({ success: false, error: { code: "status_unavailable", message: "Campaign status is temporarily unavailable." } }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  if (!campaign) return notFound();

  // Explicit authorization (service client bypasses RLS).
  const creatorId = (campaign as any).created_by as string | null;
  let allowed = isAdminPlus(user.role) || creatorId === user.id;
  if (!allowed && user.role === "team_lead" && creatorId) {
    const { ids } = await getTierSchoolIds(user.school_id);
    if (ids.length) {
      const { data: creator } = await supabase.from("profiles").select("school_id").eq("id", creatorId).maybeSingle();
      allowed = !!creator && ids.includes((creator as any).school_id);
    }
  }
  if (!allowed) return notFound();

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
