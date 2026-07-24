import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServiceClient } from "@/lib/supabase/server";
import { decryptRefreshToken, normalizeOrrEmail, type EncryptedRefreshToken } from "./security.server";
import { getGoogleOAuthConfig, type GoogleOAuthConfig } from "./server";
import { GMAIL_TEST_SEND_LIMITS } from "./types";
import { renderOutreachHtml, renderOutreachPlainText, ORR_EMBLEM_CID } from "./email-render";

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

// A professional From display name derived from the sender's address local-part
// ("mark.stolte" → "Mark Stolte"), branded with the org, so recipients see
// "Mark Stolte · Orr Fellowship" instead of a bare "first.last" address.
export function senderDisplayPhrase(email: string): string {
  const local = (email.split("@")[0] ?? "").trim();
  const name = local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .trim();
  return name ? `${name} · Orr Fellowship` : "Orr Fellowship";
}

// RFC 2047 encoded-word for a header display phrase. ASCII-only phrases are
// returned as a quoted-string; anything with non-ASCII (e.g. the "·" separator)
// is base64 encoded-word(s) so no raw non-ASCII lands in a header.
function encodeHeaderPhrase(phrase: string): string {
  if (/^[\x20-\x7E]+$/.test(phrase)) return `"${phrase.replace(/(["\\])/g, "\\$1")}"`;
  const chunks: string[] = [];
  let current = "";
  for (const character of phrase) {
    if (Buffer.byteLength(current + character, "utf8") > 45 && current) { chunks.push(current); current = character; }
    else current += character;
  }
  if (current) chunks.push(current);
  return chunks.map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`).join("\r\n ");
}

// Full From header value: encoded display name + the angle-bracketed address.
export function formatFromHeader(email: string): string {
  return `${encodeHeaderPhrase(senderDisplayPhrase(email))} <${email}>`;
}

// An attachment ready to embed: content is already base64 (NOT base64url).
export type MimeAttachment = {
  fileName: string;
  mimeType: string;
  contentBase64: string;
};

// Header-safe filename: strip CR/LF/quotes/backslashes and non-printable
// characters so a stored name can never break out of its MIME header.
export function sanitizeAttachmentFileName(name: string): string {
  const cleaned = (name ?? "")
    .replace(/[\r\n"\\/]+/g, " ")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "attachment").slice(0, 120);
}

const wrap76 = (b64: string) => b64.match(/.{1,76}/g)?.join("\r\n") ?? "";

// An inline image referenced from the HTML body by Content-ID (cid:).
export type InlineImage = { contentId: string; mimeType: string; contentBase64: string };

// The Orr emblem, embedded inline in every real send (read once from /public).
let cachedEmblem: InlineImage | null | undefined;
export function loadOrrEmblem(): InlineImage | null {
  if (cachedEmblem !== undefined) return cachedEmblem;
  try {
    const bytes = readFileSync(join(process.cwd(), "public", "orr-emblem.png"));
    cachedEmblem = { contentId: ORR_EMBLEM_CID, mimeType: "image/png", contentBase64: bytes.toString("base64") };
  } catch {
    cachedEmblem = null; // never block a send on a missing asset
  }
  return cachedEmblem;
}

type MimePart = { headers: string[]; body: string };

let boundarySeq = 0;
function makeBoundary(subtype: string): string {
  boundarySeq = (boundarySeq + 1) % 1_000_000;
  return `orr_${subtype}_${Date.now().toString(36)}_${boundarySeq}_${Math.random().toString(36).slice(2, 8)}`;
}
function renderMultipart(subtype: string, parts: MimePart[]): MimePart {
  const boundary = makeBoundary(subtype);
  const body =
    parts.map((p) => `--${boundary}\r\n${p.headers.join("\r\n")}\r\n\r\n${p.body}`).join("\r\n")
    + `\r\n--${boundary}--`;
  return { headers: [`Content-Type: multipart/${subtype}; boundary="${boundary}"`], body };
}
function base64TextPart(contentType: string, text: string): MimePart {
  return {
    headers: [contentType, "Content-Transfer-Encoding: base64"],
    body: wrap76(Buffer.from(text, "utf8").toString("base64")),
  };
}
function attachmentPart(a: MimeAttachment): MimePart {
  const fileName = sanitizeAttachmentFileName(a.fileName);
  const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType) ? a.mimeType : "application/octet-stream";
  return {
    headers: [
      `Content-Type: ${mimeType}; name="${fileName}"`,
      `Content-Disposition: attachment; filename="${fileName}"`,
      "Content-Transfer-Encoding: base64",
    ],
    body: wrap76(a.contentBase64.replace(/\s+/g, "")),
  };
}

export function buildGmailMimeMessage(
  input: GmailTestSendInput & { sender: string; attachments?: MimeAttachment[]; inlineEmblem?: InlineImage | null },
): {
  mime: string;
  raw: string;
} {
  const sender = normalizeOrrEmail(input.sender);
  rejectHeaderInjection(sender, "Sender");
  const validated = validateGmailTestInput(input);
  const attachments = input.attachments ?? [];
  const emblem = input.inlineEmblem ?? null;

  const headers = [
    `From: ${formatFromHeader(sender)}`,
    `To: ${validated.recipient}`,
    `Subject: ${encodeSubject(validated.subject)}`,
    "MIME-Version: 1.0",
  ];

  let mime: string;
  if (!emblem) {
    // Legacy plain-text path (used by unit tests / any caller without an emblem).
    const encodedBody = wrap76(Buffer.from(validated.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64"));
    if (attachments.length === 0) {
      mime = [...headers, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encodedBody].join("\r\n");
    } else {
      const boundary = `orr_${Buffer.from(`${validated.recipient}:${attachments.length}`).toString("hex").slice(0, 16)}_${Date.now().toString(36)}`;
      const parts: string[] = [
        ...headers,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encodedBody,
      ];
      for (const a of attachments) {
        const p = attachmentPart(a);
        parts.push(`--${boundary}`, ...p.headers, "", p.body);
      }
      parts.push(`--${boundary}--`);
      mime = parts.join("\r\n");
    }
  } else {
    // HTML path: multipart/alternative (plain + branded HTML) inside
    // multipart/related (so the emblem CID resolves), optionally wrapped in
    // multipart/mixed when file attachments ride along.
    const plain = base64TextPart("Content-Type: text/plain; charset=UTF-8", renderOutreachPlainText(validated.body).replace(/\r?\n/g, "\r\n"));
    const html = base64TextPart("Content-Type: text/html; charset=UTF-8", renderOutreachHtml(validated.body, { emblemCid: emblem.contentId }));
    const alternative = renderMultipart("alternative", [plain, html]);
    const emblemMime = /^[\w.+-]+\/[\w.+-]+$/.test(emblem.mimeType) ? emblem.mimeType : "application/octet-stream";
    const emblemPart: MimePart = {
      headers: [`Content-Type: ${emblemMime}`, "Content-Transfer-Encoding: base64", `Content-ID: <${emblem.contentId}>`, `Content-Disposition: inline; filename="orr-emblem.png"`],
      body: wrap76(emblem.contentBase64.replace(/\s+/g, "")),
    };
    const related = renderMultipart("related", [alternative, emblemPart]);
    const top = attachments.length ? renderMultipart("mixed", [related, ...attachments.map(attachmentPart)]) : related;
    mime = [...headers, ...top.headers, "", top.body].join("\r\n");
  }
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
    // 429 (and Gmail's 5xx) are transient throttling — surfaced distinctly so
    // the outreach drainer can back off and retry rather than mark a hard fail.
    if (response.status === 429 || response.status >= 500) {
      throw new GmailTestSendError("gmail_rate_limited", "Google is rate-limiting sends right now. This will retry automatically.", 429);
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
  const { raw } = buildGmailMimeMessage({ ...input, sender: session.sender, inlineEmblem: loadOrrEmblem() });
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
