import assert from "node:assert/strict";
import {
  threadShowsReply, parseBounce, pollRepliesAndBounces,
  type ReplyBounceStore, type GmailReader, type OpenThread, type SentRef,
} from "./reply-tracking.server";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) { console.log(`  ok  ${name}`); return; }
  failures++; console.log(`FAIL  ${name}`);
}

// ---- pure: threadShowsReply ----
check("single message (our send) is not a reply", !threadShowsReply(["Mark <mark@orrfellowship.org>"], "mark@orrfellowship.org"));
check("a message from someone else is a reply", threadShowsReply(["Mark <mark@orrfellowship.org>", "Ada <ada@school.edu>"], "mark@orrfellowship.org"));
check("multiple messages all from the sender is not a reply", !threadShowsReply(["mark@orrfellowship.org", "Mark <mark@orrfellowship.org>"], "mark@orrfellowship.org"));

// ---- pure: parseBounce ----
check("mailer-daemon From is a bounce", parseBounce({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)", failedRecipients: "bad@x.edu" }).isBounce);
check("bounce pulls the failed recipient", parseBounce({ from: "mailer-daemon@google.com", failedRecipients: "bad@x.edu" }).recipient === "bad@x.edu");
check("bounce falls back to an address in the subject", parseBounce({ from: "postmaster@x.com", subject: "Undeliverable: to nope@school.edu" }).recipient === "nope@school.edu");
check("an ordinary reply is not a bounce", !parseBounce({ from: "Ada <ada@school.edu>", subject: "Re: hello" }).isBounce);

// ---- orchestration with fakes ----
function makeStore(open: OpenThread[], recent: Record<string, SentRef[]>) {
  const replied: string[] = []; const bounced: string[] = []; const timeline: any[] = [];
  const store: ReplyBounceStore = {
    async openThreads() { return open; },
    async recentSendsBySender(id) { return recent[id] ?? []; },
    async markReplied(id) { replied.push(id); },
    async markBounced(id) { bounced.push(id); },
    async logToTimeline(r) { timeline.push(r); },
  };
  return { store, replied, bounced, timeline };
}

async function run() {
  const open: OpenThread[] = [
    { id: "s-1", threadId: "t-1", candidateId: "c-1", senderUserId: "fellow-1", toEmail: "ada@school.edu", candidateName: "Ada Lovelace" },
    { id: "s-2", threadId: "t-2", candidateId: "c-2", senderUserId: "fellow-1", toEmail: "grace@school.edu", candidateName: "Grace Hopper" },
  ];
  const recent: Record<string, SentRef[]> = {
    "fellow-1": [{ id: "s-3", candidateId: "c-3", senderUserId: "fellow-1", toEmail: "bad@school.edu", candidateName: "Bad Addr", bounced: false }],
  };
  const { store, replied, bounced, timeline } = makeStore(open, recent);
  const notes: any[] = [];
  const reader: GmailReader = {
    // t-1 got a reply from Ada; t-2 only has our message.
    async threadFroms(_t, threadId) {
      return threadId === "t-1"
        ? ["Fellow <fellow@orrfellowship.org>", "Ada <ada@school.edu>"]
        : ["Fellow <fellow@orrfellowship.org>"];
    },
    async inboxMessageIds() { return ["m-1", "m-2"]; },
    async messageHeaders(_t, id) {
      return id === "m-1"
        ? { from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", failedRecipients: "bad@school.edu" }
        : { from: "Someone <someone@x.com>", subject: "Hi" };
    },
  };
  const summary = await pollRepliesAndBounces({
    store, reader,
    createSession: async () => ({ sender: "fellow@orrfellowship.org", accessToken: "tok" }),
    notify: async (n) => { notes.push(n); return {}; },
    now: () => Date.now(),
  });

  check("detects the one reply", summary.replies === 1 && replied.length === 1 && replied[0] === "s-1");
  check("does not flag the un-replied thread", !replied.includes("s-2"));
  check("logs the reply to the candidate timeline", timeline.some((t) => t.candidateId === "c-1" && /Replied/.test(t.body)));
  check("notifies the point person of the reply", notes.some((n) => n.type === "outreach_reply" && n.recipientId === "fellow-1"));
  check("detects the bounce and matches it to the send", summary.bounces === 1 && bounced.length === 1 && bounced[0] === "s-3");
  check("logs + notifies the bounce", timeline.some((t) => /bounced/i.test(t.body)) && notes.some((n) => n.type === "outreach_bounce"));

  // A send-only connection (no session) is skipped cleanly.
  const only = makeStore(open, {});
  const skipped = await pollRepliesAndBounces({ store: only.store, reader, createSession: async () => { throw new Error("send-only"); }, notify: async () => ({}), now: () => Date.now() });
  check("a connection without metadata scope is skipped, not crashed", skipped.replies === 0 && only.replied.length === 0);

  assert.equal(failures, 0);
  console.log(failures === 0 ? "\nAll reply-tracking checks passed." : `\n${failures} reply-tracking check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
void run();
