import { exchangeGoogleCode, fetchGoogleEmail, type GoogleOAuthConfig } from "./server";

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failures++;
  }
}

async function main() {
  const config: GoogleOAuthConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/api/google/callback",
    encryptionKey: Buffer.alloc(32, 5).toString("base64"),
  };

  let tokenRequestBody = "";
  const tokenFetch: typeof fetch = async (_input, init) => {
    tokenRequestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      scope: "openid email https://www.googleapis.com/auth/gmail.send",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const tokens = await exchangeGoogleCode("mock-code", config, tokenFetch);
  check("Google token exchange uses the mocked network", tokens.refresh_token === "mock-refresh-token");
  check("token exchange includes the authorization code", new URLSearchParams(tokenRequestBody).get("code") === "mock-code");

  const identityFetch: typeof fetch = async () => new Response(JSON.stringify({
    email: "Fellow@ORRFELLOWSHIP.ORG",
    email_verified: true,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  check("mocked Google identity returns a normalized Orr email", await fetchGoogleEmail("mock-access-token", identityFetch) === "fellow@orrfellowship.org");

  const outsideDomainFetch: typeof fetch = async () => new Response(JSON.stringify({
    email: "fellow@gmail.com",
    email_verified: true,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    await fetchGoogleEmail("mock-access-token", outsideDomainFetch);
    check("mocked non-Orr Google identity is rejected", false);
  } catch {
    check("mocked non-Orr Google identity is rejected", true);
  }

  console.log(failures === 0 ? "\nAll mocked Google network checks passed." : `\n${failures} mocked Google network check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
