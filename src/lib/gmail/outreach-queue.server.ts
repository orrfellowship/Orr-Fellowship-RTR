import { createServiceClient } from "@/lib/supabase/server";
import { queueNotification } from "@/lib/notify";
import {
  buildGmailMimeMessage,
  createGmailSendSessionForUser,
  sendRawGmailMessage,
  GmailTestSendError,
  type GmailSendResult,
  type GmailSendSession,
} from "./test-send.server";

// ============================================================================
// Outreach send queue — the durable engine behind "click Send and walk away".
//
// enqueueOutreachCampaign() writes a campaign + one 'queued' row per recipient
// and returns immediately. drainOutreachQueue() (run from /api/cron?job=outreach
// every minute, and poked once right after enqueue for instant first-send)
// sends the queued rows in time-budgeted, spaced chunks and marks each one.
//
// Guarantees:
//   • Sender identity is passed in from the session by the caller, never the
//     request body, and is stored on every send row.
//   • do_not_contact + the 2/candidate/7d and 300/sender/24h quotas are checked
//     at enqueue AND re-checked at drain (state can change in between).
//   • A crash leaves rows 'queued' for the next tick; sent rows are terminal —
//     partial failure never rolls back what already went out.
//   • Failed sends notify the sender AND admins/super-admins (system mail via
//     the notifications table → Resend), so a bad address or Gmail throttling
//     surfaces instead of sitting silently.
// ============================================================================

export const OUTREACH_PER_CANDIDATE_PER_WEEK = 2;
export const OUTREACH_PER_SENDER_PER_DAY = 300;
const MAX_ATTEMPTS = 5;              // give up on a row after this many 429s
const SEND_SPACING_MS = 1500;        // 1–2s between sends (Gmail throttles bursts)
const DRAIN_BUDGET_MS = 50_000;      // stop before Vercel's 60s function ceiling
const CLAIM_BATCH = 40;              // rows to pull per drain pass
const BACKOFF_BASE_MS = 30_000;      // 429 backoff: 30s, 60s, 120s, …
const CLAIM_LEASE_MS = 3 * 60_000;   // push a claimed row out so an overlapping run skips it

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

// Single, well-formed address. A misspelling that breaks this (e.g. a missing
// ".org") fails here at enqueue and never reaches Gmail — which is how a bad
// address shows up as an *immediate* failed send. A well-formed but wrong
// address instead sends OK and bounces later (handled by the phase-6 sweep).
const EMAIL_RE = (() => {
  const local = "[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+";
  const label = "[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?";
  return new RegExp(`^${local}@${label}(?:\\.${label})+$`, "i");
})();

export function isValidRecipient(email: string): boolean {
  const v = (email ?? "").trim();
  if (!v || v.length > 320 || /[\r\n,;]/.test(v)) return false;
  return EMAIL_RE.test(v);
}

// A 429/5xx from Gmail is transient throttling → retry with backoff. Everything
// else (bad permission, malformed, unknown) is a hard failure for this row.
export function isRetryableSendError(error: unknown): boolean {
  return error instanceof GmailTestSendError && error.code === "gmail_rate_limited";
}

export function backoffMs(attempts: number): number {
  const capped = Math.min(Math.max(attempts, 1), 6);
  return BACKOFF_BASE_MS * 2 ** (capped - 1);
}

export function rollupCampaignStatus(counts: { sent: number; failed: number; skipped: number }): "sent" | "partial" | "failed" {
  if (counts.sent > 0 && counts.failed === 0) return "sent";
  if (counts.sent === 0) return "failed";
  return "partial";
}

export type SendFailure = { toEmail: string; reason: string; rateLimited: boolean };

// The sender/admin notification for a campaign that finished with failures.
export function buildFailureNotice(
  campaignName: string,
  total: number,
  failures: SendFailure[],
  opts: { senderName?: string } = {},
): { title: string; body: string } {
  const failed = failures.length;
  const anyRateLimited = failures.some((f) => f.rateLimited);
  const shown = failures.slice(0, 10);
  const lines = shown.map((f) => `• ${f.toEmail} — ${f.reason}`);
  if (failures.length > shown.length) lines.push(`…and ${failures.length - shown.length} more`);
  const senderLine = opts.senderName ? `Sent by ${opts.senderName}.\n` : "";
  const rateLine = anyRateLimited
    ? "\nGoogle is rate-limiting this account — retries were attempted but some gave up. If this keeps happening, the fellow may be near Gmail's daily sending limit."
    : "";
  return {
    title: `“${campaignName}” — ${failed} of ${total} message${total === 1 ? "" : "s"} couldn't send`,
    body: `${senderLine}${lines.join("\n")}${rateLine}`,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnqueueRecipient = {
  candidateId: string | null;   // null for the demo (fictional candidates)
  toEmail: string;
  renderedSubject: string;
  renderedBody: string;
};

export type EnqueueInput = {
  campaignName: string;
  subject: string;              // template kept for audit; rows carry the rendered copy
  body: string;
  recipients: EnqueueRecipient[];
  idempotencyKey?: string | null;
};

export type EnqueueResult = {
  campaignId: string;
  queued: number;
  skippedDnc: number;
  skippedQuota: number;
  invalid: number;
  replayed: boolean;            // true if an idempotency key matched an existing campaign
};

export type QueuedSend = {
  id: string;
  campaignId: string;
  candidateId: string | null;
  senderUserId: string;
  toEmail: string;
  renderedSubject: string;
  renderedBody: string;
  attempts: number;
};

export type CandidateFlags = { doNotContact: boolean; sends7d: number };

export type DrainSummary = {
  picked: number; sent: number; failed: number;
  skippedDnc: number; skippedQuota: number; retried: number;
  remaining: number;             // due rows left unprocessed when the budget ran out
};

// Injected side-effects (default to Supabase / real Gmail; overridden in tests).
export type OutreachStore = {
  findCampaignByKey: (createdBy: string, key: string) => Promise<{ id: string } | null>;
  insertCampaign: (c: { createdBy: string; name: string; subject: string; body: string; idempotencyKey: string | null }) => Promise<string>;
  setCampaignTotal: (campaignId: string, total: number) => Promise<void>;
  insertSends: (rows: NewSendRow[]) => Promise<void>;
  senderSends24h: (senderUserId: string, now: number) => Promise<number>;
  candidateFlags: (candidateIds: string[], now: number) => Promise<Map<string, CandidateFlags>>;
  claimDueSends: (limit: number, now: number, leaseMs: number) => Promise<QueuedSend[]>;
  markSent: (id: string, r: { messageId: string; threadId: string | null; at: number }) => Promise<void>;
  // Record a sent outreach on the candidate's contact timeline (outreach_log).
  // Best-effort: a logging failure must never fail an email that already left.
  logToTimeline: (r: { candidateId: string; authorId: string; subject: string }) => Promise<void>;
  markFailed: (id: string, r: { error: string; attempts: number }) => Promise<void>;
  markSkipped: (id: string, status: "skipped_dnc" | "skipped_quota") => Promise<void>;
  requeue: (id: string, r: { attempts: number; nextAttemptAt: number }) => Promise<void>;
  finalizeCampaign: (campaignId: string, now: number) => Promise<FinalizedCampaign | null>;
  loadAdminIds: () => Promise<string[]>;
  senderName: (userId: string) => Promise<string | null>;
};

export type NewSendRow = {
  campaignId: string; candidateId: string | null; senderUserId: string; toEmail: string;
  renderedSubject: string; renderedBody: string;
  status: "queued" | "failed" | "skipped_dnc" | "skipped_quota"; error: string | null;
};

export type FinalizedCampaign = {
  justCompleted: boolean; name: string; senderUserId: string;
  total: number; failures: SendFailure[];
};

export type DrainDeps = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
  batchSize?: number;
  createSession?: (userId: string) => Promise<GmailSendSession>;
  sendMessage?: (accessToken: string, raw: string, fetchImpl: typeof fetch) => Promise<GmailSendResult>;
  store?: Partial<OutreachStore>;
  notify?: (n: Parameters<typeof queueNotification>[0]) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export async function enqueueOutreachCampaign(
  senderUserId: string,
  input: EnqueueInput,
  deps: { store?: Partial<OutreachStore>; now?: () => number } = {},
): Promise<EnqueueResult> {
  const store = { ...defaultStore(), ...deps.store };
  const now = (deps.now ?? Date.now)();
  const key = input.idempotencyKey?.trim() || null;

  if (key) {
    const existing = await store.findCampaignByKey(senderUserId, key);
    if (existing) return { campaignId: existing.id, queued: 0, skippedDnc: 0, skippedQuota: 0, invalid: 0, replayed: true };
  }

  const campaignId = await store.insertCampaign({
    createdBy: senderUserId, name: input.campaignName, subject: input.subject, body: input.body, idempotencyKey: key,
  });

  // Quota budget for this sender across the batch (sent in last 24h counts).
  let senderRemaining = OUTREACH_PER_SENDER_PER_DAY - (await store.senderSends24h(senderUserId, now));
  const candidateIds = input.recipients.map((r) => r.candidateId).filter((v): v is string => !!v);
  const flags = candidateIds.length ? await store.candidateFlags(candidateIds, now) : new Map<string, CandidateFlags>();
  // Track within-batch per-candidate counts so a candidate can't be double-queued.
  const perCandidateQueued = new Map<string, number>();

  const rows: NewSendRow[] = [];
  let queued = 0, skippedDnc = 0, skippedQuota = 0, invalid = 0;
  for (const r of input.recipients) {
    const base = { campaignId, candidateId: r.candidateId, senderUserId, toEmail: r.toEmail, renderedSubject: r.renderedSubject, renderedBody: r.renderedBody };
    if (!isValidRecipient(r.toEmail)) {
      rows.push({ ...base, status: "failed", error: "Invalid email address" }); invalid++; continue;
    }
    const cf = r.candidateId ? flags.get(r.candidateId) : undefined;
    if (cf?.doNotContact) { rows.push({ ...base, status: "skipped_dnc", error: null }); skippedDnc++; continue; }
    const already = (cf?.sends7d ?? 0) + (r.candidateId ? (perCandidateQueued.get(r.candidateId) ?? 0) : 0);
    if (r.candidateId && already >= OUTREACH_PER_CANDIDATE_PER_WEEK) { rows.push({ ...base, status: "skipped_quota", error: null }); skippedQuota++; continue; }
    if (senderRemaining <= 0) { rows.push({ ...base, status: "skipped_quota", error: null }); skippedQuota++; continue; }
    rows.push({ ...base, status: "queued", error: null });
    queued++; senderRemaining--;
    if (r.candidateId) perCandidateQueued.set(r.candidateId, (perCandidateQueued.get(r.candidateId) ?? 0) + 1);
  }

  await store.insertSends(rows);
  await store.setCampaignTotal(campaignId, rows.length);
  return { campaignId, queued, skippedDnc, skippedQuota, invalid, replayed: false };
}

// ---------------------------------------------------------------------------
// Drain
// ---------------------------------------------------------------------------

export async function drainOutreachQueue(deps: DrainDeps = {}): Promise<DrainSummary> {
  const store = { ...defaultStore(), ...deps.store };
  const nowFn = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms)));
  const budgetMs = deps.budgetMs ?? DRAIN_BUDGET_MS;
  const createSession = deps.createSession ?? createGmailSendSessionForUser;
  const sendMessage = deps.sendMessage ?? sendRawGmailMessage;
  const notify = deps.notify ?? queueNotification;
  const startedAt = nowFn();

  const due = await store.claimDueSends(deps.batchSize ?? CLAIM_BATCH, startedAt, CLAIM_LEASE_MS);
  const summary: DrainSummary = { picked: due.length, sent: 0, failed: 0, skippedDnc: 0, skippedQuota: 0, retried: 0, remaining: 0 };
  if (!due.length) return summary;

  const sessions = new Map<string, GmailSendSession | { error: string }>();
  const touchedCampaigns = new Set<string>();
  // Re-check DNC + per-candidate quota against current state for this batch.
  const candidateIds = Array.from(new Set(due.map((d) => d.candidateId).filter((v): v is string => !!v)));
  const flags = candidateIds.length ? await store.candidateFlags(candidateIds, startedAt) : new Map<string, CandidateFlags>();
  const senderSent24h = new Map<string, number>();

  let processed = 0;
  for (const row of due) {
    if (nowFn() - startedAt > budgetMs) { summary.remaining = due.length - processed; break; }
    processed++;
    touchedCampaigns.add(row.campaignId);

    // Re-check guards (state may have changed since enqueue).
    const cf = row.candidateId ? flags.get(row.candidateId) : undefined;
    if (cf?.doNotContact) { await store.markSkipped(row.id, "skipped_dnc"); summary.skippedDnc++; continue; }
    if (row.candidateId && (cf?.sends7d ?? 0) >= OUTREACH_PER_CANDIDATE_PER_WEEK) { await store.markSkipped(row.id, "skipped_quota"); summary.skippedQuota++; continue; }
    if (!senderSent24h.has(row.senderUserId)) senderSent24h.set(row.senderUserId, await store.senderSends24h(row.senderUserId, startedAt));
    if ((senderSent24h.get(row.senderUserId) ?? 0) >= OUTREACH_PER_SENDER_PER_DAY) { await store.markSkipped(row.id, "skipped_quota"); summary.skippedQuota++; continue; }

    // One Gmail session per sender per drain pass (handles token refresh once).
    let session = sessions.get(row.senderUserId);
    if (!session) {
      try { session = await createSession(row.senderUserId); }
      catch (e) { session = { error: e instanceof GmailTestSendError ? e.message : "Gmail connection unavailable — reconnect Gmail." }; }
      sessions.set(row.senderUserId, session);
    }
    if ("error" in session) {
      const attempts = row.attempts + 1;
      await store.markFailed(row.id, { error: session.error, attempts });
      summary.failed++; continue;
    }

    const { raw } = buildGmailMimeMessage({ sender: session.sender, recipient: row.toEmail, subject: row.renderedSubject, body: row.renderedBody });
    try {
      const result = await sendMessage(session.accessToken, raw, session.fetchImpl);
      await store.markSent(row.id, { messageId: result.messageId, threadId: result.threadId, at: nowFn() });
      // Log to the candidate's timeline (real candidates only; team sends have
      // no candidate_id). Best-effort — the email already left.
      if (row.candidateId) {
        try { await store.logToTimeline({ candidateId: row.candidateId, authorId: row.senderUserId, subject: row.renderedSubject }); }
        catch { /* timeline logging is non-critical */ }
      }
      summary.sent++;
      senderSent24h.set(row.senderUserId, (senderSent24h.get(row.senderUserId) ?? 0) + 1);
      if (row.candidateId && cf) cf.sends7d += 1;
    } catch (e) {
      const attempts = row.attempts + 1;
      if (isRetryableSendError(e) && attempts < MAX_ATTEMPTS) {
        await store.requeue(row.id, { attempts, nextAttemptAt: nowFn() + backoffMs(attempts) });
        summary.retried++;
      } else {
        const reason = e instanceof GmailTestSendError ? e.message : "Google could not send this message.";
        await store.markFailed(row.id, { error: reason, attempts });
        summary.failed++;
      }
    }
    if (processed < due.length && nowFn() - startedAt <= budgetMs) await sleep(SEND_SPACING_MS);
  }

  // Finalize any campaign whose queue just emptied; notify on failures.
  for (const campaignId of touchedCampaigns) {
    const done = await store.finalizeCampaign(campaignId, nowFn());
    if (!done?.justCompleted || done.failures.length === 0) continue;
    const senderName = (await store.senderName(done.senderUserId)) ?? undefined;
    const senderNotice = buildFailureNotice(done.name, done.total, done.failures);
    await notify({ recipientId: done.senderUserId, type: "outreach_error", title: senderNotice.title, body: senderNotice.body, link: "/console/email-campaigns", dedupeKey: `outreach_fail:${campaignId}` });
    const adminNotice = buildFailureNotice(done.name, done.total, done.failures, { senderName });
    for (const adminId of await store.loadAdminIds()) {
      if (adminId === done.senderUserId) continue; // already notified as the sender
      await notify({ recipientId: adminId, type: "outreach_error", title: adminNotice.title, body: adminNotice.body, link: "/console/email-campaigns", dedupeKey: `outreach_fail:${campaignId}` });
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Default Supabase-backed store
// ---------------------------------------------------------------------------

function defaultStore(): OutreachStore {
  // Lazy so a fully-injected store (tests) never touches Supabase env/config.
  let client: ReturnType<typeof createServiceClient> | null = null;
  const db = () => (client ??= createServiceClient());
  return {
    async findCampaignByKey(createdBy, key) {
      const { data } = await db().from("outreach_campaigns").select("id").eq("created_by", createdBy).eq("idempotency_key", key).maybeSingle();
      return data ? { id: (data as any).id } : null;
    },
    async insertCampaign(c) {
      const { data, error } = await db().from("outreach_campaigns")
        .insert({ created_by: c.createdBy, name: c.name, subject: c.subject, body: c.body, idempotency_key: c.idempotencyKey, status: "queued" })
        .select("id").single();
      if (error || !data) throw new Error(error?.message ?? "Failed to create campaign");
      return (data as any).id;
    },
    async setCampaignTotal(campaignId, total) {
      await db().from("outreach_campaigns").update({ total_count: total, updated_at: new Date().toISOString() }).eq("id", campaignId);
    },
    async insertSends(rows) {
      if (!rows.length) return;
      const payload = rows.map((r) => ({
        campaign_id: r.campaignId, candidate_id: r.candidateId, sender_user_id: r.senderUserId, to_email: r.toEmail,
        rendered_subject: r.renderedSubject, rendered_body: r.renderedBody, status: r.status, error: r.error,
        ...(r.status === "queued" ? {} : { sent_at: null }),
      }));
      const { error } = await db().from("outreach_sends").insert(payload);
      if (error) throw new Error(error.message);
    },
    async senderSends24h(senderUserId, now) {
      const since = new Date(now - DAY_MS).toISOString();
      const { count } = await db().from("outreach_sends").select("id", { count: "exact", head: true })
        .eq("sender_user_id", senderUserId).not("sent_at", "is", null).gte("sent_at", since);
      return count ?? 0;
    },
    async candidateFlags(candidateIds, now) {
      const map = new Map<string, CandidateFlags>();
      if (!candidateIds.length) return map;
      const { data: cands } = await db().from("candidates").select("id, do_not_contact").in("id", candidateIds);
      for (const c of cands ?? []) map.set((c as any).id, { doNotContact: !!(c as any).do_not_contact, sends7d: 0 });
      const since = new Date(now - WEEK_MS).toISOString();
      const { data: sends } = await db().from("outreach_sends").select("candidate_id").in("candidate_id", candidateIds).not("sent_at", "is", null).gte("sent_at", since);
      for (const s of sends ?? []) {
        const id = (s as any).candidate_id as string;
        const f = map.get(id) ?? { doNotContact: false, sends7d: 0 };
        f.sends7d += 1; map.set(id, f);
      }
      return map;
    },
    async claimDueSends(limit, now, leaseMs) {
      const nowIso = new Date(now).toISOString();
      const { data } = await db().from("outreach_sends")
        .select("id, campaign_id, candidate_id, sender_user_id, to_email, rendered_subject, rendered_body, attempts")
        .eq("status", "queued").lte("next_attempt_at", nowIso).order("next_attempt_at", { ascending: true }).limit(limit);
      const rows = (data ?? []) as any[];
      if (rows.length) {
        const leaseIso = new Date(now + leaseMs).toISOString();
        await db().from("outreach_sends").update({ next_attempt_at: leaseIso }).in("id", rows.map((r) => r.id));
      }
      return rows.map((r) => ({
        id: r.id, campaignId: r.campaign_id, candidateId: r.candidate_id, senderUserId: r.sender_user_id,
        toEmail: r.to_email, renderedSubject: r.rendered_subject, renderedBody: r.rendered_body, attempts: r.attempts,
      }));
    },
    async markSent(id, r) {
      await db().from("outreach_sends").update({ status: "sent", gmail_message_id: r.messageId, gmail_thread_id: r.threadId, sent_at: new Date(r.at).toISOString(), error: null }).eq("id", id);
    },
    async logToTimeline(r) {
      await db().from("outreach_log").insert({ candidate_id: r.candidateId, author_id: r.authorId, body: `📧 Emailed — ${r.subject}` });
    },
    async markFailed(id, r) {
      await db().from("outreach_sends").update({ status: "failed", error: r.error, attempts: r.attempts }).eq("id", id);
    },
    async markSkipped(id, status) {
      await db().from("outreach_sends").update({ status }).eq("id", id);
    },
    async requeue(id, r) {
      await db().from("outreach_sends").update({ status: "queued", attempts: r.attempts, next_attempt_at: new Date(r.nextAttemptAt).toISOString() }).eq("id", id);
    },
    async finalizeCampaign(campaignId, now) {
      const { data: rows } = await db().from("outreach_sends").select("status, to_email, error").eq("campaign_id", campaignId);
      const all = (rows ?? []) as any[];
      const remaining = all.filter((r) => r.status === "queued").length;
      if (remaining > 0) return null; // still draining
      const { data: camp } = await db().from("outreach_campaigns").select("name, created_by, status, total_count").eq("id", campaignId).maybeSingle();
      if (!camp) return null;
      const already = (camp as any).status;
      if (already === "sent" || already === "partial" || already === "failed" || already === "canceled") return { justCompleted: false, name: (camp as any).name, senderUserId: (camp as any).created_by, total: (camp as any).total_count, failures: [] };
      const sent = all.filter((r) => r.status === "sent").length;
      const failedRows = all.filter((r) => r.status === "failed");
      const skipped = all.filter((r) => r.status === "skipped_dnc" || r.status === "skipped_quota").length;
      const status = rollupCampaignStatus({ sent, failed: failedRows.length, skipped });
      await db().from("outreach_campaigns").update({ status, completed_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() }).eq("id", campaignId);
      const failures: SendFailure[] = failedRows.map((r) => ({ toEmail: r.to_email, reason: r.error ?? "Send failed", rateLimited: /rate-limit/i.test(r.error ?? "") }));
      return { justCompleted: true, name: (camp as any).name, senderUserId: (camp as any).created_by, total: (camp as any).total_count, failures };
    },
    async loadAdminIds() {
      const { data } = await db().from("profiles").select("id").in("role", ["admin", "super_admin"]).eq("is_active", true);
      return (data ?? []).map((p) => (p as any).id as string);
    },
    async senderName(userId) {
      const { data } = await db().from("profiles").select("full_name").eq("id", userId).maybeSingle();
      return data ? ((data as any).full_name as string) : null;
    },
  };
}
