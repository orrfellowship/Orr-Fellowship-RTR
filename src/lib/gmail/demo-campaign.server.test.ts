import {
  resetDemoCampaignIdempotencyForTests,
  sendDemoCampaignForUser,
  validateDemoCampaignInput,
} from "./demo-campaign.server";
import { DEMO_CANDIDATES, type DemoCampaignResult } from "./demo-campaign";
import { GmailTestSendError, type GmailSendSession } from "./test-send.server";
import { handleDemoCampaignRequest, type DemoCampaignRouteDependencies } from "@/app/api/google/send-demo-campaign/route";

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failures++;
  }
}

function rejects(name: string, callback: () => unknown, code: string) {
  try {
    callback();
    check(name, false);
  } catch (error) {
    check(name, error instanceof GmailTestSendError && error.code === code);
  }
}

async function rejectsAsync(name: string, callback: () => Promise<unknown>, code: string) {
  try {
    await callback();
    check(name, false);
  } catch (error) {
    check(name, error instanceof GmailTestSendError && error.code === code);
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    campaignName: "Phase 3 mock campaign",
    subject: "Hello {{first_name}}",
    body: "Hi {{full_name}} from {{school_name}} — {{major}}.",
    selectedCandidateIds: ["catherine-mazanek"],
    idempotencyKey: "phase3-test-key",
    ...overrides,
  };
}

const session: GmailSendSession = {
  sender: "fellow@orrfellowship.org",
  accessToken: "mock-access-token",
  fetchImpl: async () => { throw new Error("Unexpected network call"); },
};

function decodeMime(raw: string): { headers: string; body: string } {
  const mime = Buffer.from(raw, "base64url").toString("utf8");
  const [headers, encodedBody] = mime.split("\r\n\r\n");
  return { headers, body: Buffer.from(encodedBody.replace(/\r\n/g, ""), "base64").toString("utf8") };
}

async function main() {
  rejects("unknown candidate IDs are rejected", () => validateDemoCampaignInput(input({ selectedCandidateIds: ["unknown-id"] })), "unknown_candidate");
  rejects("duplicate candidate IDs are rejected", () => validateDemoCampaignInput(input({ selectedCandidateIds: ["catherine-mazanek", "catherine-mazanek"] })), "duplicate_candidate");
  rejects("the 13-candidate maximum is enforced", () => validateDemoCampaignInput(input({ selectedCandidateIds: Array.from({ length: 14 }, (_, index) => `candidate-${index}`) })), "too_many_recipients");
  rejects("unresolved merge variables are rejected", () => validateDemoCampaignInput(input({ subject: "Hello {{unsupported_value}}" })), "unsupported_merge_variable");

  resetDemoCampaignIdempotencyForTests();
  const arbitraryRecipientRaw: string[] = [];
  await sendDemoCampaignForUser("user-1", input({ recipient: "attacker@example.net" }), {
    createSession: async () => session,
    sendMessage: async (_token, raw) => {
      arbitraryRecipientRaw.push(raw);
      return { success: true, messageId: "controlled-id", threadId: null };
    },
  });
  const controlledMime = decodeMime(arbitraryRecipientRaw[0]);
  check("client-provided arbitrary recipient addresses cannot be used", controlledMime.headers.includes("To: catherine.mazanek@orrfellowship.org") && !controlledMime.headers.includes("attacker@example.net"));

  resetDemoCampaignIdempotencyForTests();
  const perRecipientMessages: string[] = [];
  const twoResult = await sendDemoCampaignForUser("user-1", input({
    selectedCandidateIds: ["catherine-mazanek", "jesse"],
    idempotencyKey: "two-recipient-key",
  }), {
    createSession: async () => session,
    sendMessage: async (_token, raw) => {
      perRecipientMessages.push(raw);
      return { success: true, messageId: `msg-${perRecipientMessages.length}`, threadId: null };
    },
  });
  const twoDecoded = perRecipientMessages.map(decodeMime);
  check("two recipients produce two Gmail messages", twoResult.sent === 2 && perRecipientMessages.length === 2);
  check("each message is addressed to its own recipient", twoDecoded.some((m) => m.headers.includes("To: catherine.mazanek@orrfellowship.org")) && twoDecoded.some((m) => m.headers.includes("To: jesse@orrfellowship.org")));
  check("messages retain distinct subject personalization", twoDecoded[0].headers.includes("Subject: Hello Catherine") && twoDecoded[1].headers.includes("Subject: Hello Jesse"));
  check("messages retain distinct body personalization", twoDecoded[0].body.includes("Catherine Mazanek") && twoDecoded[1].body.includes("Jesse"));

  resetDemoCampaignIdempotencyForTests();
  let allSendCalls = 0;
  const allResult = await sendDemoCampaignForUser("user-1", input({
    selectedCandidateIds: DEMO_CANDIDATES.map((candidate) => candidate.id),
    idempotencyKey: "all-candidates-key",
  }), {
    createSession: async () => session,
    sendMessage: async () => {
      allSendCalls++;
      if (allSendCalls === 2) throw new GmailTestSendError("gmail_send_failed", "Google could not send this personalized message.", 502);
      return { success: true, messageId: `message-${allSendCalls}`, threadId: null };
    },
  });
  check("one Gmail request is made per selected recipient", allSendCalls === 8 && allResult.attempted === 8);
  check("all test recipients are eligible (none excluded)", allResult.excluded === 0);
  check("partial Gmail failure returns mixed per-recipient results", allResult.sent === 7 && allResult.failed === 1 && allResult.recipients.some((recipient) => recipient.status === "sent") && allResult.recipients.some((recipient) => recipient.status === "failed"));
  check("campaign results expose no access token or raw MIME", !JSON.stringify(allResult).includes("mock-access-token") && !JSON.stringify(allResult).includes("Content-Type:"));

  resetDemoCampaignIdempotencyForTests();
  await rejectsAsync("missing Gmail connection is rejected", () => sendDemoCampaignForUser("user-1", input({ idempotencyKey: "missing-connection" }), {
    createSession: async () => { throw new GmailTestSendError("missing_connection", "Connect Gmail before sending a test message.", 409); },
  }), "missing_connection");

  resetDemoCampaignIdempotencyForTests();
  let releaseSend!: () => void;
  const sendGate = new Promise<void>((resolve) => { releaseSend = resolve; });
  let idempotentSendCalls = 0;
  const idempotentDependencies = {
    createSession: async () => session,
    sendMessage: async () => {
      idempotentSendCalls++;
      await sendGate;
      return { success: true as const, messageId: "idempotent-message", threadId: null };
    },
  };
  const firstRequest = sendDemoCampaignForUser("user-1", input({ idempotencyKey: "same-inflight-key" }), idempotentDependencies);
  const duplicateRequest = sendDemoCampaignForUser("user-1", input({ idempotencyKey: "same-inflight-key" }), idempotentDependencies);
  await Promise.resolve();
  releaseSend();
  const [firstResult, duplicateResult] = await Promise.all([firstRequest, duplicateRequest]);
  check("duplicate in-flight submission reuses one campaign operation", idempotentSendCalls === 1 && JSON.stringify(firstResult) === JSON.stringify(duplicateResult));

  const safeRouteResult: DemoCampaignResult = { success: true, attempted: 1, sent: 1, failed: 0, excluded: 0, recipients: [{ candidateId: "catherine-mazanek", candidateName: "Catherine Mazanek", maskedRecipient: "ca***@orrfellowship.org", status: "sent", messageId: "safe-message-id" }] };
  let productionSendCalls = 0;
  const productionResponse = await handleDemoCampaignRequest(new Request("https://rtr.orrfellowship.org/api/google/send-demo-campaign", {
    method: "POST", headers: { Origin: "https://rtr.orrfellowship.org", "Content-Type": "application/json" }, body: JSON.stringify(input()),
  }), {
    nodeEnv: "production",
    enabledFlag: undefined,
    productionEnabledFlag: "true",
    authenticate: async () => ({ id: "user-1" }),
    previewing: async () => false,
    send: async () => { productionSendCalls++; return safeRouteResult; },
  });
  check("the explicit production smoke-test flag allows a controlled send", productionResponse.status === 200 && productionSendCalls === 1);

  const productionMultipleResponse = await handleDemoCampaignRequest(new Request("https://rtr.orrfellowship.org/api/google/send-demo-campaign", {
    method: "POST", headers: { Origin: "https://rtr.orrfellowship.org", "Content-Type": "application/json" },
    body: JSON.stringify(input({ selectedCandidateIds: ["catherine-mazanek", "jesse"] })),
  }), {
    nodeEnv: "production",
    enabledFlag: undefined,
    productionEnabledFlag: "true",
    authenticate: async () => ({ id: "user-1" }),
    previewing: async () => false,
    send: async () => safeRouteResult,
  });
  check("production smoke tests permit only one selected candidate", productionMultipleResponse.status === 400);

  let productionDisabledAuthCalls = 0;
  const productionDisabledResponse = await handleDemoCampaignRequest(new Request("https://rtr.orrfellowship.org/api/google/send-demo-campaign", {
    method: "POST", headers: { Origin: "https://rtr.orrfellowship.org", "Content-Type": "application/json" }, body: "{}",
  }), {
    nodeEnv: "production",
    enabledFlag: "true",
    productionEnabledFlag: undefined,
    authenticate: async () => { productionDisabledAuthCalls++; return { id: "user-1" }; },
    previewing: async () => false,
    send: async () => safeRouteResult,
  });
  check("the local flag cannot enable production sending", productionDisabledResponse.status === 404 && productionDisabledAuthCalls === 0);

  let disabledSendCalls = 0;
  const disabledResponse = await handleDemoCampaignRequest(new Request("http://localhost:3000/api/google/send-demo-campaign", {
    method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: "{}",
  }), {
    nodeEnv: "development",
    enabledFlag: undefined,
    productionEnabledFlag: undefined,
    authenticate: async () => ({ id: "user-1" }),
    previewing: async () => false,
    send: async () => { disabledSendCalls++; return safeRouteResult; },
  });
  check("missing feature flag is rejected before sending", disabledResponse.status === 404 && disabledSendCalls === 0);

  let routeSendCalls = 0;
  const routeDependencies: DemoCampaignRouteDependencies = {
    nodeEnv: "development",
    enabledFlag: "true",
    productionEnabledFlag: undefined,
    authenticate: async () => ({ id: "user-1" }),
    previewing: async () => false,
    send: async () => { routeSendCalls++; return safeRouteResult; },
  };
  const routeResponse = await handleDemoCampaignRequest(new Request("http://localhost:3000/api/google/send-demo-campaign", {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify(input()),
  }), routeDependencies);
  const routeJson = await routeResponse.json();
  check("successful API request invokes exactly one campaign service operation", routeResponse.status === 200 && routeSendCalls === 1);
  check("successful API response is safely serialized", JSON.stringify(routeJson) === JSON.stringify(safeRouteResult));

  const previewResponse = await handleDemoCampaignRequest(new Request("http://localhost:3000/api/google/send-demo-campaign", {
    method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify(input()),
  }), { ...routeDependencies, previewing: async () => true });
  check("View As mode cannot send the controlled campaign", previewResponse.status === 403);

  console.log(failures === 0 ? "\nAll Gmail demo-campaign checks passed." : `\n${failures} Gmail demo-campaign check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
