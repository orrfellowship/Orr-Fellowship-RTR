import { createServiceClient } from "@/lib/supabase/server";
import { decryptRefreshToken, normalizeOrrEmail, type EncryptedRefreshToken } from "./security.server";
import { getGoogleOAuthConfig, type GoogleOAuthConfig } from "./server";
import { GMAIL_TEST_SEND_LIMITS } from "./types";

export type GmailTestSendInput = {
  recipient: string;
  subject: string;
  body: string;
};

export type GmailSendResult = {
  success: true;
  messageId: string;
  threadId: string | null;
};

export type GmailSendSession = {
  sender: string;
  accessToken: string;
  fetchImpl: typeof fetch;
};

export type SafeTestSendError = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

type StoredGmailConnection = EncryptedRefreshToken & {
  google_email: string;
};

type TestSendDependencies = {
  loadConnection?: (userId: string) => Promise<StoredGmailConnection | null>;
  fetchImpl?: typeof fetch;
  config?: GoogleOAuthConfig;
};

export class GmailTestSendError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GmailTestSendError";
  }
}

function rejectHeaderInjection(value: string, field: string) {
  if (/[\r\n]/.test(value)) {
    throw new GmailTestSendError("invalid_input", `${field} cannot contain line breaks.`, 400);
  }
}

function normalizeRecipient(value: string): string {
  const recipient = value.trim();
  rejectHeaderInjection(recipient, "Recipient");
  if (recipient.length > GMAIL_TEST_SEND_LIMITS.recipient) {
    throw new GmailTestSendError("invalid_recipient", "Enter one valid recipient email address.", 400);
  }
  if (recipient.includes(",") || recipient.includes(";")) {
    throw new GmailTestSendError("invalid_recipient", "Only one recipient is allowed.", 400);
  }
  const local = "[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+";
  const label = "[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?";
  const emailPattern = new RegExp(`^${local}@${label}(?:\\.${label})+$`, "i");
  if (!emailPattern.test(recipient)) {
    throw new GmailTestSendError("invalid_recipient", "Enter one valid recipient email address.", 400);
  }
  return recipient;
}

export function validateGmailTestInput(value: unknown): GmailTestSendInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GmailTestSendError("invalid_input", "Enter a recipient, subject, and message.", 400);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.recipient !== "string" || typeof input.subject !== "string" || typeof input.body !== "string") {
    throw new GmailTestSendError("invalid_input", "Enter a recipient, subject, and message.", 400);
  }

  const recipient = normalizeRecipient(input.recipient);
  const subject = input.subject.trim();
  const body = input.body;
  rejectHeaderInjection(subject, "Subject");
  if (!subject) throw new GmailTestSendError("invalid_subject", "Enter a subject.", 400);
  if (!body.trim()) throw new GmailTestSendError("invalid_body", "Enter a plain-text message.", 400);
  if (subject.length > GMAIL_TEST_SEND_LIMITS.subject) {
    throw new GmailTestSendError("invalid_subject", `Subject must be ${GMAIL_TEST_SEND_LIMITS.subject} characters or fewer.`, 400);
  }
  if (body.length > GMAIL_TEST_SEND_LIMITS.body) {
    throw new GmailTestSendError("invalid_body", `Message must be ${GMAIL_TEST_SEND_LIMITS.body.toLocaleString()} characters or fewer.`, 400);
  }
  return { recipient, subject, body };
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]+$/.test(subject)) return subject;
  const chunks: string[] = [];
  let current = "";
  for (const character of subject) {
    if (Buffer.byteLength(current + character, "utf8") > 45 && current) {
      chunks.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) chunks.push(current);
  return chunks
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`)
    .join("\r\n ");
}

export function buildGmailMimeMessage(input: GmailTestSendInput & { sender: string }): {
  mime: string;
  raw: string;
} {
  const sender = normalizeOrrEmail(input.sender);
  rejectHeaderInjection(sender, "Sender");
  const validated = validateGmailTestInput(input);
  const normalizedBody = validated.body.replace(/\r?\n/g, "\r\n");
  const encodedBody = Buffer.from(normalizedBody, "utf8")
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") ?? "";
  const mime = [
    `From: ${sender}`,
    `To: ${validated.recipient}`,
    `Subject: ${encodeSubject(validated.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
  ].join("\r\n");
  return { mime, raw: Buffer.from(mime, "utf8").toString("base64url") };
}

export function serializeGmailSendResult(value: unknown): GmailSendResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GmailTestSendError("gmail_send_failed", "Google did not confirm the message send.", 502);
  }
  const message = value as Record<string, unknown>;
  if (typeof message.id !== "string" || !message.id) {
    throw new GmailTestSendError("gmail_send_failed", "Google did not confirm the message send.", 502);
  }
  return {
    success: true,
    messageId: message.id,
    threadId: typeof message.threadId === "string" ? message.threadId : null,
  };
}

export function safeTestSendError(error: unknown): SafeTestSendError {
  const known = error instanceof GmailTestSendError
    ? error
    : new GmailTestSendError("gmail_send_failed", "The Gmail test message could not be sent.", 502);
  return { success: false, error: { code: known.code, message: known.message } };
}

export function isGmailTestSendEnabled(env: {
  NODE_ENV?: string;
  ENABLE_GMAIL_TEST_SEND?: string;
  ENABLE_GMAIL_PRODUCTION_TEST_SEND?: string;
  [key: string]: string | undefined;
} = process.env): boolean {
  return env.NODE_ENV === "production"
    ? env.ENABLE_GMAIL_PRODUCTION_TEST_SEND === "true"
    : env.ENABLE_GMAIL_TEST_SEND === "true";
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
  config: GoogleOAuthConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new GmailTestSendError(
      "gmail_connection_invalid",
      "The Gmail connection was revoked or expired. Disconnect and reconnect Gmail.",
      409,
    );
  }
  const tokens = await response.json() as { access_token?: unknown };
  if (typeof tokens.access_token !== "string" || !tokens.access_token) {
    throw new GmailTestSendError("gmail_connection_invalid", "Google did not return a usable access token. Reconnect Gmail.", 409);
  }
  return tokens.access_token;
}

export async function sendRawGmailMessage(
  accessToken: string,
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GmailSendResult> {
  const response = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new GmailTestSendError("gmail_permission_denied", "Google rejected the Gmail permission. Reconnect Gmail and try again.", 409);
    }
    throw new GmailTestSendError("gmail_send_failed", "Google could not send the test message.", 502);
  }
  return serializeGmailSendResult(await response.json());
}

async function loadStoredConnection(userId: string): Promise<StoredGmailConnection | null> {
  const { data, error } = await createServiceClient()
    .from("gmail_connections")
    .select("google_email, refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new GmailTestSendError("connection_unavailable", "Unable to load the Gmail connection.", 500);
  return data as StoredGmailConnection | null;
}

export async function sendOneGmailTestForUser(
  userId: string,
  value: unknown,
  dependencies: TestSendDependencies = {},
): Promise<GmailSendResult> {
  const input = validateGmailTestInput(value);
  const session = await createGmailSendSessionForUser(userId, dependencies);
  const { raw } = buildGmailMimeMessage({ ...input, sender: session.sender });
  return sendRawGmailMessage(session.accessToken, raw, session.fetchImpl);
}

export async function createGmailSendSessionForUser(
  userId: string,
  dependencies: TestSendDependencies = {},
): Promise<GmailSendSession> {
  const connection = await (dependencies.loadConnection ?? loadStoredConnection)(userId);
  if (!connection) {
    throw new GmailTestSendError("missing_connection", "Connect Gmail before sending a test message.", 409);
  }

  const config = dependencies.config ?? getGoogleOAuthConfig();
  let refreshToken: string;
  try {
    refreshToken = decryptRefreshToken(connection, config.encryptionKey);
  } catch {
    throw new GmailTestSendError("gmail_connection_invalid", "The Gmail connection cannot be decrypted. Reconnect Gmail.", 409);
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const accessToken = await refreshGoogleAccessToken(refreshToken, config, fetchImpl);
  return { sender: normalizeOrrEmail(connection.google_email), accessToken, fetchImpl };
}

export type { StoredGmailConnection, TestSendDependencies };
