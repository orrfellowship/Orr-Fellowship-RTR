import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isSuper } from "@/lib/types";
import { mostAdvancedStage, routeToSchoolName } from "@/lib/stages";
import { fetchAllRows } from "@/lib/queries";
import { representativeSchoolId } from "@/lib/candidateSchool";

const JAZZ_BASE = "https://api.resumatorapi.com/v1";
const TARGET_JOB = "job_20260706160454_40LBN3KPOJUA9EJW";

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
// Sourced candidates often apply through JazzHR with a DIFFERENT email than the
// one they were sourced under, so name+school is the workhorse match. To keep it
// precise we (a) auto-link only on an EXACT canonical name (suffix-stripped,
// middle names dropped) + same school, and (b) route nickname-equivalents
// (Jon↔Jonathan) and same-name-different-school to human review instead.
const normEmail = (e?: string | null) => (e ?? "").trim().toLowerCase();
const normPhone = (p?: string | null) => { const d = (p ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const NICKNAMES: Record<string, string> = {
  jon: "jonathan", jonny: "jonathan", johnny: "john", mike: "michael", mikey: "michael",
  chris: "christopher", matt: "matthew", dave: "david", dan: "daniel", danny: "daniel",
  tom: "thomas", tommy: "thomas", tony: "anthony", rob: "robert", bob: "robert", bobby: "robert",
  bill: "william", billy: "william", will: "william", jim: "james", jimmy: "james",
  jake: "jacob", joe: "joseph", joey: "joseph", nick: "nicholas", alex: "alexander",
  sam: "samuel", ben: "benjamin", andy: "andrew", drew: "andrew", ed: "edward", eddie: "edward",
  ron: "ronald", rick: "richard", rich: "richard", steve: "steven", greg: "gregory",
  jeff: "jeffrey", ken: "kenneth", charlie: "charles", chuck: "charles", fred: "frederick",
  gabe: "gabriel", nate: "nathaniel", pat: "patrick", phil: "phillip", ray: "raymond",
  ted: "theodore", vince: "vincent", zack: "zachary", zach: "zachary",
  liz: "elizabeth", beth: "elizabeth", kate: "katherine", katie: "katherine", abby: "abigail",
  becky: "rebecca", jen: "jennifer", jenny: "jennifer", jess: "jessica", kim: "kimberly",
  sue: "susan", maggie: "margaret", meg: "margaret", vicky: "victoria", tina: "christina",
  steph: "stephanie", allie: "allison", ally: "allison", angie: "angela", gabby: "gabrielle",
  mandy: "amanda", cathy: "catherine", kathy: "katherine", debbie: "deborah", deb: "deborah",
};
const nameTokens = (n?: string | null): string[] =>
  (n ?? "").toLowerCase().normalize("NFKD")
    .replace(/[^a-z\s'-]/g, " ").replace(/['-]/g, " ")
    .split(/\s+/).filter(Boolean).filter((t) => !NAME_SUFFIXES.has(t));
// Exact canonical name: first + last token only (drops middle names/initials).
const canonName = (n?: string | null): string => {
  const t = nameTokens(n);
  if (t.length === 0) return "";
  return t.length === 1 ? t[0] : `${t[0]} ${t[t.length - 1]}`;
};
// Nickname-folded key: first name mapped to its formal version, + last token.
const nickKey = (n?: string | null): string => {
  const t = nameTokens(n);
  if (t.length === 0) return "";
  const first = NICKNAMES[t[0]] ?? t[0];
  return t.length === 1 ? first : `${first} ${t[t.length - 1]}`;
};

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
  // Page through every candidate — the matching index must be complete or
  // JazzHR applicants past the 1000th row would be re-created as duplicates.
  const allCands = await fetchAllRows((from, to) => db.from("candidates").select("id, jazz_id, email, phone, name, school_id, university_raw").range(from, to));
  const { data: schoolsData } = await db.from("schools").select("id, name, tier");
  const schools = schoolsData ?? [];
  const schoolNameById = new Map((schoolsData ?? []).map((s: any) => [s.id, s.name as string]));
  const schoolIdByName = new Map((schoolsData ?? []).map((s: any) => [s.name as string, s.id as string]));
  const routeSchoolForStorage = (schoolName: string | null) => {
    if (!schoolName) return null;
    const matched = schools.find((s: any) => String(s.name).toLowerCase() === schoolName.toLowerCase());
    if (!matched) return null;
    if (matched.tier === "satellite" || matched.tier === "bonus") {
      return representativeSchoolId(schools as any[], matched.tier) ?? matched.id;
    }
    return schoolIdByName.get(matched.name) ?? null;
  };
  const { data: reviewRows } = await db.from("jazz_match_review").select("jazz_applicant_id").eq("status", "pending");
  const reviewExisting = new Set((reviewRows ?? []).map((r: any) => String(r.jazz_applicant_id)));

  const linkedByJazz = new Map<string, string>(); // jazz_id -> candidate id
  type U = { id: string; email: string; phone: string; canon: string; nick: string; schoolName: string };
  const unlinked: U[] = [];
  for (const c of allCands ?? []) {
    if (c.jazz_id) { linkedByJazz.set(String(c.jazz_id), c.id); continue; }
    const storedSchool = c.school_id ? schools.find((s: any) => s.id === c.school_id) : null;
    const storedGroup = storedSchool?.tier === "satellite" || storedSchool?.tier === "bonus";
    unlinked.push({
      id: c.id, email: normEmail(c.email), phone: normPhone(c.phone),
      canon: canonName(c.name), nick: nickKey(c.name),
      schoolName: storedGroup ? (routeToSchoolName(c.university_raw) ?? c.university_raw ?? "") : c.school_id ? (schoolNameById.get(c.school_id) ?? "") : "",
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
      const routedSchoolId = routeSchoolForStorage(routedSchool);
      const factual = factualFromMapped(m, routedSchoolId);

      // a) already linked → refresh factual fields + stage
      const linkedId = linkedByJazz.get(jid);
      if (linkedId) {
        await db.from("candidates").update(factual).eq("id", linkedId);
        refreshed++;
        continue;
      }

      // b) confident match → link to the existing record.
      //    Email/phone first; then EXACT canonical name + same school.
      const em = normEmail(m.email), ph = normPhone(m.phone);
      const canon = canonName(m.name), nick = nickKey(m.name);
      let match = em ? unlinked.find((u) => u.email && u.email === em) : undefined;
      if (!match && ph) match = unlinked.find((u) => u.phone && u.phone === ph);
      if (!match && canon && routedSchool) match = unlinked.find((u) => u.canon === canon && u.schoolName === routedSchool);
      if (match) {
        await db.from("candidates").update(factual).eq("id", match.id);
        linkedByJazz.set(jid, match.id);
        consume(match.id);
        linked++;
        continue;
      }

      // c) likely-but-uncertain → hold for admin review (never auto-link/import):
      //    same exact name at a DIFFERENT school, or a nickname-equivalent
      //    (Jon↔Jonathan) at the same school.
      if (canon) {
        const weak =
          unlinked.find((u) => u.canon === canon) ??
          (routedSchool ? unlinked.find((u) => u.nick === nick && u.schoolName === routedSchool) : undefined);
        if (weak) {
          if (!reviewExisting.has(jid)) {
            const reason = weak.canon === canon ? "name_only" : "nickname";
            await db.from("jazz_match_review").insert({ jazz_applicant_id: jid, jazz_snapshot: m, candidate_id: weak.id, reason });
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

  // Fetch all candidates that have university_raw but no school_id (paged so we
  // re-route the entire backlog, not just the first 1000).
  const unrouted = await fetchAllRows<{ id: string; university_raw: string | null }>(
    (from, to) => db.from("candidates").select("id, university_raw").is("school_id", null).not("university_raw", "is", null).range(from, to),
  );

  const { data: schools } = await db.from("schools").select("id, name, tier");
  const schoolRows = schools ?? [];
  const schoolMap = new Map(schoolRows.map((s: any) => [s.name, s.id]));

  let matched = 0, still_unrouted = 0;
  for (const c of unrouted ?? []) {
    const schoolName = routeToSchoolName(c.university_raw);
    const matchedSchool = schoolName ? schoolRows.find((s: any) => String(s.name).toLowerCase() === schoolName.toLowerCase()) : null;
    const school_id = matchedSchool
      ? matchedSchool.tier === "satellite" || matchedSchool.tier === "bonus"
        ? representativeSchoolId(schoolRows as any[], matchedSchool.tier) ?? matchedSchool.id
        : schoolMap.get(matchedSchool.name) ?? null
      : null;
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
