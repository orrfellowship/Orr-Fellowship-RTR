import { DEMO_CANDIDATES, getAutomaticExclusionReason, isEligible, renderTemplate } from "./EmailCampaignsClient";

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failures++;
  }
}

const eligible = DEMO_CANDIDATES.filter(isEligible);
check("demo audience has 10 assigned candidates", DEMO_CANDIDATES.length === 10);
check("default audience has 7 eligible recipients", eligible.length === 7);
check("missing-email candidate is excluded", DEMO_CANDIDATES.some((candidate) => !candidate.email && !isEligible(candidate)));
check("unsubscribed candidate is excluded", DEMO_CANDIDATES.some((candidate) => candidate.unsubscribed && !isEligible(candidate)));
const doNotContactCandidate = DEMO_CANDIDATES.find((candidate) => candidate.doNotContact);
check("Do Not Contact candidate remains in the assigned demo data", !!doNotContactCandidate);
check("Do Not Contact candidate is automatically excluded", !!doNotContactCandidate && !isEligible(doNotContactCandidate));
check("Do Not Contact exclusion uses the required reason", !!doNotContactCandidate && getAutomaticExclusionReason(doNotContactCandidate) === "Marked Do Not Contact");

const template = "Hi {{first_name}} — {{school_name}} / {{major}} / {{primary_contact_name}}";
const firstPreview = renderTemplate(template, eligible[0]);
const secondPreview = renderTemplate(template, eligible[1]);
check("merge variables render for the first recipient", firstPreview.includes(eligible[0].firstName) && firstPreview.includes(eligible[0].schoolName));
check("the same template personalizes for another recipient", secondPreview.includes(eligible[1].firstName) && firstPreview !== secondPreview);
check("unknown variables remain visibly unresolved", renderTemplate("Hello {{unknown_value}}", eligible[0]).includes("{{unknown_value}}"));

console.log(failures === 0 ? "\nAll email campaign demo checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
