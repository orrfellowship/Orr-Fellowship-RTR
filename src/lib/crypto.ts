import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// At-rest encryption for Gmail OAuth refresh tokens (gmail_credentials table).
// AES-256-GCM with a key from TOKEN_ENCRYPTION_KEY — generate one with:
//   openssl rand -base64 32
// Format: "v1:<iv>:<auth tag>:<ciphertext>" (base64 parts). The version prefix
// lets us rotate the scheme later without guessing what an old row contains.
//
// Server-side only: this module must never be imported into client components,
// and decrypted tokens must never be sent to the browser or persisted anywhere.

const VERSION = "v1";
const IV_BYTES = 12; // GCM standard nonce size

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set — generate one with `openssl rand -base64 32`.");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes of base64 (openssl rand -base64 32).");
  return buf;
}

export function tokenEncryptionConfigured(): boolean {
  try { key(); return true; } catch { return false; }
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptToken(encrypted: string): string {
  const [version, ivB64, tagB64, ctB64] = encrypted.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Unrecognized encrypted token format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
