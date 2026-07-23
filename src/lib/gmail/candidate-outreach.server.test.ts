import assert from "node:assert/strict";
import { buildCandidateRecipients, enqueueCandidateCampaign, buildUserRecipients, enqueueUsersCampaign, excludePreviouslyEmailedUsers, type OutreachCandidate } from "./candidate-outreach.server";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) { console.log(`  ok  ${name}`); return; }
  failures++; console.log(`FAIL  ${name}`);
}

const cand = (over: Partial<OutreachCandidate> = {}): OutreachCandidate => ({
  id: "c1", name: "Catherine Mazanek", email: "catherine@school.edu", stage: "Contacted",
  gradDate: "May 2027", pointPersonId: "fellow-1", schoolLabel: "IU Indianapolis", pointPersonName: "Mark Stolte", ...over,
});

// Assignment guard — the security boundary.
{
  const mine = cand({ id: "mine", pointPersonId: "fellow-1" });
  const theirs = cand({ id: "theirs", pointPersonId: "fellow-2" });
  const asFellow = buildCandidateRecipients([mine, theirs], { subject: "s", body: "b", senderUserId: "fellow-1", isAdmin: false });
  check("a fellow can email their own assigned candidate", asFellow.recipients.some((r) => r.candidateId === "mine"));
  check("a fellow CANNOT email someone else's candidate", !asFellow.recipients.some((r) => r.candidateId === "theirs") && asFellow.skippedUnassigned.includes("theirs"));

  const asAdmin = buildCandidateRecipients([mine, theirs], { subject: "s", body: "b", senderUserId: "admin-1", isAdmin: true });
  check("an admin can email any candidate", asAdmin.recipients.length === 2 && asAdmin.skippedUnassigned.length === 0);
}

// Token rendering from real fields.
{
  const { recipients } = buildCandidateRecipients([cand()], {
    subject: "Hi {{candidate_first_name}} ({{class_year}})",
    body: "You're at {{school}}, stage {{stage}}. Reach out to {{fellow_point_person}}.",
    senderUserId: "fellow-1", isAdmin: false,
  });
  check("subject renders first name + class year", recipients[0].renderedSubject === "Hi Catherine (2027)");
  check("body renders specific school, stage, point person", recipients[0].renderedBody === "You're at IU Indianapolis, stage Contacted. Reach out to Mark Stolte.");
  check("recipient carries the real candidate id + email", recipients[0].candidateId === "c1" && recipients[0].toEmail === "catherine@school.edu");
}

// A missing email is passed through (blank) — the queue engine marks it invalid,
// rather than this layer silently dropping it.
{
  const { recipients } = buildCandidateRecipients([cand({ email: null })], { subject: "s", body: "b", senderUserId: "fellow-1", isAdmin: false });
  check("missing email flows through as blank (engine flags it)", recipients.length === 1 && recipients[0].toEmail === "");
}

// enqueueCandidateCampaign wiring: session sender, resolved school, quota/DNC
// delegated to the injected enqueue.
async function run() {
  let enqueuedFor = "";
  let enqueuedRecipients: any[] = [];
  const result = await enqueueCandidateCampaign("fellow-1", "fellow", {
    campaignName: "Spring outreach", subject: "Hi {{candidate_first_name}}", body: "From {{school}}",
    selectedCandidateIds: ["mine", "theirs"], idempotencyKey: "k1",
  }, {
    loadCandidates: async () => [
      { id: "mine", name: "Ann Lee", email: "ann@x.edu", stage: "new", grad_date: "2028", school_id: "s1", university_raw: "IU Indianapolis", point_person_id: "fellow-1" },
      { id: "theirs", name: "Bob Kay", email: "bob@x.edu", stage: "new", grad_date: "2028", school_id: "s1", university_raw: "IU Indianapolis", point_person_id: "fellow-2" },
    ],
    loadSchools: async () => [{ id: "s1", name: "IU", tier: "satellite" }],
    loadProfileNames: async () => new Map([["fellow-1", "Mark"], ["fellow-2", "Dana"]]),
    enqueue: async (sender, input) => { enqueuedFor = sender; enqueuedRecipients = input.recipients; return { campaignId: "camp-1", queued: input.recipients.length, skippedDnc: 0, skippedQuota: 0, invalid: 0, replayed: false }; },
  });
  check("enqueues under the session sender, not the body", enqueuedFor === "fellow-1");
  check("only the fellow's own assignment is enqueued", enqueuedRecipients.length === 1 && enqueuedRecipients[0].candidateId === "mine");
  check("the other fellow's candidate is reported skipped-unassigned", result.skippedUnassigned.includes("theirs"));
  check("school token resolves to the specific campus, not the tier group", enqueuedRecipients[0].renderedBody === "From IU Indianapolis");

  // Whole-team audience: build user recipients (candidate_id null) + admin gate.
  const teamRecipients = buildUserRecipients(
    [{ id: "u1", fullName: "Dana Fellow", email: "dana@orrfellowship.org" }, { id: "u2", fullName: "Sam", email: "sam@orrfellowship.org" }],
    { subject: "Congrats {{candidate_first_name}}!", body: "So proud of you, {{full_name}}." },
  );
  check("team recipients render name tokens and carry no candidate id", teamRecipients[0].renderedSubject === "Congrats Dana!" && teamRecipients[1].renderedBody === "So proud of you, Sam." && teamRecipients.every((r) => r.candidateId === null));

  const neverEmailed = excludePreviouslyEmailedUsers(
    [{ id: "u1", email: "DANA@orrfellowship.org" }, { id: "u2", email: "sam@orrfellowship.org" }, { id: "u3", email: null }],
    [" dana@orrfellowship.org "],
  );
  check("whole-team test audience excludes every previously sent address", neverEmailed.length === 1 && neverEmailed[0].id === "u2");

  let teamEnqueuedFor = "";
  const teamResult = await enqueueUsersCampaign("admin-1", "admin", {
    campaignName: "Cohort celebration", subject: "Congrats {{candidate_first_name}}", body: "🎉",
  }, {
    loadUsers: async (ids) => { void ids; return [{ id: "u1", fullName: "Dana", email: "dana@orrfellowship.org" }]; },
    enqueue: async (sender, inp) => { teamEnqueuedFor = sender; return { campaignId: "camp-team", queued: inp.recipients.length, skippedDnc: 0, skippedQuota: 0, invalid: 0, replayed: false }; },
  });
  check("an admin can email the whole team", teamEnqueuedFor === "admin-1" && teamResult.queued === 1 && !teamResult.forbidden);

  const blocked = await enqueueUsersCampaign("fellow-1", "fellow", { campaignName: "x", subject: "x", body: "x" }, {
    loadUsers: async () => { throw new Error("should not load users for a fellow"); },
    enqueue: async () => { throw new Error("should not enqueue for a fellow"); },
  });
  check("a fellow is forbidden from emailing the whole team", blocked.forbidden === true && blocked.queued === 0);

  assert.equal(failures, 0);
  console.log(failures === 0 ? "\nAll candidate-outreach checks passed." : `\n${failures} candidate-outreach check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
void run();
