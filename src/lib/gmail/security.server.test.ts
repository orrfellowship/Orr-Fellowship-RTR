import {
  createOAuthState,
  decryptRefreshToken,
  encryptRefreshToken,
  normalizeOrrEmail,
  serializeGmailConnection,
  validateOAuthState,
} from "./security.server";

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failures++;
  }
}

function rejects(name: string, callback: () => unknown) {
  try {
    callback();
    check(name, false);
  } catch {
    check(name, true);
  }
}

const key = Buffer.alloc(32, 17).toString("base64");
const refreshToken = "test-refresh-token-never-log-real-values";
const encrypted = encryptRefreshToken(refreshToken, key);
check("refresh token encryption round-trips", decryptRefreshToken(encrypted, key) === refreshToken);
check("encrypted refresh token does not contain plaintext", !JSON.stringify(encrypted).includes(refreshToken));

const tampered = {
  ...encrypted,
  refresh_token_ciphertext: `${encrypted.refresh_token_ciphertext.slice(0, -2)}AA`,
};
rejects("tampered encrypted refresh token is rejected", () => decryptRefreshToken(tampered, key));

check("Orr Fellowship email is normalized", normalizeOrrEmail(" Fellow@ORRFELLOWSHIP.ORG ") === "fellow@orrfellowship.org");
for (const email of ["fellow@gmail.com", "fellow@evilorrfellowship.org", "@orrfellowship.org"]) {
  rejects(`non-Orr account is rejected: ${email}`, () => normalizeOrrEmail(email));
}

const expectedState = {
  userId: "6abdeef7-5f66-4dbb-b84a-3f47c62aa89f",
  returnTo: "/console/email-campaigns",
  nonce: "test-browser-nonce",
};
const state = createOAuthState(expectedState, key, 1_000);
check("valid OAuth state is accepted", validateOAuthState(state, expectedState, key, 1_100).userId === expectedState.userId);
rejects("OAuth state is bound to the authenticated user", () => validateOAuthState(state, { ...expectedState, userId: "another-user" }, key, 1_100));
rejects("OAuth state is bound to its browser nonce", () => validateOAuthState(state, { ...expectedState, nonce: "another-browser" }, key, 1_100));
rejects("expired OAuth state is rejected", () => validateOAuthState(state, expectedState, key, 1_601));
rejects("tampered OAuth state is rejected", () => validateOAuthState(`${state.slice(0, -1)}x`, expectedState, key, 1_100));

const safe = serializeGmailConnection({
  google_email: "fellow@orrfellowship.org",
  connected_at: "2026-07-15T12:00:00.000Z",
  granted_scopes: ["openid", "https://www.googleapis.com/auth/gmail.send"],
  refresh_token_ciphertext: "encrypted-secret",
  refresh_token_iv: "secret-iv",
  refresh_token_auth_tag: "secret-tag",
  client_secret: "secret-client-value",
});
const serialized = JSON.stringify(safe);
check("safe status reports the connection", safe.connected && safe.connectedEmail === "fellow@orrfellowship.org");
check("safe status omits all credential fields", !serialized.includes("secret") && !serialized.includes("refresh_token") && !serialized.includes("client_secret"));
check("missing status serializes as disconnected", serializeGmailConnection(null).connected === false);

console.log(failures === 0 ? "\nAll Gmail security checks passed." : `\n${failures} Gmail security check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
