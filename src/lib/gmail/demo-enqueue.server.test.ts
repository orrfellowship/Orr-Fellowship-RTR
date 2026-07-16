import assert from "node:assert/strict";
import { parseTestRecipients, prepareDemoEnqueueRecipients, validateDemoCampaignInput } from "./demo-campaign.server";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) { console.log(`  ok  ${name}`); return; }
  failures++; console.log(`FAIL  ${name}`);
}

// parseTestRecipients (optional server-side override of the recipient list)
check("parses comma-separated recipients", parseTestRecipients("a@x.org, b@y.org").length === 2);
check("parses whitespace/newline-separated recipients", parseTestRecipients("a@x.org\n b@y.org  c@z.org").length === 3);
check("empty env yields no recipients", parseTestRecipients("").length === 0 && parseTestRecipients(undefined).length === 0);

const input = validateDemoCampaignInput({
  campaignName: "Test send",
  subject: "Hi {{first_name}}",
  body: "Hello {{first_name}} from {{school_name}}",
  selectedCandidateIds: ["catherine-mazanek", "jesse", "jordan-lee-caracci"],
  idempotencyKey: "test-key-0001",
});

// No env override → recipients send to their own (real) addresses.
const direct = prepareDemoEnqueueRecipients(input, []);
check("all selected recipients are enqueued (none excluded)", direct.recipients.length === 3 && direct.excluded.length === 0);
check("recipients send to their real addresses", direct.recipients[0].toEmail === "catherine.mazanek@orrfellowship.org" && direct.recipients[1].toEmail === "jesse@orrfellowship.org");
check("templates render per recipient", direct.recipients[0].renderedSubject === "Hi Catherine" && direct.recipients[0].renderedBody.includes("Purdue University"));
check("enqueue recipients aren't tied to a real candidate row", direct.recipients.every((r) => r.candidateId === null));

// Optional env override still works (a tester can retarget by index); a
// malformed entry is passed through so the engine records a failed send.
const override = prepareDemoEnqueueRecipients(input, ["a@x.org", "bad@nope", "c@z.org"]);
check("env override retargets by index", override.recipients[0].toEmail === "a@x.org" && override.recipients[2].toEmail === "c@z.org");
check("a malformed override address is passed through", override.recipients[1].toEmail === "bad@nope");

assert.equal(failures, 0);
console.log(failures === 0 ? "\nAll demo-enqueue checks passed." : `\n${failures} demo-enqueue check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
