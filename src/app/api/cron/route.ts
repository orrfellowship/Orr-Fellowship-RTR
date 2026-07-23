import { NextResponse, type NextRequest } from "next/server";
import { drainOutreachQueue } from "@/lib/gmail/outreach-queue.server";
import { pollRepliesAndBounces } from "@/lib/gmail/reply-tracking.server";

// Gmail campaign delivery remains isolated on the legacy route so the Phase 18
// Resend redesign cannot query, cap, claim, or otherwise affect outreach sends.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = new URL(req.url).searchParams.get("job");

  // Outreach send queue: drain a time-budgeted chunk of queued Gmail sends.
  // Scheduled every minute (db/phase16.sql) and also poked right after a
  // fellow enqueues a campaign, so the first messages leave within seconds.
  if (job === "outreach") {
    const requestId = req.headers.get("x-vercel-id") ?? crypto.randomUUID();
    const startedAt = Date.now();
    console.info(JSON.stringify({ level: "info", event: "outreach_cron_started", requestId }));
    try {
      const outreach = await drainOutreachQueue();
      console.info(JSON.stringify({ level: "info", event: "outreach_cron_completed", requestId, durationMs: Date.now() - startedAt, ...outreach }));
      return NextResponse.json({ ok: true, job, outreach });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "outreach_cron_failed", requestId, durationMs: Date.now() - startedAt, message: error instanceof Error ? error.message : "Unknown error" }));
      return NextResponse.json({ ok: false, job, error: "Outreach queue processing failed", requestId }, { status: 500 });
    }
  }

  // Reply + bounce detection over sent outreach (Phase 7, gmail.metadata scope).
  // Schedule every ~15 min via pg_cron (see db/phase17.sql).
  if (job === "gmail-sync") {
    const requestId = req.headers.get("x-vercel-id") ?? crypto.randomUUID();
    const startedAt = Date.now();
    console.info(JSON.stringify({ level: "info", event: "gmail_sync_started", requestId }));
    try {
      const tracking = await pollRepliesAndBounces();
      console.info(JSON.stringify({ level: "info", event: "gmail_sync_completed", requestId, durationMs: Date.now() - startedAt, ...tracking }));
      return NextResponse.json({ ok: true, job, tracking });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "gmail_sync_failed", requestId, durationMs: Date.now() - startedAt, message: error instanceof Error ? error.message : "Unknown error" }));
      return NextResponse.json({ ok: false, job, error: "Gmail metadata sync failed", requestId }, { status: 500 });
    }
  }

  // Legacy Resend jobs (flush/digest/test and the former default flush) are
  // intentionally unavailable even if an old pg_cron invocation survives.
  return NextResponse.json({ error: "Unknown cron job" }, { status: 404 });
}

export const GET = run;
export const POST = run;
