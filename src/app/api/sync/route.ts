import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isSuper } from "@/lib/types";
import { mostAdvancedStage, routeToSchoolName } from "@/lib/stages";

const JAZZ_BASE = "https://api.resumatorapi.com/v1";
const TARGET_JOB = "10815185"; // TEST Orr Fellowship 2027 — Early Career Dev Program

// ---- helpers ----------------------------------------------------------------
async function jazzGet(path: string, apiKey: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${JAZZ_BASE}${path}${path.includes("?") ? "&" : "?"}apikey=${apiKey}`);
    if (res.status === 429) {
      // rate limited — JazzHR window is ~62s
      await new Promise((r) => setTimeout(r, 62000));
      continue;
    }
    if (!res.ok) throw new Error(`JazzHR ${res.status} on ${path}`);
    return res.json();
  }
  throw new Error(`JazzHR repeatedly rate-limited on ${path}`);
}

// pull a questionnaire answer by exact question string
function q(detail: any, question: string): string | null {
  const arr = Array.isArray(detail?.questionnaire) ? detail.questionnaire : [];
  const hit = arr.find((x: any) => x?.question === question);
  return hit?.answer ?? null;
}

// map a JazzHR applicant detail → our candidate row
function mapDetail(d: any) {
  const jobs = Array.isArray(d?.jobs) ? d.jobs : [];
  const progresses = jobs.map((j: any) => j?.applicant_progress).filter(Boolean);
  const stage = mostAdvancedStage(progresses);
  const bestJob = jobs.find((j: any) => j?.applicant_progress && stageMatches(j.applicant_progress, stage));
  const university = q(d, "University");
  return {
    jazz_id: d.id,
    name: [d.first_name, d.last_name].filter(Boolean).join(" ") || "Unknown",
    email: d.email ?? null,
    phone: d.phone ?? null,
    apply_date: d.apply_date ?? null,
    linkedin: d.linkedin_url ?? null,
    resume_link: d.resume_link ?? null,
    stage,
    job_title: bestJob?.job_title ?? null,
    university_raw: university,
    gpa: q(d, "Grade Point Average (GPA)"),
    grad_date: q(d, "Expected Graduation Date"),
    area_of_study: q(d, "Area of Study"),
    source: "jazzhr" as const,
    // NB: point_person, notes, AI fields, favorites, not_interested are
    // NEVER written by sync — they're local-only. Upsert only touches the
    // columns above, leaving those intact on existing rows.
  };
}
function stageMatches(progress: string, stage: string | null): boolean {
  return stage != null && progress.toLowerCase().trim() === stage;
}

// ---- POST: scoped, checkpointed sync ---------------------------------------
// body: { mode: "full" | "refresh", batch?: number }
//  Processes applicants for TARGET_JOB. Fetches detail 3-at-a-time, writes each
//  batch immediately (checkpointed), records progress in sync_meta so a timed-out
//  run can be re-triggered and continue. jazz_id upsert makes re-runs safe.
export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) {
    return NextResponse.json({ error: "Forbidden — super-admin only" }, { status: 403 });
  }
  const apiKey = process.env.JAZZHR_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "JAZZHR_API_KEY not configured" }, { status: 500 });

  const { mode = "full" } = await request.json().catch(() => ({ mode: "full" }));
  const db = createServiceClient();

  // 1. applicant stubs for the target job.
  //    JazzHR's ?job_id= filter is unreliable, so we page through the
  //    applicants2jobs mapping and filter to TARGET_JOB ourselves.
  let stubs: { id: string }[];
  try {
    const matched = new Set<string>();
    for (let page = 1; page <= 30; page++) {
      const raw = await jazzGet(`/applicants2jobs/page/${page}`, apiKey);
      const arr = Array.isArray(raw) ? raw : [];
      for (const x of arr) {
        const jid = String(x.job_id ?? "");
        const aid = x.applicant_id ?? x.id;
        if (jid === TARGET_JOB && aid) matched.add(String(aid));
      }
      if (arr.length < 100) break; // last page
    }
    stubs = Array.from(matched).map((id) => ({ id }));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  // 2. checkpoint: skip applicants already synced when in "refresh"; in "full"
  //    we still upsert everyone (cheap, and refreshes stages).
  let toProcess = stubs;
  if (mode === "refresh") {
    const { data: existing } = await db.from("candidates").select("jazz_id");
    const have = new Set((existing ?? []).map((c) => c.jazz_id));
    toProcess = stubs.filter((s) => !have.has(s.id));
  }

  // 3. fetch detail 3-at-a-time, map + route, write each batch immediately
  let written = 0, routed = 0, unrouted = 0, failed = 0;
  const CONC = 3;
  // soft time budget so we return before the function is killed; re-trigger continues
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 50_000;

  for (let i = 0; i < toProcess.length; i += CONC) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      await db.from("sync_meta").upsert(
        { id: 1, last_sync: new Date().toISOString(), total_cached: written, last_status: `${mode} partial — re-run to continue` },
        { onConflict: "id" }
      );
      return NextResponse.json({ ok: true, mode, partial: true, written, routed, unrouted, failed, remaining: toProcess.length - i });
    }
    const slice = toProcess.slice(i, i + CONC);
    const details = await Promise.all(
      slice.map((s) => jazzGet(`/applicants/${s.id}`, apiKey).catch(() => null))
    );
    const rows = [] as any[];
    for (const d of details) {
      if (!d) { failed++; continue; }
      const row = mapDetail(d);
      const schoolName = routeToSchoolName(row.university_raw);
      let school_id: string | null = null;
      if (schoolName) {
        const { data: sch } = await db.from("schools").select("id").eq("name", schoolName).maybeSingle();
        school_id = sch?.id ?? null;
      }
      if (school_id) routed++; else unrouted++;
      rows.push({ ...row, school_id });
    }
    if (rows.length) {
      const { error } = await db.from("candidates").upsert(rows, { onConflict: "jazz_id" });
      if (error) return NextResponse.json({ error: error.message, writtenSoFar: written }, { status: 500 });
      written += rows.length;
    }
  }

  await db.from("sync_meta").upsert(
    { id: 1, last_sync: new Date().toISOString(), total_cached: written, last_status: `${mode} complete` },
    { onConflict: "id" }
  );
  return NextResponse.json({ ok: true, mode, partial: false, written, routed, unrouted, failed });
}

// ---- GET: list jobs, or ?debug=1 to inspect the target-job mapping ----------
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) {
    return NextResponse.json({ error: "Forbidden — super-admin only" }, { status: 403 });
  }
  const apiKey = process.env.JAZZHR_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "JAZZHR_API_KEY not configured" }, { status: 500 });

  // debug: how many applicants2jobs rows match TARGET_JOB vs total seen
  if (request.nextUrl.searchParams.get("debug") === "1") {
    try {
      let total = 0, matched = 0;
      const sampleJobIds = new Set<string>();
      for (let page = 1; page <= 30; page++) {
        const raw = await jazzGet(`/applicants2jobs/page/${page}`, apiKey);
        const arr = Array.isArray(raw) ? raw : [];
        for (const x of arr) {
          total++;
          const jid = String(x.job_id ?? "");
          sampleJobIds.add(jid);
          if (jid === TARGET_JOB) matched++;
        }
        if (arr.length < 100) break;
      }
      return NextResponse.json({
        ok: true, target_job: TARGET_JOB, total_mappings_seen: total,
        matched_for_target: matched, distinct_job_ids: Array.from(sampleJobIds).slice(0, 25),
      });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
  }

  try {
    const data = await jazzGet(`/jobs`, apiKey);
    const arr = Array.isArray(data) ? data : [];
    const jobs = arr.map((j: any) => ({ id: j.id, title: j.title ?? j.name ?? "(untitled)", status: j.status ?? null, city: j.city ?? null }));
    return NextResponse.json({ ok: true, count: jobs.length, jobs });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
