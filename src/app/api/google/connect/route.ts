import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  GMAIL_RETURN_TO,
  GOOGLE_STATE_COOKIE,
  getAuthenticatedRtrUser,
  getGoogleOAuthConfig,
  googleAuthorizationUrl,
} from "@/lib/gmail/server";
import { createOAuthState } from "@/lib/gmail/security.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getAuthenticatedRtrUser();
  if (!user) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", GMAIL_RETURN_TO);
    return NextResponse.redirect(login);
  }

  try {
    const config = getGoogleOAuthConfig();
    const nonce = randomBytes(32).toString("base64url");
    const state = createOAuthState({ userId: user.id, returnTo: GMAIL_RETURN_TO, nonce }, config.encryptionKey);
    const response = NextResponse.redirect(googleAuthorizationUrl(config, state));
    response.cookies.set(GOOGLE_STATE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60,
      path: "/api/google/callback",
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error("Unable to start Google OAuth:", error instanceof Error ? error.message : "Unknown error");
    const destination = new URL(GMAIL_RETURN_TO, request.url);
    destination.searchParams.set("gmail_error", "configuration");
    return NextResponse.redirect(destination);
  }
}
