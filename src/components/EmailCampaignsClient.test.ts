import { readFileSync } from "node:fs";

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else { console.error(`FAIL  ${name}`); failures++; }
}

// The composer is a live component wired to real audiences; assert its contract
// against the source (the send/render logic itself is covered by the
// candidate-tokens / candidate-outreach unit tests).
const src = readFileSync(new URL("./EmailCampaignsClient.tsx", import.meta.url), "utf8");

check("four wizard steps", src.includes('["Recipients", "Compose", "Preview", "Review"]'));
check("sends real candidate outreach via the live endpoint", src.includes("/api/outreach/candidates"));
check("supports the whole-team endpoint", src.includes("/api/outreach/team"));
check("polls campaign status for live progress", src.includes("/api/google/campaign-status"));
check("renders real merge tokens (not demo vars)", src.includes("OUTREACH_MERGE_VARIABLES") && src.includes("renderOutreachTemplate"));
check("highlights personalized values in the preview", src.includes("renderHighlightedOutreachTemplate") && src.includes('className="merge-value"'));
check("has an audience switcher", src.includes("switchAudience") && src.includes("audiences"));
check("has bulk selection (no ticking every box)", src.includes("selectAllFiltered"));
check("no longer references the demo roster", !src.includes("DEMO_CANDIDATES"));
check("keeps the deliberate two-step Send action", src.includes("Send with Gmail"));
check("starts with no recipients selected", src.includes("useState<Set<string>>(() => new Set())"));
check("flags unknown merge fields before sending", src.includes("findUnsupportedOutreachVariables"));

console.log(failures === 0 ? "\nAll email campaign composer checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
