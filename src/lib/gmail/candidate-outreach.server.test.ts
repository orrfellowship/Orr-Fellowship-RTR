import assert from "node:assert/strict";
import { buildCandidateRecipients, enqueueCandidateCampaign, buildUserRecipients, enqueueUsersCampaign, splitFellowCohorts, type OutreachCandidate } from "./candidate-outreach.server";

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

  // Fellow-cohort audience: build user recipients (candidate_id null), preserve
  // roles independently from year, de-duplicate profiles, and enforce admin.
  const teamRecipients = buildUserRecipients(
    [{ id: "u1", fullName: "Dana Fellow", email: "dana@orrfellowship.org" }, { id: "u2", fullName: "Sam", email: "sam@orrfellowship.org" }],
    { subject: "Congrats {{candidate_first_name}}!", body: "So proud of you, {{candidate_full_name}}." },
  );
  check("team recipients render name tokens and carry no candidate id", teamRecipients[0].renderedSubject === "Congrats Dana!" && teamRecipients[1].renderedBody === "So proud of you, Sam." && teamRecipients.every((r) => r.candidateId === null));

  const cohorts = splitFellowCohorts([
    { id: "mason", fullName: "Mason Hedges", email: "mason@orrfellowship.org", role: "team_lead", fellowshipYear: 1 },
    { id: "samuel", fullName: "Samuel Brumley", email: "samuel@orrfellowship.org", role: "fellow", fellowshipYear: 1 },
    { id: "sam-admin", fullName: "Sam Brumley", email: "sam@icloud.com", role: "super_admin", fellowshipYear: null },
    { id: "kate-fellow", fullName: "Kate Swack", email: "katherine@orrfellowship.org", role: "fellow", fellowshipYear: 2 },
    { id: "kate-lead", fullName: "Kate Swack", email: "kate@orrfellowship.org", role: "team_lead", fellowshipYear: 2 },
  ]);
  check("Mason remains a team lead and is included as a first-year", cohorts.firstYears.some((u) => u.id === "mason" && u.role === "team_lead"));
  check("Samuel fellow is first-year and Sam super-admin is excluded", cohorts.firstYears.some((u) => u.id === "samuel") && ![...cohorts.firstYears, ...cohorts.secondYears].some((u) => u.id === "sam-admin"));
  check("duplicate profiles produce one recipient and prefer team lead", cohorts.secondYears.length === 1 && cohorts.secondYears[0].id === "kate-lead");

  let teamEnqueuedFor = "";
  const teamResult = await enqueueUsersCampaign("admin-1", "admin", {
    campaignName: "Cohort celebration", subject: "Congrats {{candidate_first_name}}", body: "🎉",
  }, {
    loadUsers: async (ids) => { void ids; return [{ id: "u1", fullName: "Dana", email: "dana@orrfellowship.org" }]; },
    enqueue: async (sender, inp) => { teamEnqueuedFor = sender; return { campaignId: "camp-team", queued: inp.recipients.length, skippedDnc: 0, skippedQuota: 0, invalid: 0, replayed: false }; },
  });
  check("an admin can email a fellow cohort", teamEnqueuedFor === "admin-1" && teamResult.queued === 1 && !teamResult.forbidden);

  const blocked = await enqueueUsersCampaign("fellow-1", "fellow", { campaignName: "x", subject: "x", body: "x" }, {
    loadUsers: async () => { throw new Error("should not load users for a fellow"); },
    enqueue: async () => { throw new Error("should not enqueue for a fellow"); },
  });
  check("a fellow is forbidden from emailing fellow cohorts", blocked.forbidden === true && blocked.queued === 0);

  assert.equal(failures, 0);
  console.log(failures === 0 ? "\nAll candidate-outreach checks passed." : `\n${failures} candidate-outreach check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
void run();
