import { NextRequest, NextResponse } from "next/server";
import {
  disconnectGmailForUser,
  gmailReturnToForRole,
  getAuthenticatedRtrUser,
} from "@/lib/gmail/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getAuthenticatedRtrUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const destination = new URL(gmailReturnToForRole(user.rtrRole), request.url);
  try {
    await disconnectGmailForUser(user.id);
    destination.searchParams.set("gmail", "disconnected");
  } catch (error) {
    console.error("Unable to disconnect Gmail:", error instanceof Error ? error.message : "Unknown error");
    destination.searchParams.set("gmail_error", "disconnect_failed");
  }
  return NextResponse.redirect(destination, 303);
}
