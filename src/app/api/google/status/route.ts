import { NextResponse } from "next/server";
import { getAuthenticatedRtrUser, getGmailConnectionStatusForUser } from "@/lib/gmail/server";

export const runtime = "nodejs";

export async function GET() {
  const user = await getAuthenticatedRtrUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const status = await getGmailConnectionStatusForUser(user.id);
    return NextResponse.json(status, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to load Gmail connection status" }, { status: 500 });
  }
}
