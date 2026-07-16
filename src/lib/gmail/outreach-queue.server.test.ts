import assert from "node:assert/strict";
import {
  isValidRecipient,
  isRetryableSendError,
  backoffMs,
  rollupCampaignStatus,
  buildFailureNotice,
  enqueueOutreachCampaign,
  drainOutreachQueue,
  OUTREACH_PER_SENDER_PER_DAY,
  type OutreachStore,
  type QueuedSend,
  type NewSendRow,
  type FinalizedCampaign,
} from "./outreach-queue.server";
import { GmailTestSendError } from "./test-send.server";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) { console.log(`  ok  ${name}`); return; }
  failures++; console.log(`FAIL  ${name}`);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
check("valid address passes", isValidRecipient("catherine.mazanek@orrfellowship.org"));
check("missing TLD dot fails (the misspelling case)", !isValidRecipient("olivia.lux@orrfellowship"));
check("missing @ fails", !isValidRecipient("jesse.orrfellowship.org"));
check("newline injection fails", !isValidRecipient("a@b.com\nbcc:x@y.com"));
check("multiple recipients fail", !isValidRecipient("a@b.com,c@d.com"));

check("429 error is retryable", isRetryableSendError(new GmailTestSendError("gmail_rate_limited", "throttled", 429)));
check("permission error is not retryable", !isRetryableSendError(new GmailTestSendError("gmail_permission_denied", "no", 409)));
check("plain error is not retryable", !isRetryableSendError(new Error("boom")));

check("backoff grows exponentially", backoffMs(1) === 30_000 && backoffMs(2) === 60_000 && backoffMs(3) === 120_000);

check("all sent → sent", rollupCampaignStatus({ sent: 5, failed: 0, skipped: 1 }) === "sent");
check("all excluded → completed without failure", rollupCampaignStatus({ sent: 0, failed: 0, skipped: 5 }) === "sent");
check("some failed → partial", rollupCampaignStatus({ sent: 4, failed: 1, skipped: 0 }) === "partial");
check("none sent → failed", rollupCampaignStatus({ sent: 0, failed: 3, skipped: 0 }) === "failed");

const notice = buildFailureNotice("Fall Intro", 8, [
  { toEmail: "olivia.lux@orrfellowship", reason: "Invalid email address", rateLimited: false },
  { toEmail: "x@y.org", reason: "Google is rate-limiting sends right now.", rateLimited: true },
], { senderName: "Mark Stolte" });
check("failure notice titles the count", notice.title.includes("2 of 8"));
check("failure notice lists the bad address", notice.body.includes("olivia.lux@orrfellowship"));
check("failure notice names the sender for admins", notice.body.includes("Mark Stolte"));
check("failure notice flags rate limiting", /rate-limit/i.test(notice.body));

// ---------------------------------------------------------------------------
// Fake store — in-memory model of the queue for orchestration tests
// ---------------------------------------------------------------------------
type Row = QueuedSend & { status: string; error: string | null; sentAt: number | null; nextAttemptAt: number };
function makeStore(seed: {
  rows?: Row[]; dnc?: Set<string>; sends7d?: Map<string, number>; senderSent24h?: number;
} = {}): { store: OutreachStore; rows: Row[]; notifications: any[]; campaigns: Map<string, any>; timeline: any[] } {
  const rows: Row[] = seed.rows ?? [];
  const campaigns = new Map<string, any>();
  const notifications: any[] = [];
  const timeline: any[] = [];
  const store: OutreachStore = {
    async findCampaignByKey() { return null; },
    async insertCampaign(c) { const id = `camp-${campaigns.size + 1}`; campaigns.set(id, { ...c, status: "queued", total: 0 }); return id; },
    async setCampaignTotal(id, total) { campaigns.get(id).total = total; },
    async insertSends(newRows: NewSendRow[]) {
      newRows.forEach((r, i) => rows.push({
        id: `s-${rows.length + i + 1}`, campaignId: r.campaignId, candidateId: r.candidateId, senderUserId: r.senderUserId,
        toEmail: r.toEmail, renderedSubject: r.renderedSubject, renderedBody: r.renderedBody, attempts: 0,
        status: r.status, error: r.error, sentAt: null, nextAttemptAt: 0,
      }));
    },
    async senderSends24h() { return seed.senderSent24h ?? 0; },
    async candidateFlags(ids) {
      const m = new Map<string, { doNotContact: boolean; sends7d: number }>();
      for (const id of ids) m.set(id, { doNotContact: seed.dnc?.has(id) ?? false, sends7d: seed.sends7d?.get(id) ?? 0 });
      return m;
    },
    async claimDueSends(limit, now) {
      return rows.filter((r) => r.status === "queued" && r.nextAttemptAt <= now).slice(0, limit)
        .map((r) => ({ id: r.id, campaignId: r.campaignId, candidateId: r.candidateId, senderUserId: r.senderUserId, toEmail: r.toEmail, renderedSubject: r.renderedSubject, renderedBody: r.renderedBody, attempts: r.attempts }));
    },
    async markSent(id, r) { const row = rows.find((x) => x.id === id)!; row.status = "sent"; row.sentAt = r.at; },
    async logToTimeline(r) { timeline.push(r); },
    async markFailed(id, r) { const row = rows.find((x) => x.id === id)!; row.status = "failed"; row.error = r.error; row.attempts = r.attempts; },
    async markSkipped(id, status) { rows.find((x) => x.id === id)!.status = status; },
    async requeue(id, r) { const row = rows.find((x) => x.id === id)!; row.status = "queued"; row.attempts = r.attempts; row.nextAttemptAt = r.nextAttemptAt; },
    async finalizeCampaign(campaignId): Promise<FinalizedCampaign | null> {
      const mine = rows.filter((r) => r.campaignId === campaignId);
      if (mine.some((r) => r.status === "queued")) return null;
      const c = campaigns.get(campaignId); if (c.status !== "queued") return { justCompleted: false, name: c.name, senderUserId: c.createdBy, total: c.total, failures: [] };
      c.status = "done";
      const failures = mine.filter((r) => r.status === "failed").map((r) => ({ toEmail: r.toEmail, reason: r.error ?? "", rateLimited: /rate-limit/i.test(r.error ?? "") }));
      return { justCompleted: true, name: c.name, senderUserId: c.createdBy, total: c.total, failures };
    },
    async loadAdminIds() { return ["admin-1"]; },
    async senderName() { return "Mark Stolte"; },
  };
  return { store, rows, notifications, campaigns, timeline };
}

const okSend = async () => ({ success: true as const, messageId: `m-${Math.random().toString(36).slice(2, 8)}`, threadId: "t-1" });
const session = async () => ({ sender: "fellow@orrfellowship.org", accessToken: "tok", fetchImpl: fetch });
const noSleep = async () => {};

async function run() {
  // Enqueue: valid + invalid + DNC + quota
  {
    const { store, rows } = makeStore({ dnc: new Set(["c-dnc"]), sends7d: new Map([["c-max", 2]]) });
    const res = await enqueueOutreachCampaign("sender-1", {
      campaignName: "Test", subject: "Hi {{first_name}}", body: "Body",
      recipients: [
        { candidateId: "c-ok", toEmail: "good@orrfellowship.org", renderedSubject: "Hi Sam", renderedBody: "Body" },
        { candidateId: "c-bad", toEmail: "bad@orrfellowship", renderedSubject: "s", renderedBody: "b" },
        { candidateId: "c-dnc", toEmail: "dnc@orrfellowship.org", renderedSubject: "s", renderedBody: "b" },
        { candidateId: "c-max", toEmail: "max@orrfellowship.org", renderedSubject: "s", renderedBody: "b" },
      ],
    }, { store });
    check("enqueue queues the valid recipient", res.queued === 1);
    check("enqueue marks the malformed address invalid→failed", res.invalid === 1 && rows.some((r) => r.toEmail === "bad@orrfellowship" && r.status === "failed"));
    check("enqueue skips do-not-contact", res.skippedDnc === 1);
    check("enqueue skips a candidate already at the weekly cap", res.skippedQuota === 1);
  }

  // Enqueue: per-sender daily cap
  {
    const { store } = makeStore({ senderSent24h: OUTREACH_PER_SENDER_PER_DAY - 1 });
    const res = await enqueueOutreachCampaign("sender-1", {
      campaignName: "Cap", subject: "s", body: "b",
      recipients: [
        { candidateId: null, toEmail: "a@x.org", renderedSubject: "s", renderedBody: "b" },
        { candidateId: null, toEmail: "b@x.org", renderedSubject: "s", renderedBody: "b" },
      ],
    }, { store });
    check("enqueue stops at the 300/day sender cap", res.queued === 1 && res.skippedQuota === 1);
  }

  // Enqueue: terminal-only campaigns do not wait forever for a drainer that
  // will never claim a row.
  {
    const { store, campaigns } = makeStore();
    const res = await enqueueOutreachCampaign("sender-1", {
      campaignName: "Invalid only", subject: "s", body: "b",
      recipients: [{ candidateId: "c-bad", toEmail: "bad@orrfellowship", renderedSubject: "s", renderedBody: "b" }],
    }, { store, now: () => 100 });
    check("enqueue finalizes a campaign with no sendable rows", res.queued === 0 && campaigns.get(res.campaignId)?.status === "done");
  }

  // Enqueue: concurrent requests can both miss the preflight lookup; the
  // unique-key loser must replay the winner rather than report failure.
  {
    const { store } = makeStore();
    let lookups = 0;
    const raced: OutreachStore = {
      ...store,
      async findCampaignByKey() { lookups++; return lookups === 1 ? null : { id: "camp-winner" }; },
      async insertCampaign() { throw new Error("duplicate key"); },
    };
    const res = await enqueueOutreachCampaign("sender-1", {
      campaignName: "Race", subject: "s", body: "b", idempotencyKey: "same-key", recipients: [],
    }, { store: raced });
    check("idempotency-key race replays the winning campaign", res.replayed && res.campaignId === "camp-winner");
  }

  // Drain: success + hard failure notifies sender and admin
  {
    const seedRows: Row[] = [
      { id: "s-1", campaignId: "camp-1", candidateId: null, senderUserId: "sender-1", toEmail: "ok@x.org", renderedSubject: "s", renderedBody: "b", attempts: 0, status: "queued", error: null, sentAt: null, nextAttemptAt: 0 },
      { id: "s-2", campaignId: "camp-1", candidateId: null, senderUserId: "sender-1", toEmail: "boom@x.org", renderedSubject: "s", renderedBody: "b", attempts: 0, status: "queued", error: null, sentAt: null, nextAttemptAt: 0 },
    ];
    const { store, rows, campaigns } = makeStore({ rows: seedRows });
    campaigns.set("camp-1", { name: "Camp", createdBy: "sender-1", status: "queued", total: 2 });
    const notes: any[] = [];
    const sendMessage = async (_t: string, raw: string) => {
      if (rows.find((r) => r.status === "queued" && r.toEmail === "boom@x.org")) { /* noop */ }
      // Fail the second address only.
      throw new GmailTestSendError("gmail_send_failed", "Google could not send this message.", 502);
    };
    // First succeed s-1, then fail s-2: use a stateful sender.
    let call = 0;
    const stateful = async (_t: string, _raw: string, _f: typeof fetch) => {
      call++;
      if (call === 1) return okSend();
      throw new GmailTestSendError("gmail_send_failed", "Google could not send this message.", 502);
    };
    const summary = await drainOutreachQueue({ store, createSession: session, sendMessage: stateful, sleep: noSleep, now: () => Date.now(), notify: async (n) => { notes.push(n); return {}; } });
    check("drain sends the good one and fails the bad one", summary.sent === 1 && summary.failed === 1);
    check("failed campaign notifies sender + admin", notes.length === 2 && notes.some((n) => n.recipientId === "sender-1") && notes.some((n) => n.recipientId === "admin-1"));
    check("notification uses the outreach_error type + dedupe key", notes.every((n) => n.type === "outreach_error" && n.dedupeKey === "outreach_fail:camp-1"));
    void sendMessage;
  }

  // Drain: 429 is retried (requeued with backoff), not failed
  {
    const seedRows: Row[] = [
      { id: "s-1", campaignId: "camp-1", candidateId: null, senderUserId: "sender-1", toEmail: "ok@x.org", renderedSubject: "s", renderedBody: "b", attempts: 0, status: "queued", error: null, sentAt: null, nextAttemptAt: 0 },
    ];
    const { store, rows, campaigns } = makeStore({ rows: seedRows });
    campaigns.set("camp-1", { name: "Camp", createdBy: "sender-1", status: "queued", total: 1 });
    const throttle = async () => { throw new GmailTestSendError("gmail_rate_limited", "throttled", 429); };
    const summary = await drainOutreachQueue({ store, createSession: session, sendMessage: throttle, sleep: noSleep, now: () => 1_000_000, notify: async () => ({}) });
    check("drain retries a 429 instead of failing", summary.retried === 1 && summary.failed === 0);
    check("retried row is re-queued with a future next_attempt_at", rows[0].status === "queued" && rows[0].attempts === 1 && rows[0].nextAttemptAt === 1_000_000 + 30_000);
  }

  // A message accepted by Gmail must never be relabeled as a Gmail send
  // failure merely because recording the message id failed.
  {
    const seedRows: Row[] = [
      { id: "s-1", campaignId: "camp-1", candidateId: null, senderUserId: "sender-1", toEmail: "ok@x.org", renderedSubject: "s", renderedBody: "b", attempts: 0, status: "queued", error: null, sentAt: null, nextAttemptAt: 0 },
    ];
    const { store, rows, campaigns } = makeStore({ rows: seedRows });
    campaigns.set("camp-1", { name: "Camp", createdBy: "sender-1", status: "queued", total: 1 });
    let gmailCalls = 0;
    let rejected = false;
    try {
      await drainOutreachQueue({
        store: { ...store, async markSent() { throw new Error("database unavailable"); } },
        createSession: session,
        sendMessage: async () => { gmailCalls++; return okSend(); },
        sleep: noSleep,
        now: () => 1_000_000,
        notify: async () => ({}),
      });
    } catch { rejected = true; }
    check("sent-message persistence failure is surfaced after retries", rejected && gmailCalls === 1);
    check("persistence failure is not mislabeled as a send failure", rows[0].status === "queued" && rows[0].error === null);
  }

  // Drain: DNC set after enqueue is caught at send time
  {
    const seedRows: Row[] = [
      { id: "s-1", campaignId: "camp-1", candidateId: "c-1", senderUserId: "sender-1", toEmail: "ok@x.org", renderedSubject: "s", renderedBody: "b", attempts: 0, status: "queued", error: null, sentAt: null, nextAttemptAt: 0 },
    ];
    const { store, rows, campaigns } = makeStore({ rows: seedRows, dnc: new Set(["c-1"]) });
    campaigns.set("camp-1", { name: "Camp", createdBy: "sender-1", status: "queued", total: 1 });
    let sends = 0;
    const summary = await drainOutreachQueue({ store, createSession: session, sendMessage: async () => { sends++; return okSend(); }, sleep: noSleep, now: () => Date.now(), notify: async () => ({}) });
    check("drain re-checks do-not-contact and skips without sending", summary.skippedDnc === 1 && sends === 0 && rows[0].status === "skipped_dnc");
  }

  // Drain: time budget stops mid-batch, leaves the rest queued
  {
    const seedRows: Row[] = Array.from({ length: 5 }, (_, i) => ({
      id: `s-${i + 1}`, campaignId: "camp-1", candidateId: null, senderUserId: "sender-1", toEmail: `r${i}@x.org`,
      renderedSubject: "s", renderedBody: "b", attempts: 0, status: "queued", error: null, sentAt: null, nextAttemptAt: 0,
    }));
    const { store, rows, campaigns } = makeStore({ rows: seedRows });
    campaigns.set("camp-1", { name: "Camp", createdBy: "sender-1", status: "queued", total: 5 });
    let t = 0;
    const summary = await drainOutreachQueue({ store, createSession: session, sendMessage: okSend, sleep: noSleep, budgetMs: 10, now: () => (t += 6), notify: async () => ({}) });
    check("drain honors the time budget and reports remaining", summary.sent + summary.remaining <= 5 && summary.remaining > 0);
    check("unprocessed rows stay queued for the next tick", rows.filter((r) => r.status === "queued").length === summary.remaining);
  }

  // Phase 5: a candidate send logs to the timeline; a team send (null candidate) does not.
  {
    const seedRows: Row[] = [
      { id: "s-1", campaignId: "camp-1", candidateId: "cand-9", senderUserId: "sender-1", toEmail: "a@x.org", renderedSubject: "Intro to Orr", renderedBody: "b", attempts: 0, status: "queued", error: null, sentAt: null, nextAttemptAt: 0 },
      { id: "s-2", campaignId: "camp-1", candidateId: null, senderUserId: "sender-1", toEmail: "team@x.org", renderedSubject: "Congrats", renderedBody: "b", attempts: 0, status: "queued", error: null, sentAt: null, nextAttemptAt: 0 },
    ];
    const { store, timeline, campaigns } = makeStore({ rows: seedRows });
    campaigns.set("camp-1", { name: "Camp", createdBy: "sender-1", status: "queued", total: 2 });
    await drainOutreachQueue({ store, createSession: session, sendMessage: okSend, sleep: noSleep, now: () => Date.now(), notify: async () => ({}) });
    check("a candidate send is logged to the timeline", timeline.length === 1 && timeline[0].candidateId === "cand-9" && timeline[0].subject === "Intro to Orr" && timeline[0].authorId === "sender-1");
    check("a team send (no candidate) is not timeline-logged", !timeline.some((t) => t.candidateId === null));
  }

  assert.equal(failures, 0);
  console.log(failures === 0 ? "\nAll outreach-queue checks passed." : `\n${failures} outreach-queue check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void run();
