import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isSuper } from "@/lib/types";
import { mostAdvancedStage, routeToSchoolName } from "@/lib/stages";

const JAZZ_BASE = "https://api.resumatorapi.com/v1";
const TARGET_JOB = "job_20260522153804_UPQZOUKTV6TQ5UB5"; // Orr Fellowship 2027 — Early Career Dev Program

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

// Pull a questionnaire answer — tries exact match first, then case-insensitive
// substring, so minor label differences in JazzHR don't silently drop data.
function q(detail: any, ...labels: string[]): string | null {
  const arr = Array.isArray(detail?.questionnaire) ? detail.questionnaire : [];
  for (const label of labels) {
    // exact match
    const exact = arr.find((x: any) => x?.question === label);
    if (exact?.answer) return exact.answer;
  }
  for (const label of labels) {
    // case-insensitive substring match
    const lower = label.toLowerCase();
    const fuzzy = arr.find((x: any) => typeof x?.question === "string" && x.question.toLowerCase().includes(lower));
    if (fuzzy?.answer) return fuzzy.answer;
  }
  return null;
}

// map a JazzHR applicant detail → our candidate row
function mapDetail(d: any) {
  const jobs = Array.isArray(d?.jobs) ? d.jobs : d?.jobs ? [d.jobs] : [];
  // Applicants are pre-filtered to TARGET_JOB via applicants2jobs, but their
  // detail may include other job entries (e.g., applied to a prior cohort too).
  // Read stage only from the TARGET_JOB entry; fall back to first job if absent.
  const targetJob = jobs.find((j: any) => j?.job_id === TARGET_JOB) ?? jobs[0] ?? null;
  const progressText = targetJob?.applicant_progress ?? "";
  const stage = mostAdvancedStage(progressText ? [progressText] : []) ?? "new";
  const university = q(d, "University", "University Name", "College", "School", "Institution", "College/University");
  return {
    jazz_id: d.id,
    name: [d.first_name, d.last_name].filter(Boolean).join(" ") || "Unknown",
    email: d.email ?? null,
    phone: d.phone ?? null,
    apply_date: d.apply_date ?? null,
    linkedin: d.linkedin_url ?? null,
    resume_link: d.resume_link ?? null,
    stage,
    job_title: targetJob?.job_title ?? null,
    university_raw: university,
    gpa: q(d, "Grade Point Average (GPA)", "GPA", "Grade Point Average"),
    grad_date: q(d, "Expected Graduation Date", "Graduation Date", "Expected Graduation"),
    area_of_study: q(d, "Area of Study", "Major", "Field of Study", "Degree"),
    source: "jazzhr" as const,
    // NB: point_person, notes, AI fields, favorites, not_interested are
    // NEVER written by sync — they're local-only. Upsert only touches the
    // columns above, leaving those intact on existing rows.
  };
}

// ---- matching helpers (link JazzHR applicants to existing candidates) -------
const normEmail = (e?: string | null) => (e ?? "").trim().toLowerCase();
const normPhone = (p?: string | null) => { const d = (p ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
const normName  = (n?: string | null) => (n ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Factual fields JazzHR owns (overwrites on link/refresh). Excludes `source`
// and all opinionated/local data (owner, notes, favorites, outreach, AI).
function factualFromMapped(m: ReturnType<typeof mapDetail>, school_id: string | null) {
  const f: Record<string, any> = {
    jazz_id: m.jazz_id, name: m.name, email: m.email, phone: m.phone,
    apply_date: m.apply_date, linkedin: m.linkedin, resume_link: m.resume_link,
    stage: m.stage, job_title: m.job_title, university_raw: m.university_raw,
    gpa: m.gpa, grad_date: m.grad_date, area_of_study: m.area_of_study,
  };
  if (school_id) f.school_id = school_id; // only set when JazzHR routes confidently
  return f;
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

  // 2. Build an in-memory matching index of existing candidates so each JazzHR
  //    applicant can be LINKED to a manually-entered/imported record instead of
  //    creating a duplicate. JazzHR is the source of truth for factual fields;
  //    local data (owner, notes, favorites, outreach, connections) is preserved.
  const { data: allCands } = await db.from("candidates").select("id, jazz_id, email, phone, name, school_id");
  const { data: schoolsData } = await db.from("schools").select("id, name");
  const schoolNameById = new Map((schoolsData ?? []).map((s: any) => [s.id, s.name as string]));
  const schoolIdByName = new Map((schoolsData ?? []).map((s: any) => [s.name as string, s.id as string]));
  const { data: reviewRows } = await db.from("jazz_match_review").select("jazz_applicant_id").eq("status", "pending");
  const reviewExisting = new Set((reviewRows ?? []).map((r: any) => String(r.jazz_applicant_id)));

  const linkedByJazz = new Map<string, string>(); // jazz_id -> candidate id
  type U = { id: string; email: string; phone: string; nameN: string; schoolName: string };
  const unlinked: U[] = [];
  for (const c of allCands ?? []) {
    if (c.jazz_id) { linkedByJazz.set(String(c.jazz_id), c.id); continue; }
    unlinked.push({
      id: c.id, email: normEmail(c.email), phone: normPhone(c.phone), nameN: normName(c.name),
      schoolName: c.school_id ? (schoolNameById.get(c.school_id) ?? "") : "",
    });
  }
  const consume = (id: string) => { const i = unlinked.findIndex((u) => u.id === id); if (i >= 0) unlinked.splice(i, 1); };

  // 3. checkpoint: in "refresh", skip applicants already linked (just new ones).
  let toProcess = stubs;
  if (mode === "refresh") toProcess = stubs.filter((s) => !linkedByJazz.has(String(s.id)));

  // 4. fetch detail 3-at-a-time, match → link / refresh / queue / import.
  let linked = 0, refreshed = 0, imported = 0, queued = 0, failed = 0;
  const CONC = 3;
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 50_000;

  const finish = (partial: boolean, remaining: number) =>
    NextResponse.json({ ok: true, mode, partial, linked, refreshed, imported, queued, failed, ...(partial ? { remaining } : {}) });

  for (let i = 0; i < toProcess.length; i += CONC) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      await db.from("sync_meta").upsert(
        { id: 1, last_sync: new Date().toISOString(), total_cached: linked + imported + refreshed, last_status: `${mode} partial — re-run to continue` },
        { onConflict: "id" }
      );
      return finish(true, toProcess.length - i);
    }
    const slice = toProcess.slice(i, i + CONC);
    const details = await Promise.all(slice.map((s) => jazzGet(`/applicants/${s.id}`, apiKey).catch(() => null)));
    for (const d of details) {
      if (!d) { failed++; continue; }
      const m = mapDetail(d);
      const jid = String(m.jazz_id);
      const routedSchool = routeToSchoolName(m.university_raw);
      const routedSchoolId = routedSchool ? (schoolIdByName.get(routedSchool) ?? null) : null;
      const factual = factualFromMapped(m, routedSchoolId);

      // a) already linked → refresh factual fields + stage
      const linkedId = linkedByJazz.get(jid);
      if (linkedId) {
        await db.from("candidates").update(factual).eq("id", linkedId);
        refreshed++;
        continue;
      }

      // b) confident match → link to the existing record
      const em = normEmail(m.email), ph = normPhone(m.phone), nm = normName(m.name);
      let match = em ? unlinked.find((u) => u.email && u.email === em) : undefined;
      if (!match && ph) match = unlinked.find((u) => u.phone && u.phone === ph);
      if (!match && nm && routedSchool) match = unlinked.find((u) => u.nameN === nm && u.schoolName === routedSchool);
      if (match) {
        await db.from("candidates").update(factual).eq("id", match.id);
        linkedByJazz.set(jid, match.id);
        consume(match.id);
        linked++;
        continue;
      }

      // c) name-only match → hold for Super-Admin review (don't auto-link/import)
      if (nm) {
        const weak = unlinked.find((u) => u.nameN === nm);
        if (weak) {
          if (!reviewExisting.has(jid)) {
            await db.from("jazz_match_review").insert({ jazz_applicant_id: jid, jazz_snapshot: m, candidate_id: weak.id, reason: "name_only" });
            reviewExisting.add(jid);
            queued++;
          }
          continue;
        }
      }

      // d) no match anywhere → import as net-new
      const { data: ins } = await db.from("candidates").insert({ ...m, school_id: routedSchoolId, not_interested: false }).select("id").single();
      if (ins) { linkedByJazz.set(jid, ins.id); imported++; }
    }
  }

  await db.from("sync_meta").upsert(
    { id: 1, last_sync: new Date().toISOString(), total_cached: linked + imported + refreshed, last_status: `${mode} complete` },
    { onConflict: "id" }
  );
  return finish(false, 0);
}

// ---- PUT: re-route unrouted candidates using the current routing table -------
// Fixes candidates whose school_id is null because the routing table was updated
// or because the questionnaire label changed after the initial sync.
export async function PUT(_request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !isSuper(profile.role)) {
    return NextResponse.json({ error: "Forbidden — super-admin only" }, { status: 403 });
  }
  const db = createServiceClient();

  // Fetch all candidates that have university_raw but no school_id
  const { data: unrouted, error: fetchErr } = await db
    .from("candidates")
    .select("id, university_raw")
    .is("school_id", null)
    .not("university_raw", "is", null);
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const { data: schools } = await db.from("schools").select("id, name");
  const schoolMap = new Map((schools ?? []).map((s: any) => [s.name, s.id]));

  let matched = 0, still_unrouted = 0;
  for (const c of unrouted ?? []) {
    const schoolName = routeToSchoolName(c.university_raw);
    const school_id = schoolName ? schoolMap.get(schoolName) ?? null : null;
    if (school_id) {
      await db.from("candidates").update({ school_id }).eq("id", c.id);
      matched++;
    } else {
      still_unrouted++;
    }
  }

  return NextResponse.json({ ok: true, matched, still_unrouted });
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
