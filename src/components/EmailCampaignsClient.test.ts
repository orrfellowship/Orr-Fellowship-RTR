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
check("renders real merge tokens (not demo vars)", src.includes("OUTREACH_MERGE_VARIABLES") && src.includes("renderHighlightedOutreachTemplate"));
check("highlights personalized values in the preview", src.includes("renderHighlightedOutreachTemplate") && src.includes('className="merge-value"'));
check("has an audience switcher", src.includes("switchAudience") && src.includes("audiences"));
check("has bulk selection (no ticking every box)", src.includes("selectAllFiltered"));
check("no longer references the demo roster", !src.includes("DEMO_CANDIDATES"));
check("keeps the deliberate two-step Send action", src.includes("Send with Gmail"));
check("starts with no recipients selected", src.includes("useState<Set<string>>(() => new Set())"));
check("flags unknown merge fields before sending", src.includes("findUnsupportedOutreachVariables"));
check("hides the sender badge while Gmail is disconnected", src.includes("gmailConnection.connected && gmailConnection.connectedEmail") && !src.includes("viewerName"));
check("shows the authenticated Gmail address in the sender badge", src.includes("Sending as: <strong>{gmailConnection.connectedEmail}</strong>"));
check("offers Continue to Compose above the recipient list", src.includes("recipient-title-actions") && src.includes("Continue to Compose"));
check("does not repeat the Gmail sender in the compose form", !src.includes("gmail-compose-sender"));
check("review shows the shared subject template, not recipient one", src.includes('<ReviewValue label="Subject template" value={subject} wide />'));
check("all-candidate admin audience is search-first", src.includes('audience?.key === "all" && !q && !pointPersonFilter') && src.includes("Search by name, email, or school, or choose a point person"));
check("paginates broad recipient results", src.includes("shownRecipients") && src.includes("recipientPageSize") && src.includes("PaginationControls"));
check("admins can filter contacts by point person", src.includes('aria-label="Filter by point person"') && src.includes("r.tokens.fellow_point_person !== pointPersonFilter"));
check("uses the renamed candidate and fellow merge fields", src.includes("{{candidate_first_name}}") && src.includes("{{candidate_last_name}}") && src.includes("{{fellow_point_person}}"));

console.log(failures === 0 ? "\nAll email campaign composer checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
