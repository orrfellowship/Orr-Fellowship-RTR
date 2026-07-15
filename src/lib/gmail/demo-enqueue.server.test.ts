import assert from "node:assert/strict";
import { parseTestRecipients, prepareDemoEnqueueRecipients, validateDemoCampaignInput } from "./demo-campaign.server";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) { console.log(`  ok  ${name}`); return; }
  failures++; console.log(`FAIL  ${name}`);
}

// parseTestRecipients
check("parses comma-separated recipients", parseTestRecipients("a@x.org, b@y.org").length === 2);
check("parses whitespace/newline-separated recipients", parseTestRecipients("a@x.org\n b@y.org  c@z.org").length === 3);
check("empty env yields no recipients", parseTestRecipients("").length === 0 && parseTestRecipients(undefined).length === 0);

// A selection mixing eligible + excluded demo candidates. Count-independent so
// it doesn't break when the demo roster grows.
//   ava-patel      → eligible
//   zoe-williams   → excluded (Do Not Contact)
//   noah-kim       → eligible
//   isabella-reed  → excluded (missing email)
//   maya-thompson  → eligible
const input = validateDemoCampaignInput({
  campaignName: "Batch test",
  subject: "Hi {{first_name}}",
  body: "Hello {{first_name}} from {{school_name}}",
  selectedCandidateIds: ["ava-patel", "zoe-williams", "noah-kim", "isabella-reed", "maya-thompson"],
  idempotencyKey: "test-key-0001",
});

// Env list: 2 valid + 1 deliberately malformed (missing TLD) in the middle.
const testRecipients = ["catherine.mazanek@orrfellowship.org", "olivia.lux@orrfellowship", "jesse@orrfellowship.org"];
const { recipients, excluded } = prepareDemoEnqueueRecipients(input, testRecipients);

check("excluded candidates are separated out", excluded.length === 2 && excluded.every((e) => !!e.exclusionReason));
check("only eligible candidates become recipients", recipients.length === 3);
check("test inboxes map to eligible candidates by index", recipients[0].toEmail === "catherine.mazanek@orrfellowship.org" && recipients[2].toEmail === "jesse@orrfellowship.org");
check("a malformed test address is passed through (engine will fail it)", recipients[1].toEmail === "olivia.lux@orrfellowship");
check("excluded candidates never consume a test inbox", !recipients.some((r) => r.toEmail === undefined));
check("templates render per candidate", recipients[0].renderedSubject === "Hi Ava" && recipients[0].renderedBody.includes("Purdue University"));
check("demo recipients are not tied to a real candidate row", recipients.every((r) => r.candidateId === null));

// Fewer env addresses than eligible → the remainder fall back to the demo address.
const short = prepareDemoEnqueueRecipients(input, ["only@one.org"]);
check("recipients beyond the env list fall back to committed demo addresses", short.recipients[0].toEmail === "only@one.org" && /@(orrfellowship\.org|brumley\.cloud)$/.test(short.recipients[1].toEmail));

// No env → all recipients use the fictional candidates' own committed addresses.
const fallback = prepareDemoEnqueueRecipients(input, []);
check("no env → falls back to committed demo addresses", fallback.recipients.every((r) => /@(orrfellowship\.org|brumley\.cloud)$/.test(r.toEmail)));

assert.equal(failures, 0);
console.log(failures === 0 ? "\nAll demo-enqueue checks passed." : `\n${failures} demo-enqueue check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
