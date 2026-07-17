import { NextResponse, type NextRequest } from "next/server";
import {
  parseDryRunPreviewAt,
  runWeeklyAssignmentDigest,
} from "@/lib/transactional/weekly-assignment-digest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const searchParams = new URL(req.url).searchParams;
  const dryRun = searchParams.get("dryRun") === "true";
  const previewAtInput = searchParams.get("previewAt");
  if (previewAtInput && !dryRun) {
    return NextResponse.json({ error: "previewAt requires dryRun=true" }, { status: 400 });
  }
  const previewAt = previewAtInput ? parseDryRunPreviewAt(previewAtInput) : null;
  if (previewAtInput && !previewAt) {
    return NextResponse.json({ error: "previewAt must be a Monday 08:00 America/New_York ISO timestamp" }, { status: 400 });
  }
  try {
    const result = await runWeeklyAssignmentDigest({ dryRun, now: previewAt ?? undefined });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const requestId = req.headers.get("x-vercel-id") ?? crypto.randomUUID();
    console.error(JSON.stringify({
      level: "error", event: "transactional_cron_failed", worker: "weekly-assignment-digest",
      requestId, errorCategory: "unexpected_route_failure",
      message: error instanceof Error ? error.message.slice(0, 1000) : "Unknown error",
    }));
    return NextResponse.json({ ok: false, error: "Transactional worker failed", requestId }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
