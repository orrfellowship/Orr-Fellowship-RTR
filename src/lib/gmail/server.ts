import { createServerSupabase, createServiceClient } from "@/lib/supabase/server";
import {
  decryptRefreshToken,
  encryptRefreshToken,
  normalizeOrrEmail,
  serializeGmailConnection,
  type EncryptedRefreshToken,
} from "./security.server";
import type { GmailConnectionStatus } from "./types";
import { isAdminPlus, type AppRole } from "@/lib/types";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
// Read-only headers/labels (no message bodies) — powers reply + bounce
// detection (Phase 7). Restricted scope, but the consent screen is Internal so
// no Google verification is required.
export const GMAIL_METADATA_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
export const GOOGLE_IDENTITY_SCOPES = ["openid", "email"] as const;

// A connection can send + track replies only if it granted BOTH scopes. A
// connection made before the metadata scope was added has send only, and needs
// a reconnect to enable reply/bounce tracking.
export function hasReplyTrackingScope(grantedScopes: string[] | undefined): boolean {
  return !!grantedScopes?.includes(GMAIL_METADATA_SCOPE);
}
export const GMAIL_ADMIN_RETURN_TO = "/console/email-campaigns";
export const GMAIL_WORKSPACE_RETURN_TO = "/workspace/email-campaigns";
export function gmailReturnToForRole(role: AppRole): string {
  return isAdminPlus(role) ? GMAIL_ADMIN_RETURN_TO : GMAIL_WORKSPACE_RETURN_TO;
}
export const GOOGLE_STATE_COOKIE = "orr_google_oauth_state";

type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
};

type GmailCredentialRow = EncryptedRefreshToken & {
  user_id: string;
  google_email: string;
  granted_scopes: string[];
  connected_at: string;
};

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const values = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
    encryptionKey: process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY,
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    const envNames: Record<string, string> = {
      clientId: "GOOGLE_CLIENT_ID",
      clientSecret: "GOOGLE_CLIENT_SECRET",
      redirectUri: "GOOGLE_REDIRECT_URI",
      encryptionKey: "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY",
    };
    throw new Error(`Missing Google OAuth configuration: ${missing.map((name) => envNames[name]).join(", ")}`);
  }
  return values as GoogleOAuthConfig;
}

export async function getAuthenticatedRtrUser() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.is_active ? { id: user.id, rtrRole: profile.role as AppRole } : null;
}

export async function getAuthenticatedRtrAdmin() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.is_active && isAdminPlus(profile.role as AppRole) ? { id: user.id } : null;
}

export async function getGmailConnectionStatusForUser(userId: string): Promise<GmailConnectionStatus> {
  const { data, error } = await createServiceClient()
    .from("gmail_connections")
    .select("google_email, connected_at, granted_scopes")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Unable to load Gmail connection status");
  return serializeGmailConnection(data);
}

export function googleAuthorizationUrl(config: GoogleOAuthConfig, state: string): URL {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: [...GOOGLE_IDENTITY_SCOPES, GMAIL_SEND_SCOPE, GMAIL_METADATA_SCOPE].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    hd: "orrfellowship.org",
    state,
  }).toString();
  return url;
}

export async function exchangeGoogleCode(
  code: string,
  config: GoogleOAuthConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokenResponse> {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Google authorization code exchange failed");
  return response.json() as Promise<GoogleTokenResponse>;
}

export async function fetchGoogleEmail(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to retrieve the connected Google identity");
  const identity = await response.json() as { email?: unknown; email_verified?: unknown };
  if (identity.email_verified !== true || typeof identity.email !== "string") {
    throw new Error("Google did not return a verified email address");
  }
  return normalizeOrrEmail(identity.email);
}

export async function storeGmailConnection(
  userId: string,
  email: string,
  tokens: GoogleTokenResponse,
  config: GoogleOAuthConfig,
): Promise<void> {
  const db = createServiceClient();
  const { data: existing, error: existingError } = await db
    .from("gmail_connections")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw new Error("Unable to check the existing Gmail connection");

  const grantedScopes = tokens.scope?.split(/\s+/).filter(Boolean)
    ?? [...GOOGLE_IDENTITY_SCOPES, GMAIL_SEND_SCOPE];
  if (!grantedScopes.includes(GMAIL_SEND_SCOPE)) {
    throw new Error("The required Gmail send permission was not granted");
  }

  const now = new Date();
  const expiration = (seconds?: number) => typeof seconds === "number"
    ? new Date(now.getTime() + seconds * 1000).toISOString()
    : null;
  const safeMetadata = {
    google_email: normalizeOrrEmail(email),
    granted_scopes: grantedScopes,
    access_token_expires_at: expiration(tokens.expires_in),
    ...(typeof tokens.refresh_token_expires_in === "number"
      ? { refresh_token_expires_at: expiration(tokens.refresh_token_expires_in) }
      : {}),
    updated_at: now.toISOString(),
  };

  if (tokens.refresh_token) {
    const encrypted = encryptRefreshToken(tokens.refresh_token, config.encryptionKey);
    const { error } = await db.from("gmail_connections").upsert({
      user_id: userId,
      ...safeMetadata,
      ...encrypted,
      connected_at: now.toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw new Error("Unable to save the Gmail connection");
    return;
  }

  if (!existing) throw new Error("Google did not return a refresh token; reconnect and grant consent");
  const { error } = await db.from("gmail_connections").update(safeMetadata).eq("user_id", userId);
  if (error) throw new Error("Unable to update the Gmail connection");
}

export async function disconnectGmailForUser(userId: string): Promise<void> {
  const db = createServiceClient();
  const { data } = await db
    .from("gmail_connections")
    .select("refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag")
    .eq("user_id", userId)
    .maybeSingle();

  try {
    if (data) {
      const keyValue = process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY;
      if (!keyValue) throw new Error("Token encryption configuration is missing");
      const token = decryptRefreshToken(data as EncryptedRefreshToken, keyValue);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        cache: "no-store",
      });
    }
  } catch {
    // Local deletion is mandatory even when Google is unavailable or revocation fails.
  }

  const { error } = await db.from("gmail_connections").delete().eq("user_id", userId);
  if (error) throw new Error("Unable to remove the Gmail connection");
}

export type { GoogleOAuthConfig, GoogleTokenResponse, GmailCredentialRow };
