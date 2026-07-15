import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { GmailConnectionStatus } from "./types";

const TOKEN_ALGORITHM = "aes-256-gcm";
const TOKEN_IV_BYTES = 12;
const STATE_LIFETIME_SECONDS = 10 * 60;

export type EncryptedRefreshToken = {
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_auth_tag: string;
};

export type OAuthStatePayload = {
  v: 1;
  userId: string;
  returnTo: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

function encryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[a-f\d]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");

  if (key.length !== 32) {
    throw new Error("GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptRefreshToken(token: string, keyValue: string): EncryptedRefreshToken {
  if (!token) throw new Error("Cannot encrypt an empty refresh token");
  const iv = randomBytes(TOKEN_IV_BYTES);
  const cipher = createCipheriv(TOKEN_ALGORITHM, encryptionKey(keyValue), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);

  return {
    refresh_token_ciphertext: ciphertext.toString("base64"),
    refresh_token_iv: iv.toString("base64"),
    refresh_token_auth_tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptRefreshToken(value: EncryptedRefreshToken, keyValue: string): string {
  try {
    const decipher = createDecipheriv(
      TOKEN_ALGORITHM,
      encryptionKey(keyValue),
      Buffer.from(value.refresh_token_iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(value.refresh_token_auth_tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.refresh_token_ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt the stored OAuth token");
  }
}

function stateKey(keyValue: string): Buffer {
  return createHmac("sha256", encryptionKey(keyValue))
    .update("orr-google-oauth-state-v1")
    .digest();
}

function stateSignature(encodedPayload: string, keyValue: string): Buffer {
  return createHmac("sha256", stateKey(keyValue)).update(encodedPayload).digest();
}

export function createOAuthState(
  input: { userId: string; returnTo: string; nonce: string },
  keyValue: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const payload: OAuthStatePayload = {
    v: 1,
    userId: input.userId,
    returnTo: input.returnTo,
    nonce: input.nonce,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + STATE_LIFETIME_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${stateSignature(encoded, keyValue).toString("base64url")}`;
}

export function validateOAuthState(
  state: string,
  expected: { userId: string; returnTo: string; nonce: string },
  keyValue: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): OAuthStatePayload {
  const [encoded, suppliedSignature, extra] = state.split(".");
  if (!encoded || !suppliedSignature || extra) throw new Error("Invalid OAuth state");

  const expectedSignature = stateSignature(encoded, keyValue);
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (supplied.length !== expectedSignature.length || !timingSafeEqual(supplied, expectedSignature)) {
    throw new Error("Invalid OAuth state");
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload;
  } catch {
    throw new Error("Invalid OAuth state");
  }

  const valid = payload.v === 1
    && payload.userId === expected.userId
    && payload.returnTo === expected.returnTo
    && payload.nonce === expected.nonce
    && Number.isInteger(payload.issuedAt)
    && Number.isInteger(payload.expiresAt)
    && payload.issuedAt <= nowSeconds + 30
    && payload.expiresAt >= nowSeconds;
  if (!valid) throw new Error("Invalid or expired OAuth state");
  return payload;
}

export function normalizeOrrEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^@\s]+@orrfellowship\.org$/.test(email)) {
    throw new Error("Only @orrfellowship.org Google accounts can be connected");
  }
  return email;
}

export function serializeGmailConnection(
  row: ({ google_email?: unknown; connected_at?: unknown; granted_scopes?: unknown } & Record<string, unknown>) | null,
): GmailConnectionStatus {
  if (!row) return { connected: false, connectedEmail: null, connectedAt: null };
  return {
    connected: true,
    connectedEmail: typeof row.google_email === "string" ? row.google_email : null,
    connectedAt: typeof row.connected_at === "string" ? row.connected_at : null,
    grantedScopes: Array.isArray(row.granted_scopes)
      ? row.granted_scopes.filter((scope): scope is string => typeof scope === "string")
      : [],
  };
}
