import { readFileSync } from "node:fs";
import {
  CAMPAIGN_STEPS,
  DEMO_CANDIDATES,
  findUnsupportedMergeVariables,
  getAutomaticExclusionReason,
  isEligible,
  renderTemplate,
} from "@/lib/gmail/demo-campaign";

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failures++;
  }
}

const eligible = DEMO_CANDIDATES.filter(isEligible);
check("campaign retains the four required stages", JSON.stringify(CAMPAIGN_STEPS) === JSON.stringify(["My Candidates", "Compose", "Preview", "Review"]));
check("demo audience has 10 assigned candidates", DEMO_CANDIDATES.length === 10);
check("default audience has 7 eligible recipients", eligible.length === 7);
check("eligible candidates use only the two controlled addresses", eligible.every((candidate, index) => candidate.email === (index % 2 === 0 ? "samuel.brumley@orrfellowship.org" : "sam@brumley.cloud")));
check("missing-email candidate is excluded", DEMO_CANDIDATES.some((candidate) => !candidate.email && !isEligible(candidate)));
check("unsubscribed candidate is excluded", DEMO_CANDIDATES.some((candidate) => candidate.unsubscribed && !isEligible(candidate)));
const doNotContactCandidate = DEMO_CANDIDATES.find((candidate) => candidate.doNotContact);
check("Do Not Contact candidate remains in the assigned demo data", !!doNotContactCandidate);
check("Do Not Contact candidate is automatically excluded", !!doNotContactCandidate && !isEligible(doNotContactCandidate));
check("Do Not Contact exclusion uses the required reason", !!doNotContactCandidate && getAutomaticExclusionReason(doNotContactCandidate) === "Marked Do Not Contact");

const subjectTemplate = "{{first_name}} — {{major}}";
const bodyTemplate = "Hi {{full_name}} at {{school_name}}, class of {{graduation_year}}.";
const firstSubject = renderTemplate(subjectTemplate, eligible[0]);
const secondSubject = renderTemplate(subjectTemplate, eligible[1]);
check("subject merge rendering is personalized per candidate", firstSubject.includes(eligible[0].firstName) && secondSubject.includes(eligible[1].firstName) && firstSubject !== secondSubject);
check("body merge rendering is personalized per candidate", renderTemplate(bodyTemplate, eligible[0]).includes(eligible[0].schoolName) && renderTemplate(bodyTemplate, eligible[1]).includes(eligible[1].schoolName));
check("unsupported merge variables are detected", findUnsupportedMergeVariables("Hello {{unknown_value}}").includes("{{unknown_value}}"));
check("supported merge variables are accepted", findUnsupportedMergeVariables("Hi {{first_name}} from {{school_name}}").length === 0);

const componentSource = readFileSync(new URL("./EmailCampaignsClient.tsx", import.meta.url), "utf8");
check("developer Gmail test panel is removed", !componentSource.includes("GmailTestSendPanel") && !componentSource.includes("Developer Gmail test"));
check("demo send and scheduling controls are removed", !componentSource.includes("Demo send only") && !componentSource.includes("Demo schedule only"));
check("Review uses the Gmail campaign action", componentSource.includes("Send with Gmail") && componentSource.includes("/api/google/send-demo-campaign"));

console.log(failures === 0 ? "\nAll email campaign demo checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
