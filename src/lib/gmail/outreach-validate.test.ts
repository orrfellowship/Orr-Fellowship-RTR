import assert from "node:assert/strict";
import { candidateOutreachSendingEnabled, validateOutreachInput, OUTREACH_LIMITS } from "./candidate-outreach.server";
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
  subject: "Hi {{candidate_first_name}} at {{school}}",
  body: "Class of {{class_year}} — reach out to {{fellow_point_person}}.",
  selectedCandidateIds: ["c1", "c2"],
  idempotencyKey: "abcd-1234-efgh",
};

const ok = validateOutreachInput(base);
check("accepts a valid payload", ok.ids.length === 2 && ok.subject.includes("{{candidate_first_name}}"));
check("accepts selectedUserIds as the id field too", validateOutreachInput({ ...base, selectedCandidateIds: undefined, selectedUserIds: ["u1"] }).ids[0] === "u1");
check("candidate sending remains enabled for admins", candidateOutreachSendingEnabled("admin") && candidateOutreachSendingEnabled("super_admin"));
check("candidate sending is disabled for fellows and team leads", !candidateOutreachSendingEnabled("fellow") && !candidateOutreachSendingEnabled("team_lead"));

rejects("rejects an unknown merge token", () => validateOutreachInput({ ...base, body: "Hi {{frist_name}}" }), "unsupported_merge_variable");
rejects("rejects a subject with a newline", () => validateOutreachInput({ ...base, subject: "Hi\nthere" }), "invalid_campaign");
rejects("rejects empty content", () => validateOutreachInput({ ...base, subject: "  " }), "invalid_campaign");
rejects("rejects no recipients", () => validateOutreachInput({ ...base, selectedCandidateIds: [] }), "missing_recipients");
rejects("rejects too many recipients", () => validateOutreachInput({ ...base, selectedCandidateIds: Array.from({ length: OUTREACH_LIMITS.maxRecipients + 1 }, (_, i) => `c${i}`) }), "too_many_recipients");
rejects("rejects duplicate recipients", () => validateOutreachInput({ ...base, selectedCandidateIds: ["c1", "c1"] }), "duplicate_recipient");
rejects("rejects a bad idempotency key", () => validateOutreachInput({ ...base, idempotencyKey: "short" }), "invalid_idempotency_key");
rejects("rejects a non-string recipient id", () => validateOutreachInput({ ...base, selectedCandidateIds: ["c1", 42] }), "invalid_recipient");

// ---- Phase 23: templateId parsing + role enforcement ------------------------
const TPL_ID = "3e0f8b1a-6c2d-4e5f-9a7b-1c2d3e4f5a6b";
check("templateId defaults to null", validateOutreachInput(base).templateId === null);
check("a valid templateId uuid is accepted", validateOutreachInput({ ...base, templateId: TPL_ID }).templateId === TPL_ID);
rejects("rejects a malformed templateId", () => validateOutreachInput({ ...base, templateId: "not-a-uuid" }), "invalid_template");

import { resolveContentForSender, type OutreachTemplate } from "./outreach-templates.server";
const tpl: OutreachTemplate = {
  id: TPL_ID, name: "Fall intro", subject: "Meet Orr, {{candidate_first_name}}", body: "Hi {{candidate_first_name}} — from {{fellow_point_person}}",
  isArchived: false, updatedAt: "2026-07-01T00:00:00Z",
  attachments: [{ id: "a1", fileName: "one-pager.pdf", mimeType: "application/pdf", sizeBytes: 1234, storagePath: "t/one-pager.pdf" }],
};
const clientContent = { subject: "My own subject", body: "My own body" };

{ // fellow with a template: the TEMPLATE's content and attachments win
  const r = resolveContentForSender("fellow", clientContent, tpl);
  check("fellow sends the template's subject/body, not their own", r.subject === tpl.subject && r.body === tpl.body && r.templateId === TPL_ID);
  check("fellow's campaign snapshots the template attachments", r.attachments.length === 1 && r.attachments[0].storage_path === "t/one-pager.pdf");
}
{ // fellow without a template (or an archived one): blocked
  try { resolveContentForSender("fellow", clientContent, null); failures++; console.log("FAIL  fellow without template is rejected (no throw)"); }
  catch (e) { check("fellow without template is rejected", e instanceof GmailTestSendError && e.code === "template_required"); }
  try { resolveContentForSender("team_lead", clientContent, { ...tpl, isArchived: true }); failures++; console.log("FAIL  archived template is rejected for leads (no throw)"); }
  catch (e) { check("archived template is rejected for leads", e instanceof GmailTestSendError && e.code === "template_required"); }
}
{ // admin: free compose allowed; with a template their edits still send but attachments ride
  const free = resolveContentForSender("admin", clientContent, null);
  check("admin may free-compose without a template", free.subject === clientContent.subject && free.templateId === null && free.attachments.length === 0);
  const withTpl = resolveContentForSender("super_admin", clientContent, tpl);
  check("admin keeps their edited content but inherits template attachments", withTpl.subject === clientContent.subject && withTpl.templateId === TPL_ID && withTpl.attachments.length === 1);
}

assert.equal(failures, 0);
console.log(failures === 0 ? "\nAll outreach-validate checks passed." : `\n${failures} outreach-validate check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
