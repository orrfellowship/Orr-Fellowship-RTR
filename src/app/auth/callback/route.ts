import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isSuper } from "@/lib/types";

const JAZZ_BASE = "https://api.resumatorapi.com/v1";

// POST /api/sync   body: { mode: "full" | "refresh" }
//  full     → initial pull of all applicants
//  refresh  → weekly: add new applicants + re-sync stages on existing ones
//
// SECURITY: super-admin only. The JazzHR key lives in a server env var and is
// never sent to the browser. The browser calls THIS endpoint, not JazzHR.
export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) {
    return NextResponse.json({ error: "Forbidden — super-admin only" }, { status: 403 });
  }

  const apiKey = process.env.JAZZHR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "JAZZHR_API_KEY not configured" }, { status: 500 });
  }

  const { mode = "refresh" } = await request.json().catch(() => ({ mode: "refresh" }));
  const db = createServiceClient(); // bypasses RLS — trusted server context

  // 1. page through JazzHR applicants (100/page until a short page)
  const applicants: any[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${JAZZ_BASE}/applicants/page/${page}?apikey=${apiKey}`);
    if (res.status === 429) {
      // rate limited — back off briefly and retry the same page
      await new Promise((r) => setTimeout(r, 2000));
      page--;
      continue;
    }
    if (!res.ok) {
      return NextResponse.json({ error: `JazzHR ${res.status}` }, { status: 502 });
    }
    const batch = await res.json();
    const arr = Array.isArray(batch) ? batch : [];
    applicants.push(...arr);
    if (arr.length < 100) break; // last page
  }

  // 2. map JazzHR → our candidate shape (stage = source of truth on applicant)
  const rows = applicants.map((a) => ({
    jazz_id: a.id,
    name: [a.first_name, a.last_name].filter(Boolean).join(" ") || a.name || "Unknown",
    email: a.email ?? null,
    stage: a.workflow_step ?? a.prospect ?? null,
    university_raw: a.university ?? null,
    linkedin: a.linkedin ?? null,
    resume_link: a.resume ?? null,
    source: "jazzhr" as const,
  }));

  // 3. upsert on jazz_id. On "refresh" we still upsert all rows, but the
  //    unique jazz_id means existing candidates get their stage updated in
  //    place rather than duplicated — exactly the weekly re-sync behavior.
  //    (Field-level "don't clobber fellow edits" handled later via a merge view.)
  let written = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await db
      .from("candidates")
      .upsert(chunk, { onConflict: "jazz_id" });
    if (error) {
      return NextResponse.json({ error: error.message, writtenSoFar: written }, { status: 500 });
    }
    written += chunk.length;
  }

  // 4. record the sync run
  await db.from("sync_meta").upsert(
    { id: 1, last_sync: new Date().toISOString(), total_cached: rows.length, last_status: `${mode} ok` },
    { onConflict: "id" }
  );

  return NextResponse.json({ ok: true, mode, fetched: rows.length, written });
}

// GET /api/sync  → list JazzHR jobs (read-only diagnostic, writes nothing).
// Confirms the API key works and shows job IDs so the scoped sync can target one.
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) {
    return NextResponse.json({ error: "Forbidden — super-admin only" }, { status: 403 });
  }
  const apiKey = process.env.JAZZHR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "JAZZHR_API_KEY not configured" }, { status: 500 });
  }

  const res = await fetch(`${JAZZ_BASE}/jobs?apikey=${apiKey}`);
  if (!res.ok) {
    return NextResponse.json({ error: `JazzHR ${res.status}` }, { status: 502 });
  }
  const data = await res.json();
  const arr = Array.isArray(data) ? data : [];
  // return a trimmed shape: id, title, status, and applicant count if present
  const jobs = arr.map((j: any) => ({
    id: j.id,
    title: j.title ?? j.name ?? "(untitled)",
    status: j.status ?? null,
    city: j.city ?? null,
  }));
  return NextResponse.json({ ok: true, count: jobs.length, jobs });
}
