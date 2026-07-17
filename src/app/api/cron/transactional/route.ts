import { NextResponse, type NextRequest } from "next/server";
import { runWeeklyAssignmentDigest } from "@/lib/transactional/weekly-assignment-digest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "true";
  try {
    const result = await runWeeklyAssignmentDigest({ dryRun });
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
