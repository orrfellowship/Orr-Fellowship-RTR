import { createServiceClient } from "@/lib/supabase/server";
import { queueNotification } from "@/lib/notify";
import { createGmailSendSessionForUser, GmailTestSendError } from "./test-send.server";

// ============================================================================
// Reply & bounce detection (Phase 7). Runs from /api/cron?job=gmail-sync using
// the gmail.metadata scope (headers/labels only — never message bodies, no
// open-tracking pixels). Replies are the decision-grade signal.
//
//  • Reply: for an outreach_sends row with a thread id and no replied_at yet,
//    fetch the thread's message metadata; if a message from someone other than
//    the sender appears, stamp replied_at, log the candidate timeline, and
//    notify the point person.
//  • Bounce: Gmail returns success on send; the bounce arrives later as a
//    mailer-daemon message in the sender's inbox. We can't search (the metadata
//    scope forbids the q param), so we scan recent INBOX message headers, detect
//    delivery failures, and match the failed address back to a recent send.
// ============================================================================

const REPLY_BATCH = 60;        // open threads to check per run
const INBOX_SCAN = 25;         // recent inbox messages to scan per sender for bounces
const POLL_BUDGET_MS = 50_000; // stop before Vercel's 60s

// ---------------------------------------------------------------------------
// Pure detection helpers (unit-tested)
// ---------------------------------------------------------------------------

// A thread shows a reply when it has more than our one sent message AND at least
// one message comes From someone other than the sender.
export function threadShowsReply(fromHeaders: string[], senderEmail: string): boolean {
  if (fromHeaders.length <= 1) return false;
  const s = senderEmail.toLowerCase();
  return fromHeaders.some((f) => !!f && !f.toLowerCase().includes(s));
}

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery (subsystem|system)/i;
const BOUNCE_SUBJECT = /delivery status notification|undeliverable|delivery (failed|incomplete)|returned mail|failure notice|address not found/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

// Detect a bounce from a message's metadata headers and pull out the address
// that failed (from X-Failed-Recipients, else the first address in the subject).
export function parseBounce(headers: { from?: string; subject?: string; failedRecipients?: string }): { isBounce: boolean; recipient: string | null } {
  const isBounce = BOUNCE_FROM.test(headers.from ?? "") || BOUNCE_SUBJECT.test(headers.subject ?? "");
  if (!isBounce) return { isBounce: false, recipient: null };
  const failed = (headers.failedRecipients ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)[0]
    ?? (headers.subject ?? "").match(EMAIL_RE)?.[0] ?? null;
  return { isBounce: true, recipient: failed ? failed.toLowerCase() : null };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OpenThread = { id: string; threadId: string; candidateId: string | null; senderUserId: string; toEmail: string; candidateName: string | null };
export type SentRef = { id: string; candidateId: string | null; senderUserId: string; toEmail: string; candidateName: string | null; bounced: boolean };

export type ReplyBounceStore = {
  openThreads: (limit: number) => Promise<OpenThread[]>;
  recentSendsBySender: (senderUserId: string) => Promise<SentRef[]>;
  markReplied: (sendId: string, at: number) => Promise<void>;
  markBounced: (sendId: string, at: number) => Promise<void>;
  logToTimeline: (r: { candidateId: string; authorId: string; body: string }) => Promise<void>;
};

export type GmailReader = {
  threadFroms: (accessToken: string, threadId: string) => Promise<string[]>;
  inboxMessageIds: (accessToken: string, max: number) => Promise<string[]>;
  messageHeaders: (accessToken: string, messageId: string) => Promise<{ from?: string; subject?: string; failedRecipients?: string }>;
};

export type ReplyBounceDeps = {
  now?: () => number;
  budgetMs?: number;
  store?: Partial<ReplyBounceStore>;
  reader?: GmailReader;
  createSession?: (userId: string) => Promise<{ sender: string; accessToken: string }>;
  notify?: (n: Parameters<typeof queueNotification>[0]) => Promise<unknown>;
};

export type ReplyBounceSummary = { threadsChecked: number; replies: number; bounces: number; sendersScanned: number };

// ---------------------------------------------------------------------------
// Poll
// ---------------------------------------------------------------------------

export async function pollRepliesAndBounces(deps: ReplyBounceDeps = {}): Promise<ReplyBounceSummary> {
  const store = { ...defaultStore(), ...deps.store };
  const nowFn = deps.now ?? Date.now;
  const budgetMs = deps.budgetMs ?? POLL_BUDGET_MS;
  const createSession = deps.createSession ?? ((id: string) => createGmailSendSessionForUser(id));
  const notify = deps.notify ?? queueNotification;
  const reader = deps.reader ?? defaultReader;
  const started = nowFn();
  const summary: ReplyBounceSummary = { threadsChecked: 0, replies: 0, bounces: 0, sendersScanned: 0 };

  const open = await store.openThreads(deps.budgetMs ? 1000 : REPLY_BATCH);
  // Session per sender, cached; a revoked/send-only connection is skipped.
  const sessions = new Map<string, { sender: string; accessToken: string } | null>();
  const getSession = async (userId: string) => {
    if (!sessions.has(userId)) {
      try { sessions.set(userId, await createSession(userId)); }
      catch { sessions.set(userId, null); }
    }
    return sessions.get(userId) ?? null;
  };

  // ---- replies ----
  const bySender = new Set<string>();
  for (const t of open) {
    if (nowFn() - started > budgetMs) break;
    bySender.add(t.senderUserId);
    const session = await getSession(t.senderUserId);
    if (!session) continue;
    summary.threadsChecked++;
    let froms: string[];
    try { froms = await reader.threadFroms(session.accessToken, t.threadId); }
    catch { continue; }
    if (!threadShowsReply(froms, session.sender)) continue;
    await store.markReplied(t.id, nowFn());
    summary.replies++;
    if (t.candidateId) {
      await store.logToTimeline({ candidateId: t.candidateId, authorId: t.senderUserId, body: "📬 Replied to your outreach" });
      await notify({ recipientId: t.senderUserId, type: "outreach_reply", title: `${t.candidateName ?? "A candidate"} replied`, body: `${t.candidateName ?? t.toEmail} replied to your outreach email.`, candidateId: t.candidateId, dedupeKey: `outreach_reply:${t.id}` });
    }
  }

  // ---- bounces ---- scan each active sender's recent inbox for mailer-daemon.
  for (const senderUserId of bySender) {
    if (nowFn() - started > budgetMs) break;
    const session = await getSession(senderUserId);
    if (!session) continue;
    summary.sendersScanned++;
    let ids: string[];
    try { ids = await reader.inboxMessageIds(session.accessToken, INBOX_SCAN); }
    catch { continue; }
    const recent = await store.recentSendsBySender(senderUserId);
    const byEmail = new Map(recent.filter((s) => !s.bounced).map((s) => [s.toEmail.toLowerCase(), s]));
    if (byEmail.size === 0) continue;
    for (const messageId of ids) {
      if (nowFn() - started > budgetMs) break;
      let headers;
      try { headers = await reader.messageHeaders(session.accessToken, messageId); }
      catch { continue; }
      const { isBounce, recipient } = parseBounce(headers);
      if (!isBounce || !recipient) continue;
      const match = byEmail.get(recipient);
      if (!match) continue;
      await store.markBounced(match.id, nowFn());
      byEmail.delete(recipient);
      summary.bounces++;
      if (match.candidateId) {
        await store.logToTimeline({ candidateId: match.candidateId, authorId: senderUserId, body: `✉️ Outreach bounced — ${match.toEmail} is undeliverable` });
        await notify({ recipientId: senderUserId, type: "outreach_bounce", title: `Email bounced: ${match.candidateName ?? match.toEmail}`, body: `Your outreach to ${match.toEmail} bounced — the address looks bad. Update it before retrying.`, candidateId: match.candidateId, dedupeKey: `outreach_bounce:${match.id}` });
      }
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Default Supabase store + real Gmail reader (thin; metadata scope)
// ---------------------------------------------------------------------------

function defaultStore(): ReplyBounceStore {
  let client: ReturnType<typeof createServiceClient> | null = null;
  const db = () => (client ??= createServiceClient());
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  return {
    async openThreads(limit) {
      const since = new Date(Date.now() - THIRTY_DAYS).toISOString();
      const { data } = await db().from("outreach_sends")
        .select("id, gmail_thread_id, candidate_id, sender_user_id, to_email, candidates(name)")
        .not("gmail_thread_id", "is", null).is("replied_at", null).eq("status", "sent").gte("sent_at", since)
        .order("sent_at", { ascending: false }).limit(limit);
      return (data ?? []).map((r: any) => ({ id: r.id, threadId: r.gmail_thread_id, candidateId: r.candidate_id, senderUserId: r.sender_user_id, toEmail: r.to_email, candidateName: r.candidates?.name ?? null }));
    },
    async recentSendsBySender(senderUserId) {
      const since = new Date(Date.now() - THIRTY_DAYS).toISOString();
      const { data } = await db().from("outreach_sends")
        .select("id, candidate_id, sender_user_id, to_email, bounced_at, candidates(name)")
        .eq("sender_user_id", senderUserId).eq("status", "sent").gte("sent_at", since);
      return (data ?? []).map((r: any) => ({ id: r.id, candidateId: r.candidate_id, senderUserId: r.sender_user_id, toEmail: r.to_email, candidateName: r.candidates?.name ?? null, bounced: !!r.bounced_at }));
    },
    async markReplied(sendId, at) { await db().from("outreach_sends").update({ replied_at: new Date(at).toISOString() }).eq("id", sendId); },
    async markBounced(sendId, at) { await db().from("outreach_sends").update({ bounced_at: new Date(at).toISOString() }).eq("id", sendId); },
    async logToTimeline(r) { await db().from("outreach_log").insert({ candidate_id: r.candidateId, author_id: r.authorId, body: r.body }); },
  };
}

async function gmailGet(accessToken: string, path: string): Promise<any> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
  });
  if (!res.ok) throw new GmailTestSendError("gmail_read_failed", "Could not read Gmail metadata.", res.status);
  return res.json();
}

const headerValue = (payload: any, name: string): string | undefined =>
  (payload?.headers ?? []).find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value;

const defaultReader: GmailReader = {
  async threadFroms(accessToken, threadId) {
    const data = await gmailGet(accessToken, `threads/${threadId}?format=metadata&metadataHeaders=From`);
    return (data.messages ?? []).map((m: any) => headerValue(m.payload, "From") ?? "").filter(Boolean);
  },
  async inboxMessageIds(accessToken, max) {
    const data = await gmailGet(accessToken, `messages?labelIds=INBOX&maxResults=${max}`);
    return (data.messages ?? []).map((m: any) => m.id as string);
  },
  async messageHeaders(accessToken, messageId) {
    const data = await gmailGet(accessToken, `messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=X-Failed-Recipients`);
    return { from: headerValue(data.payload, "From"), subject: headerValue(data.payload, "Subject"), failedRecipients: headerValue(data.payload, "X-Failed-Recipients") };
  },
};
