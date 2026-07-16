import assert from "node:assert/strict";
import { validateOutreachInput, OUTREACH_LIMITS } from "./candidate-outreach.server";
import { GmailTestSendError } from "./test-send.server";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) { console.log(`  ok  ${name}`); return; }
  failures++; console.log(`FAIL  ${name}`);
}
function rejects(name: string, fn: () => unknown, code: string) {
  try { fn(); failures++; console.log(`FAIL  ${name} (no throw)`); }
  catch (e) { check(name, e instanceof GmailTestSendError && e.code === code); }
}

const base = {
  campaignName: "Spring outreach",
  subject: "Hi {{first_name}} at {{school}}",
  body: "Class of {{class_year}} — reach out to {{point_person}}.",
  selectedCandidateIds: ["c1", "c2"],
  idempotencyKey: "abcd-1234-efgh",
};

const ok = validateOutreachInput(base);
check("accepts a valid payload", ok.ids.length === 2 && ok.subject.includes("{{first_name}}"));
check("accepts selectedUserIds as the id field too", validateOutreachInput({ ...base, selectedCandidateIds: undefined, selectedUserIds: ["u1"] }).ids[0] === "u1");

rejects("rejects an unknown merge token", () => validateOutreachInput({ ...base, body: "Hi {{frist_name}}" }), "unsupported_merge_variable");
rejects("rejects a subject with a newline", () => validateOutreachInput({ ...base, subject: "Hi\nthere" }), "invalid_campaign");
rejects("rejects empty content", () => validateOutreachInput({ ...base, subject: "  " }), "invalid_campaign");
rejects("rejects no recipients", () => validateOutreachInput({ ...base, selectedCandidateIds: [] }), "missing_recipients");
rejects("rejects too many recipients", () => validateOutreachInput({ ...base, selectedCandidateIds: Array.from({ length: OUTREACH_LIMITS.maxRecipients + 1 }, (_, i) => `c${i}`) }), "too_many_recipients");
rejects("rejects duplicate recipients", () => validateOutreachInput({ ...base, selectedCandidateIds: ["c1", "c1"] }), "duplicate_recipient");
rejects("rejects a bad idempotency key", () => validateOutreachInput({ ...base, idempotencyKey: "short" }), "invalid_idempotency_key");
rejects("rejects a non-string recipient id", () => validateOutreachInput({ ...base, selectedCandidateIds: ["c1", 42] }), "invalid_recipient");

assert.equal(failures, 0);
console.log(failures === 0 ? "\nAll outreach-validate checks passed." : `\n${failures} outreach-validate check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
