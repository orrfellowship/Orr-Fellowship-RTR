import { NextRequest, NextResponse } from "next/server";
import {
  GMAIL_RETURN_TO,
  GOOGLE_STATE_COOKIE,
  exchangeGoogleCode,
  fetchGoogleEmail,
  getAuthenticatedRtrUser,
  getGoogleOAuthConfig,
  storeGmailConnection,
} from "@/lib/gmail/server";
import { validateOAuthState } from "@/lib/gmail/security.server";

export const runtime = "nodejs";

function redirectWithResult(request: NextRequest, key: "gmail" | "gmail_error", value: string) {
  const destination = new URL(GMAIL_RETURN_TO, request.url);
  destination.searchParams.set(key, value);
  const response = NextResponse.redirect(destination);
  response.cookies.set(GOOGLE_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/api/google/callback",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const nonce = request.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  const user = await getAuthenticatedRtrUser();
  if (!user) return redirectWithResult(request, "gmail_error", "authentication");

  let config;
  try {
    config = getGoogleOAuthConfig();
    if (!state || !nonce) throw new Error("OAuth state is missing");
    validateOAuthState(state, { userId: user.id, returnTo: GMAIL_RETURN_TO, nonce }, config.encryptionKey);
  } catch (error) {
    console.error("Google OAuth state validation failed:", error instanceof Error ? error.message : "Unknown error");
    return redirectWithResult(request, "gmail_error", "invalid_state");
  }

  const googleError = request.nextUrl.searchParams.get("error");
  if (googleError) {
    return redirectWithResult(request, "gmail_error", googleError === "access_denied" ? "access_denied" : "google_error");
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return redirectWithResult(request, "gmail_error", "missing_code");

  try {
    const tokens = await exchangeGoogleCode(code, config);
    if (!tokens.access_token) throw new Error("Google did not return an access token");
    const email = await fetchGoogleEmail(tokens.access_token);
    await storeGmailConnection(user.id, email, tokens, config);
    return redirectWithResult(request, "gmail", "connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Google OAuth callback failed:", message);
    const safeCode = message.includes("@orrfellowship.org") ? "invalid_domain"
      : message.includes("refresh token") ? "missing_refresh_token"
      : message.includes("permission") ? "missing_scope"
      : "callback_failed";
    return redirectWithResult(request, "gmail_error", safeCode);
  }
}
