import { encryptRefreshToken } from "./security.server";
import {
  GmailTestSendError,
  refreshGoogleAccessToken,
  safeTestSendError,
  sendOneGmailTestForUser,
  sendRawGmailMessage,
  serializeGmailSendResult,
  type GmailSendResult,
} from "./test-send.server";
import { handleGmailTestSendRequest, type TestSendRouteDependencies } from "@/app/api/google/test-send/route";
import type { GoogleOAuthConfig } from "./server";

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failures++;
  }
}

async function rejects(name: string, callback: () => Promise<unknown>, code?: string) {
  try {
    await callback();
    check(name, false);
  } catch (error) {
    check(name, !code || (error instanceof GmailTestSendError && error.code === code));
  }
}

async function main() {
  const encryptionKey = Buffer.alloc(32, 23).toString("base64");
  const config: GoogleOAuthConfig = {
    clientId: "mock-client-id",
    clientSecret: "mock-client-secret",
    redirectUri: "http://localhost:3000/api/google/callback",
    encryptionKey,
  };

  let refreshBody = "";
  const refreshFetch: typeof fetch = async (_input, init) => {
    refreshBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ access_token: "mock-current-access-token", expires_in: 3600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const accessToken = await refreshGoogleAccessToken("mock-stored-refresh-token", config, refreshFetch);
  check("refresh-token exchange uses mocked Google response", accessToken === "mock-current-access-token");
  const refreshParams = new URLSearchParams(refreshBody);
  check("refresh exchange uses refresh_token grant", refreshParams.get("grant_type") === "refresh_token" && refreshParams.get("refresh_token") === "mock-stored-refresh-token");

  let gmailPayload = "";
  const gmailFetch: typeof fetch = async (_input, init) => {
    gmailPayload = String(init?.body ?? "");
    return new Response(JSON.stringify({ id: "gmail-message-123", threadId: "gmail-thread-456", access_token: "must-not-serialize" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const directSend = await sendRawGmailMessage("mock-current-access-token", "base64url-raw", gmailFetch);
  check("Gmail send uses mocked response", directSend.messageId === "gmail-message-123" && directSend.threadId === "gmail-thread-456");
  check("Gmail send payload contains only raw MIME", JSON.stringify(Object.keys(JSON.parse(gmailPayload))).includes("raw") && Object.keys(JSON.parse(gmailPayload)).length === 1);
  check("safe send serialization omits Google token fields", !JSON.stringify(directSend).includes("access_token") && !JSON.stringify(directSend).includes("must-not-serialize"));

  const serialized = serializeGmailSendResult({ id: "safe-id", threadId: "safe-thread", raw: "secret-raw", access_token: "secret-token" });
  check("safe result exposes only IDs and success", JSON.stringify(serialized) === JSON.stringify({ success: true, messageId: "safe-id", threadId: "safe-thread" }));

  let missingNetworkCalls = 0;
  await rejects("missing Gmail connection is rejected", () => sendOneGmailTestForUser("user-1", {
    recipient: "recipient@example.com", subject: "Test", body: "Body",
  }, {
    loadConnection: async () => null,
    config,
    fetchImpl: async () => { missingNetworkCalls++; return new Response(); },
  }), "missing_connection");
  check("missing connection makes no Google calls", missingNetworkCalls === 0);

  const encrypted = encryptRefreshToken("mock-stored-refresh-token", encryptionKey);
  let tokenCalls = 0;
  let gmailCalls = 0;
  const oneMessageFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      tokenCalls++;
      return new Response(JSON.stringify({ access_token: "mock-current-access-token" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
      gmailCalls++;
      const payload = JSON.parse(String(init?.body ?? "{}")) as { raw?: unknown };
      check("one-message flow sends a base64url MIME payload", typeof payload.raw === "string" && !/[+/=]/.test(payload.raw));
      return new Response(JSON.stringify({ id: "one-message-id" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("Unexpected mocked URL");
  };
  const oneMessageResult = await sendOneGmailTestForUser("user-1", {
    recipient: "recipient@example.com", subject: "One test", body: "One body",
  }, {
    loadConnection: async () => ({ google_email: "fellow@orrfellowship.org", ...encrypted }),
    config,
    fetchImpl: oneMessageFetch,
  });
  check("successful service flow returns a safe message ID", oneMessageResult.messageId === "one-message-id");
  check("successful service flow refreshes once and sends exactly once", tokenCalls === 1 && gmailCalls === 1);

  let productionAuthCalls = 0;
  let productionSendCalls = 0;
  const productionResponse = await handleGmailTestSendRequest(new Request("http://localhost:3000/api/google/test-send", {
    method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: "{}",
  }), {
    nodeEnv: "production",
    enabledFlag: "true",
    authenticate: async () => { productionAuthCalls++; return { id: "user-1" }; },
    send: async () => { productionSendCalls++; return { success: true, messageId: "id", threadId: null }; },
  });
  check("production environment is rejected", productionResponse.status === 404 && productionAuthCalls === 0 && productionSendCalls === 0);

  let disabledSendCalls = 0;
  const disabledResponse = await handleGmailTestSendRequest(new Request("http://localhost:3000/api/google/test-send", {
    method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: "{}",
  }), {
    nodeEnv: "development",
    enabledFlag: undefined,
    authenticate: async () => ({ id: "user-1" }),
    send: async () => { disabledSendCalls++; return { success: true, messageId: "id", threadId: null }; },
  });
  check("missing feature flag is rejected as disabled", disabledResponse.status === 404 && disabledSendCalls === 0);

  let routeSendCalls = 0;
  const routeResult: GmailSendResult = { success: true, messageId: "route-message-id", threadId: null };
  const routeDependencies: TestSendRouteDependencies = {
    nodeEnv: "development",
    enabledFlag: "true",
    authenticate: async () => ({ id: "user-1" }),
    send: async () => { routeSendCalls++; return routeResult; },
  };
  const routeResponse = await handleGmailTestSendRequest(new Request("http://localhost:3000/api/google/test-send", {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: "recipient@example.com", subject: "Test", body: "Body" }),
  }), routeDependencies);
  const routeJson = await routeResponse.json();
  check("successful API request invokes one send operation", routeResponse.status === 200 && routeSendCalls === 1);
  check("successful API response is safely serialized", JSON.stringify(routeJson) === JSON.stringify(routeResult));

  const safeError = safeTestSendError(new Error("internal token mock-current-access-token"));
  check("unknown API errors do not expose internal details", !JSON.stringify(safeError).includes("token") && safeError.error.code === "gmail_send_failed");

  console.log(failures === 0 ? "\nAll Gmail test-send checks passed." : `\n${failures} Gmail test-send check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
