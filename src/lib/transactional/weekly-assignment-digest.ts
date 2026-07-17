import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { emailLayout, sendEmail, type SendEmailFailure } from "@/lib/email";
import { fetchAllRows } from "@/lib/queries";

export const TRANSACTIONAL_TIME_ZONE = "America/New_York";
export const FIRST_ALLOWED_DIGEST_AT = new Date("2026-07-20T12:00:00.000Z");
export const DIGEST_LIST_LIMIT = 50;
const WORKER_NAME = "weekly-assignment-digest";
const LEASE_MS = 5 * 60 * 1000;

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: string };

function easternParts(date: Date): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TRANSACTIONAL_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")), month: Number(get("month")), day: Number(get("day")),
    hour: Number(get("hour")), minute: Number(get("minute")), weekday: get("weekday"),
  };
}

// Convert an Eastern wall-clock time to UTC without assuming EST or EDT. The
// two-pass correction is stable for the 08:00 digest time, which is never in a
// DST skipped/repeated interval.
function easternWallClockToUtc(year: number, month: number, day: number, hour: number): Date {
  let candidate = new Date(Date.UTC(year, month - 1, day, hour));
  for (let i = 0; i < 2; i++) {
    const shown = easternParts(candidate);
    const wantedMs = Date.UTC(year, month - 1, day, hour);
    const shownMs = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
    candidate = new Date(candidate.getTime() + wantedMs - shownMs);
  }
  return candidate;
}

export type DigestPeriod = { start: Date; end: Date };

export function parseDryRunPreviewAt(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || !weeklyDigestPeriod(parsed)) return null;
  return parsed;
}

export function weeklyDigestPeriod(now: Date): DigestPeriod | null {
  if (now < FIRST_ALLOWED_DIGEST_AT) return null;
  const local = easternParts(now);
  if (local.weekday !== "Mon" || local.hour !== 8) return null;
  const end = easternWallClockToUtc(local.year, local.month, local.day, 8);
  const previous = new Date(Date.UTC(local.year, local.month - 1, local.day - 7));
  const start = easternWallClockToUtc(
    previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate(), 8,
  );
  return { start, end };
}

export function easternLocalDay(now: Date): string {
  const p = easternParts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export type AssignmentDigestEvent = {
  id: string;
  candidate_id: string;
  candidate_name: string;
  school_name: string | null;
  university_raw: string | null;
  changed_at: string;
};

export function renderAssignmentDigest(input: {
  recipientName: string | null;
  events: AssignmentDigestEvent[];
  period: DigestPeriod;
  siteUrl: string;
}) {
  const sorted = [...input.events].sort((a, b) =>
    a.candidate_name.localeCompare(b.candidate_name) || a.id.localeCompare(b.id));
  const shown = sorted.slice(0, DIGEST_LIST_LIMIT);
  const hidden = sorted.length - shown.length;
  const list = shown.map((event) => {
    const context = event.university_raw || event.school_name;
    return `<li style="margin-bottom:6px"><b>${escapeHtml(event.candidate_name)}</b>${context ? ` — ${escapeHtml(context)}` : ""}</li>`;
  }).join("");
  const bodyHtml = [
    `<div style="margin-bottom:12px"><b>${sorted.length}</b> candidate${sorted.length === 1 ? " was" : "s were"} newly assigned to you.</div>`,
    `<ul style="margin:0;padding-left:18px">${list}</ul>`,
    hidden > 0 ? `<div style="margin-top:12px">Plus ${hidden} more. Open RTR to view your complete assignments.</div>` : "",
  ].join("");
  const startLabel = formatEastern(input.period.start);
  const endLabel = formatEastern(input.period.end);
  const firstName = input.recipientName?.trim().split(/\s+/)[0] || "there";
  return {
    subject: `Your weekly assignment digest · ${sorted.length} candidate${sorted.length === 1 ? "" : "s"}`,
    html: emailLayout({
      heading: "Your weekly assignment digest",
      intro: `Hi ${escapeHtml(firstName)} — assignments from ${startLabel} through ${endLabel}:`,
      bodyHtml,
      ctaLabel: "View my assignments",
      ctaUrl: `${input.siteUrl}/workspace`,
    }),
    eventCount: sorted.length,
    shownCount: shown.length,
    hiddenCount: hidden,
  };
}

function formatEastern(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TRANSACTIONAL_TIME_ZONE, month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "Unexpected worker exception";
}

type DigestJob = {
  id: string;
  job_type: "assignment_weekly" | "admin_alert" | "generic_notification";
  recipient_id: string;
  recipient_email: string;
  recipient_name: string | null;
  period_start: string;
  period_end: string;
  event_count: number;
  attempt_count: number;
  idempotency_key: string;
  alert_subject: string | null;
  alert_body: string | null;
  alert_heading: string | null;
  alert_cta_label: string | null;
  alert_cta_url: string | null;
};

export type WorkerSummary = {
  worker: string; runId: string; dryRun: boolean; skipped?: string;
  jobsFound: number; jobsClaimed: number; emailsAttempted: number; emailsAccepted: number;
  jobsRetried: number; jobsExhausted: number; jobsCapBlocked: number;
  circuitBreakersTriggered: number; alertsCreated: number; durationMs: number;
  digests?: { recipientId: string; eventCount: number; shownCount: number; hiddenCount: number }[];
};

function summary(runId: string, dryRun: boolean): WorkerSummary {
  return { worker: WORKER_NAME, runId, dryRun, jobsFound: 0, jobsClaimed: 0,
    emailsAttempted: 0, emailsAccepted: 0, jobsRetried: 0, jobsExhausted: 0,
    jobsCapBlocked: 0, circuitBreakersTriggered: 0, alertsCreated: 0, durationMs: 0 };
}

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"))
    .replace(/\/$/, "");
}

export async function queueTransactionalEmail(input: {
  recipientId: string;
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  idempotencyKey: string;
}) {
  if (!input.idempotencyKey || input.idempotencyKey.length > 256) {
    return { ok: false as const, error: "Invalid transactional idempotency key" };
  }
  const db = createServiceClient();
  const start = new Date();
  const end = new Date(start.getTime() + 1_000);
  const payload = JSON.stringify({
    to: input.recipientEmail, subject: input.subject, heading: input.heading,
    body: input.body, ctaLabel: input.ctaLabel, ctaUrl: input.ctaUrl,
  });
  const { error } = await db.from("transactional_digest_jobs").insert({
    job_type: "generic_notification", recipient_id: input.recipientId,
    recipient_email: input.recipientEmail, recipient_name: input.recipientName ?? null,
    period_start: start.toISOString(), period_end: end.toISOString(), event_count: 0,
    idempotency_key: input.idempotencyKey, payload_fingerprint: fingerprint(payload),
    alert_subject: input.subject, alert_heading: input.heading, alert_body: input.body,
    alert_cta_label: input.ctaLabel ?? null, alert_cta_url: input.ctaUrl ?? null,
  });
  if (error?.code === "23505") return { ok: true as const, skipped: true as const };
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, queued: true as const };
}

export async function runWeeklyAssignmentDigest(options: { now?: Date; dryRun?: boolean } = {}): Promise<WorkerSummary> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const runId = crypto.randomUUID();
  const out = summary(runId, dryRun);
  const period = weeklyDigestPeriod(now);
  if (now < FIRST_ALLOWED_DIGEST_AT) return { ...out, skipped: "before_first_allowed_send", durationMs: Date.now() - started };
  if (!dryRun && process.env.TRANSACTIONAL_SENDING_ENABLED !== "true") {
    return { ...out, skipped: "application_send_switch_disabled", durationMs: Date.now() - started };
  }

  const db = createServiceClient();
  if (dryRun) {
    if (!period) return { ...out, skipped: "outside_eastern_monday_08_window", durationMs: Date.now() - started };
    const data = await fetchAllRows((from, to) => db.from("assignment_change_events")
      .select("id,candidate_id,candidate_name,school_name,university_raw,changed_at,new_owner_id")
      .eq("status", "pending").lt("changed_at", period.end.toISOString())
      .order("new_owner_id").order("changed_at").range(from, to));
    const ownerByCandidate = new Map<string, string | null>();
    const candidateIds = [...new Set(data.map((event) => event.candidate_id))];
    for (let index = 0; index < candidateIds.length; index += 500) {
      const { data: candidates, error } = await db.from("candidates").select("id,point_person_id")
        .in("id", candidateIds.slice(index, index + 500));
      if (error) throw new Error(`dry_run_candidate_query_failed: ${error.message}`);
      for (const candidate of candidates ?? []) ownerByCandidate.set(candidate.id, candidate.point_person_id);
    }
    const grouped = new Map<string, AssignmentDigestEvent[]>();
    for (const event of data) {
      if (ownerByCandidate.get(event.candidate_id) !== event.new_owner_id) continue;
      const list = grouped.get(event.new_owner_id) ?? [];
      list.push(event as AssignmentDigestEvent);
      grouped.set(event.new_owner_id, list);
    }
    out.jobsFound = grouped.size;
    out.digests = [...grouped].map(([recipientId, events]) => {
      const rendered = renderAssignmentDigest({ recipientName: null, events, period, siteUrl: siteUrl() });
      return { recipientId, eventCount: rendered.eventCount, shownCount: rendered.shownCount, hiddenCount: rendered.hiddenCount };
    });
    out.durationMs = Date.now() - started;
    return out;
  }

  if (period) {
    const { data: prepared, error: prepareError } = await db.rpc("prepare_weekly_assignment_digests", {
      p_period_start: period.start.toISOString(), p_period_end: period.end.toISOString(), p_run_id: runId,
    });
    if (prepareError) throw new Error(`database_prepare_failure: ${prepareError.message}`);
    if (prepared?.circuitBreaker) {
      out.circuitBreakersTriggered++;
      out.alertsCreated += await createCircuitBreakerAlerts(db, `thresholds recipients=${prepared.recipients} events=${prepared.events} largest=${prepared.largestRecipient}`);
    }
    if (!prepared?.ok) return { ...out, skipped: prepared?.reason ?? (prepared?.circuitBreaker ? "circuit_breaker" : "worker_paused"), durationMs: Date.now() - started };
    out.jobsFound = prepared.jobsCreated ?? 0;
  }

  const claimToken = crypto.randomUUID();
  const { data: jobs, error: claimError } = await db.rpc("claim_transactional_digest_jobs", {
    p_limit: Number(process.env.TRANSACTIONAL_MAX_JOBS_PER_RUN ?? 25),
    p_claim_token: claimToken,
    p_lease_until: new Date(now.getTime() + LEASE_MS).toISOString(),
  });
  if (claimError) throw new Error(`database_claim_failure: ${claimError.message}`);
  out.jobsClaimed = (jobs ?? []).length;
  if (out.jobsClaimed === 0) {
    const { data: control } = await db.from("transactional_worker_control")
      .select("hard_paused,pause_reason").eq("worker_name", WORKER_NAME).maybeSingle();
    if (control?.hard_paused && /circuit_breaker|uncertain_beyond/i.test(control.pause_reason ?? "")) {
      out.circuitBreakersTriggered++;
      out.alertsCreated += await createCircuitBreakerAlerts(db, control.pause_reason ?? "worker hard-paused");
    }
  }

  for (const job of (jobs ?? []) as DigestJob[]) {
    const logBase = { worker: WORKER_NAME, runId, digestJobId: job.id, recipientUserId: job.recipient_id,
      eventCount: job.event_count, attemptNumber: job.attempt_count + 1, claimTokenFingerprint: fingerprint(claimToken),
      idempotencyKeyFingerprint: fingerprint(job.idempotency_key) };
    try {
      let rendered: { subject: string; html: string; eventCount: number; shownCount: number; hiddenCount: number };
      if (job.job_type !== "assignment_weekly") {
        if (!job.alert_subject || !job.alert_body) throw new PermanentWorkerError("missing_required_data", "Admin alert payload is missing");
        rendered = {
          subject: job.alert_subject,
          html: emailLayout({ heading: job.alert_heading || "Orr Recruiting notification", bodyHtml: `<div>${escapeHtml(job.alert_body)}</div>`,
            ctaLabel: job.alert_cta_label ?? undefined, ctaUrl: job.alert_cta_url ?? undefined }),
          eventCount: 0, shownCount: 0, hiddenCount: 0,
        };
      } else {
        const { data: events, error: eventError } = await db.from("assignment_change_events")
          .select("id,candidate_id,candidate_name,school_name,university_raw,changed_at")
          .eq("digest_job_id", job.id).eq("status", "claimed").order("changed_at");
        if (eventError || !events || events.length !== job.event_count) {
          throw new PermanentWorkerError("missing_required_data", eventError?.message ?? `Expected ${job.event_count} events, found ${events?.length ?? 0}`);
        }
        rendered = renderAssignmentDigest({ recipientName: job.recipient_name, events, period: {
          start: new Date(job.period_start), end: new Date(job.period_end),
        }, siteUrl: siteUrl() });
      }
      const { data: reservation, error: reserveError } = await db.rpc("reserve_transactional_send", {
        p_job_id: job.id, p_claim_token: claimToken,
      });
      if (reserveError) throw new Error(`database_cap_reservation_failure: ${reserveError.message}`);
      if (!reservation?.ok) {
        if (reservation?.reason === "daily_cap") out.jobsCapBlocked++;
        console.warn(JSON.stringify({ level: "warn", ...logBase, resultStatus: "blocked", errorCategory: reservation?.reason }));
        continue;
      }

      out.emailsAttempted++;
      const result = await sendEmail({
        to: job.recipient_email, subject: rendered.subject, html: rendered.html,
        idempotencyKey: job.idempotency_key,
      });
      if (!result.ok) {
        const failureStatus = await recordFailure(db, job, claimToken, result, out);
        console.warn(JSON.stringify({ level: "warn", ...logBase, resultStatus: "failed", errorCategory: result.category }));
        if (failureStatus === "exhausted") break;
        continue;
      }

      const { data: finalized, error: finalizeError } = await db.rpc("finalize_transactional_send", {
        p_job_id: job.id, p_claim_token: claimToken, p_provider_message_id: result.providerMessageId,
        p_idempotency_fingerprint: fingerprint(job.idempotency_key),
      });
      if (finalizeError || finalized !== true) {
        console.error(JSON.stringify({ level: "error", ...logBase, providerMessageId: result.providerMessageId,
          resultStatus: "provider_accepted_persistence_failed", errorCategory: "database_finalization_failure" }));
        // Do not issue another send here. Hard-pause and alert because provider
        // acceptance without durable finalization is the incident's critical path.
        await db.rpc("pause_transactional_worker", { p_reason: `database_finalization_failure job=${job.id}` });
        out.circuitBreakersTriggered++;
        out.alertsCreated += await createSuperAdminAlerts(db, job, {
          ok: false, error: finalizeError?.message ?? "Provider accepted but finalization did not commit",
          category: "database_finalization_failure", retriable: false,
        });
        break;
      }
      out.emailsAccepted++;
      console.info(JSON.stringify({ level: "info", ...logBase, providerMessageId: result.providerMessageId, resultStatus: "sent" }));
    } catch (error) {
      const failure: SendEmailFailure = error instanceof PermanentWorkerError
        ? { ok: false, error: error.message, category: error.category, retriable: false }
        : { ok: false, error: safeError(error), category: "unexpected_worker_exception", retriable: true };
      const failureStatus = await recordFailure(db, job, claimToken, failure, out);
      console.error(JSON.stringify({ level: "error", ...logBase, resultStatus: "failed", errorCategory: failure.category }));
      if (failureStatus === "exhausted") break;
    }
  }
  out.durationMs = Date.now() - started;
  console.info(JSON.stringify({ level: "info", event: "transactional_worker_summary", ...out }));
  return out;
}

async function recordFailure(
  db: ReturnType<typeof createServiceClient>, job: DigestJob, claimToken: string,
  failure: SendEmailFailure, out: WorkerSummary,
) {
  const { data: status, error } = await db.rpc("fail_transactional_send", {
    p_job_id: job.id, p_claim_token: claimToken, p_error_category: failure.category,
    p_error_summary: failure.error, p_retriable: failure.retriable,
    p_idempotency_fingerprint: fingerprint(job.idempotency_key),
  });
  if (error) throw new Error(`database_failure_persistence_failed: ${error.message}`);
  if (status === "retry") out.jobsRetried++;
  if (status === "exhausted") {
    out.jobsExhausted++;
    await db.rpc("pause_transactional_worker", { p_reason: `job_exhausted job=${job.id} category=${failure.category}` });
    out.circuitBreakersTriggered++;
    if (job.job_type !== "admin_alert") out.alertsCreated += await createSuperAdminAlerts(db, job, failure);
  }
  return status as string;
}

async function createSuperAdminAlerts(
  db: ReturnType<typeof createServiceClient>, job: DigestJob, failure: SendEmailFailure,
) {
  const bucket = new Date().toISOString().slice(0, 13);
  const dedupeKey = `transactional-incident:${job.id}:${failure.category}:${bucket}`;
  const { data: incident, error: incidentError } = await db.from("transactional_incidents").upsert({
    dedupe_key: dedupeKey, category: failure.category, worker_name: WORKER_NAME,
    job_id: job.id, recipient_id: job.recipient_id, attempt_count: Math.min(job.attempt_count + 1, 3),
    error_summary: failure.error.slice(0, 1000), sending_paused: true,
    recommended_action: "Review the transactional incident and recipient data before manually retrying or resuming.",
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id").maybeSingle();
  if (incidentError) throw new Error(`incident_persistence_failed: ${incidentError.message}`);
  if (!incident) return 0;
  const { data: admins, error: adminError } = await db.from("profiles").select("id,email,full_name")
    .eq("role", "super_admin").eq("is_active", true);
  if (adminError) throw new Error(`super_admin_lookup_failed: ${adminError.message}`);
  const rows = (admins ?? []).map((admin) => ({
    recipient_id: admin.id, type: "transactional_error",
    title: "Transactional digest needs attention",
    body: `${failure.category}: digest job ${job.id} stopped after ${Math.min(job.attempt_count + 1, 3)} attempt(s). Transactional sending is paused.`,
    link: "/console/snapshot", send_after: new Date().toISOString(), emailed_at: new Date().toISOString(),
    dedupe_key: `${dedupeKey}:${admin.id}`,
  }));
  if (rows.length) {
    const { error } = await db.from("notifications").insert(rows);
    if (error && error.code !== "23505") throw new Error(`in_app_alert_failed: ${error.message}`);
  }
  const alertStart = new Date();
  const alertEnd = new Date(alertStart.getTime() + 60_000);
  const emailJobs = (admins ?? []).filter((admin) => admin.email).map((admin) => {
    const id = crypto.randomUUID();
    const body = `${failure.category}: digest job ${job.id} stopped after ${Math.min(job.attempt_count + 1, 3)} attempt(s). Review the incident before resuming or manually retrying. Sending paused: yes.`;
    return {
      id, job_type: "admin_alert", recipient_id: admin.id, recipient_email: admin.email,
      recipient_name: admin.full_name, period_start: alertStart.toISOString(), period_end: alertEnd.toISOString(),
      event_count: 0, idempotency_key: `admin-alert/${incident.id}/${admin.id}`,
      payload_fingerprint: fingerprint(body), alert_subject: "Orr Recruiting transactional notification alert", alert_body: body,
    };
  });
  if (emailJobs.length) {
    const { error } = await db.from("transactional_digest_jobs").insert(emailJobs);
    if (error && error.code !== "23505") throw new Error(`admin_email_alert_queue_failed: ${error.message}`);
    await db.from("transactional_incidents").update({
      in_app_alerted_at: new Date().toISOString(), email_alert_queued_at: new Date().toISOString(),
    }).eq("id", incident.id);
  }
  // Alert jobs use the same cap/retry/idempotency path. Their failures do not
  // create another incident, preventing recursive alert storms.
  return rows.length;
}

class PermanentWorkerError extends Error {
  constructor(readonly category: string, message: string) { super(message); }
}

async function createCircuitBreakerAlerts(db: ReturnType<typeof createServiceClient>, reason: string) {
  const dedupeKey = `transactional-worker-pause:${fingerprint(reason)}`;
  const { data: incident, error: incidentError } = await db.from("transactional_incidents").upsert({
    dedupe_key: dedupeKey, category: "circuit_breaker", worker_name: WORKER_NAME,
    attempt_count: 0, error_summary: reason.slice(0, 1000), sending_paused: true,
    recommended_action: "Inspect queue volume and worker state; explicitly resolve and unpause only after the cause is understood.",
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id").maybeSingle();
  if (incidentError) throw new Error(`incident_persistence_failed: ${incidentError.message}`);
  if (!incident) return 0;
  const { data: admins, error: adminError } = await db.from("profiles").select("id,email,full_name")
    .eq("role", "super_admin").eq("is_active", true);
  if (adminError) throw new Error(`super_admin_lookup_failed: ${adminError.message}`);
  const timestamp = new Date();
  const inApp = (admins ?? []).map((admin) => ({
    recipient_id: admin.id, type: "transactional_error", title: "Transactional sending paused",
    body: `Circuit breaker: ${reason.slice(0, 500)}`,
    link: "/console/snapshot", send_after: timestamp.toISOString(), emailed_at: timestamp.toISOString(),
    dedupe_key: `${dedupeKey}:${admin.id}`,
  }));
  if (inApp.length) {
    const { error } = await db.from("notifications").insert(inApp);
    if (error && error.code !== "23505") throw new Error(`in_app_alert_failed: ${error.message}`);
  }
  const end = new Date(timestamp.getTime() + 60_000);
  const emailJobs = (admins ?? []).filter((admin) => admin.email).map((admin) => ({
    id: crypto.randomUUID(), job_type: "admin_alert", recipient_id: admin.id,
    recipient_email: admin.email, recipient_name: admin.full_name,
    period_start: timestamp.toISOString(), period_end: end.toISOString(), event_count: 0,
    idempotency_key: `admin-alert/${incident.id}/${admin.id}`, payload_fingerprint: fingerprint(reason),
    alert_subject: "Orr Recruiting transactional sending paused",
    alert_heading: "Transactional sending paused", alert_body: `Circuit breaker: ${reason}`,
    alert_cta_label: "Open admin snapshot", alert_cta_url: `${siteUrl()}/console/snapshot`,
  }));
  if (emailJobs.length) {
    const { error } = await db.from("transactional_digest_jobs").insert(emailJobs);
    if (error && error.code !== "23505") throw new Error(`admin_email_alert_queue_failed: ${error.message}`);
  }
  await db.from("transactional_incidents").update({
    in_app_alerted_at: timestamp.toISOString(), email_alert_queued_at: timestamp.toISOString(),
  }).eq("id", incident.id);
  return inApp.length;
}
