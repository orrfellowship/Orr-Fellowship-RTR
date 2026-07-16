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
check("audience is the 8 test recipients", DEMO_CANDIDATES.length === 8);
check("all recipients are eligible to email", eligible.length === 8);
check("recipients are real addresses", eligible.every((candidate) => !!candidate.email && /@/.test(candidate.email)));
check("recipients include the discussed inboxes", DEMO_CANDIDATES.some((c) => c.email === "catherine.mazanek@orrfellowship.org") && DEMO_CANDIDATES.some((c) => c.email === "sam@brumley.cloud"));
check("no recipient is auto-excluded", DEMO_CANDIDATES.every((candidate) => getAutomaticExclusionReason(candidate) === null));

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
check("Review uses the Gmail campaign action", componentSource.includes("Send with Gmail") && componentSource.includes("/api/google/enqueue-campaign"));
check("send flow enqueues and polls campaign status", componentSource.includes("/api/google/campaign-status"));
check("campaign starts with no recipients selected", componentSource.includes("useState<Set<string>>(() => new Set())"));
check("test-send wording is visible", componentSource.includes("Test send") && componentSource.includes("Send a real test campaign"));

console.log(failures === 0 ? "\nAll email campaign demo checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
