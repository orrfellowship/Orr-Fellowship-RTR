import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail, emailLayout, emailConfigured } from "@/lib/email";
import { evaluateCandidate, DIGEST_KINDS } from "@/lib/triggers";
import { drainOutreachQueue } from "@/lib/gmail/outreach-queue.server";
import { pollRepliesAndBounces } from "@/lib/gmail/reply-tracking.server";
import { fetchAllRows } from "@/lib/queries";
import { phaseOf } from "@/lib/stages";

// A candidate is "active" for nudging if they haven't been marked not-interested
// and aren't in a terminal stage. Shared by the missing-LinkedIn admin nudge.
const isActiveCandidate = (c: any) =>
  !c.not_interested && phaseOf(c.stage) !== "rejected" && phaseOf(c.stage) !== "moved";
const missingLinkedin = (c: any) => !c.linkedin || String(c.linkedin).trim() === "";

// Scheduled worker. Protected by CRON_SECRET. Call it from Supabase pg_cron +
// pg_net (see db/phase3.sql):
//   ?job=flush  — send any due notifications (run every ~5 min for the 30-min claim delay)
//   ?job=digest — build + send the daily grouped digests, then flush (run once/day)
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Db = ReturnType<typeof createServiceClient>;

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
}

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? new URL(req.url).searchParams.get("secret");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const job = url.searchParams.get("job") ?? "flush";
  const db = createServiceClient();

  // One-shot deliverability check: ?job=test&to=you@example.com sends a single
  // email through the same transactional path the digests/flush use.
  if (job === "test") {
    const to = url.searchParams.get("to");
    if (!to) return NextResponse.json({ error: "Add ?to=your@email to send a test." }, { status: 400 });
    const res = await sendEmail({
      to,
      subject: "Orr Recruiting — test email",
      html: emailLayout({ heading: "It works ✓", bodyHtml: "<div>If you're reading this, the cron route and transactional email provider are wired up correctly.</div>" }),
    });
    return NextResponse.json({ ok: res.ok, emailConfigured: emailConfigured(), result: res });
  }

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

  if (job === "digest") {
    const digest = await runDigests(db);
    const flush = await flushDue(db);
    return NextResponse.json({ ok: true, job, digest, flush, emailConfigured: emailConfigured() });
  }
  const flush = await flushDue(db);
  return NextResponse.json({ ok: true, job: "flush", flush, emailConfigured: emailConfigured() });
}

export const GET = run;
export const POST = run;

// ---- flush: email notifications whose send_after has passed -----------------
async function flushDue(db: Db) {
  const nowIso = new Date().toISOString();
  const { data: due } = await db
    .from("notifications")
    .select("id, recipient_id, title, body, link")
    .is("emailed_at", null)
    .eq("superseded", false)
    .lte("send_after", nowIso)
    .limit(200);
  if (!due || due.length === 0) return { due: 0, sent: 0, failed: 0 };

  const recipIds = Array.from(new Set(due.map((n) => n.recipient_id)));
  const { data: profs } = await db.from("profiles").select("id, email, full_name").in("id", recipIds);
  const emailById = new Map((profs ?? []).map((p: any) => [p.id, p.email as string | null]));

  let sent = 0, failed = 0;
  for (const n of due) {
    const to = emailById.get(n.recipient_id);
    if (!to) { failed++; continue; }
    const html = emailLayout({
      heading: n.title,
      bodyHtml: `<div>${escapeHtml(n.body)}</div>`,
      ctaLabel: n.link ? "Open workspace" : undefined,
      ctaUrl: n.link ? `${siteUrl()}${n.link}` : undefined,
    });
    const res = await sendEmail({ to, subject: n.title, html });
    if (res.ok) {
      await db.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id);
      sent++;
    } else {
      failed++; // leave unsent → retried next run (or visible in-app)
    }
  }
  return { due: due.length, sent, failed };
}

// ---- digests: grouped daily email per recipient -----------------------------
type Item = { kind: string; title: string; line: string; candidateId?: string | null };

async function runDigests(db: Db) {
  const now = Date.now();
  const today = new Date();
  const isMonday = today.getUTCDay() === 1;
  const tomorrow = new Date(now + 86_400_000).toISOString().slice(0, 10);
  const dayKey = today.toISOString().slice(0, 10);

  const [{ data: profiles }, { data: candidates }, { data: logs }, { data: events }] = await Promise.all([
    db.from("profiles").select("id, email, full_name, role, school_id, is_active"),
    // Paged so nudges/digests cover every candidate, not just the first 1000.
    fetchAllRows((from, to) => db.from("candidates").select("id, name, stage, point_person_id, not_interested, school_id, linkedin").range(from, to)).then((data) => ({ data })),
    fetchAllRows((from, to) => db.from("outreach_log").select("candidate_id, created_at").range(from, to)).then((data) => ({ data })),
    db.from("events").select("id, title, event_date, event_type, school_id").eq("event_type", "attend").eq("event_date", tomorrow),
  ]);

  const activeProfiles = (profiles ?? []).filter((p: any) => p.is_active && p.email);
  const profById = new Map(activeProfiles.map((p: any) => [p.id, p]));

  // last contact per candidate
  const lastContact: Record<string, string> = {};
  for (const l of logs ?? []) {
    const cid = (l as any).candidate_id, ts = (l as any).created_at;
    if (!lastContact[cid] || ts > lastContact[cid]) lastContact[cid] = ts;
  }

  // group items per recipient
  const itemsByRecipient = new Map<string, Item[]>();
  const push = (rid: string, item: Item) => {
    if (!profById.has(rid)) return;
    const arr = itemsByRecipient.get(rid) ?? itemsByRecipient.set(rid, []).get(rid)!;
    arr.push(item);
  };

  // Per-kind email title for a candidate digest item; the in-app row reuses the
  // trigger kind as its notification `type` (free-text column, no enum).
  const titleFor = (kind: string, name: string) =>
    kind === "applied" ? `${name} applied`
    : kind === "finalist" ? `Finalist prep: ${name}`
    : kind === "next_step" ? `Next step: ${name}`
    : kind === "rapport" ? `Build rapport: ${name}`
    : `Follow up: ${name}`; // follow_up
  for (const c of candidates ?? []) {
    const owner = (c as any).point_person_id as string | null;
    if (!owner) continue;
    const t = evaluateCandidate(c as any, { profileId: owner, lastContactISO: lastContact[(c as any).id], now });
    if (!t || !DIGEST_KINDS.includes(t.kind)) continue;
    push(owner, {
      kind: t.kind,
      title: titleFor(t.kind, (c as any).name),
      line: `<b>${escapeHtml((c as any).name)}</b> — ${escapeHtml(t.why)}`,
      candidateId: (c as any).id,
    });
  }

  // weekly snapshot nudge (Mondays)
  if (isMonday) {
    for (const p of activeProfiles) {
      if (p.role === "admin" || p.role === "super_admin") continue;
      push(p.id, { kind: "weekly_snapshot", title: "Check your Weekly Snapshot", line: "Start the week by reviewing your snapshot and action queue." });
    }
  }

  // Missing-LinkedIn nudge to admins — one grouped line (never one per candidate),
  // pointing at the admin snapshot where they can fill them in via the flashcard.
  const missingLinkedinCount = (candidates ?? []).filter((c: any) => isActiveCandidate(c) && missingLinkedin(c)).length;
  if (missingLinkedinCount > 0) {
    for (const p of activeProfiles) {
      if (p.role !== "admin" && p.role !== "super_admin") continue;
      push(p.id, {
        kind: "missing_linkedin",
        title: `${missingLinkedinCount} candidate${missingLinkedinCount === 1 ? "" : "s"} need a LinkedIn`,
        line: `<b>${missingLinkedinCount}</b> active candidate${missingLinkedinCount === 1 ? " is" : "s are"} missing a LinkedIn — add them from your Weekly Snapshot.`,
      });
    }
  }

  // event reminders (attend events happening tomorrow)
  for (const ev of events ?? []) {
    const recips = activeProfiles.filter((p: any) => !(ev as any).school_id || p.school_id === (ev as any).school_id);
    for (const p of recips) {
      push(p.id, { kind: "event_reminder", title: `Tomorrow: ${(ev as any).title}`, line: `<b>${escapeHtml((ev as any).title)}</b> is tomorrow — let your team know if you're going.` });
    }
  }

  // Avoid duplicates if the digest job runs more than once in a day.
  const { data: existingToday } = await db
    .from("notifications")
    .select("recipient_id, dedupe_key")
    .gte("created_at", `${dayKey}T00:00:00Z`)
    .not("dedupe_key", "is", null);
  const seen = new Set((existingToday ?? []).map((r: any) => `${r.recipient_id}|${r.dedupe_key}`));

  let recipients = 0, emailed = 0;
  for (const [rid, items] of itemsByRecipient) {
    const fresh = items.filter((it) => {
      const key = `${it.kind}:${it.candidateId ?? dayKey}:${dayKey}`;
      const dedupe = `${rid}|${key}`;
      if (seen.has(dedupe)) return false;
      seen.add(dedupe);
      return true;
    });
    if (fresh.length === 0) continue;
    recipients++;

    // Admin-only items (missing LinkedIn) deep-link to the console snapshot;
    // everything else lands a fellow on their workspace.
    const linkFor = (kind: string) => (kind === "missing_linkedin" ? "/console/snapshot" : "/workspace");
    const ctaPath = fresh.every((it) => it.kind === "missing_linkedin") ? "/console/snapshot" : "/workspace";

    // in-app rows (pre-marked emailed so the flusher won't re-send them individually)
    const nowIso = new Date().toISOString();
    await db.from("notifications").insert(fresh.map((it) => ({
      recipient_id: rid, type: it.kind, title: it.title, body: stripHtml(it.line),
      link: linkFor(it.kind), candidate_id: it.candidateId ?? null,
      send_after: nowIso, emailed_at: nowIso, dedupe_key: `${it.kind}:${it.candidateId ?? dayKey}:${dayKey}`,
    })));

    // one grouped email
    const prof: any = profById.get(rid);
    const bodyHtml = `<ul style="margin:0;padding-left:18px">${fresh.map((it) => `<li style="margin-bottom:6px">${it.line}</li>`).join("")}</ul>`;
    const res = await sendEmail({
      to: prof.email,
      subject: `Your recruiting digest · ${fresh.length} item${fresh.length === 1 ? "" : "s"}`,
      html: emailLayout({ heading: "Your recruiting digest", intro: `Hi ${escapeHtml((prof.full_name ?? "").split(" ")[0] || "there")}, here's what needs you:`, bodyHtml, ctaLabel: ctaPath === "/console/snapshot" ? "Open snapshot" : "Open workspace", ctaUrl: `${siteUrl()}${ctaPath}` }),
    });
    if (res.ok) emailed++;
  }

  return { recipients, emailed, monday: isMonday, eventReminders: (events ?? []).length };
}

function escapeHtml(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stripHtml(s: string): string {
  return (s ?? "").replace(/<[^>]+>/g, "").trim();
}
