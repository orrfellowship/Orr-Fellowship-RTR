import { NextResponse } from "next/server";
import { sendDemoCampaignForUser } from "@/lib/gmail/demo-campaign.server";
import type { DemoCampaignResult } from "@/lib/gmail/demo-campaign";
import { getAuthenticatedRtrUser } from "@/lib/gmail/server";
import { GmailTestSendError, isGmailTestSendEnabled, safeTestSendError } from "@/lib/gmail/test-send.server";

export const runtime = "nodejs";

type DemoCampaignRouteDependencies = {
  nodeEnv: string | undefined;
  enabledFlag: string | undefined;
  authenticate: () => Promise<{ id: string } | null>;
  send: (userId: string, input: unknown) => Promise<DemoCampaignResult>;
};

function getDefaultDependencies(): DemoCampaignRouteDependencies {
  return {
    nodeEnv: process.env.NODE_ENV,
    enabledFlag: process.env.ENABLE_GMAIL_TEST_SEND,
    authenticate: getAuthenticatedRtrUser,
    send: sendDemoCampaignForUser,
  };
}

function jsonError(error: GmailTestSendError) {
  return NextResponse.json(safeTestSendError(error), {
    status: error.status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function handleDemoCampaignRequest(
  request: Request,
  dependencies: DemoCampaignRouteDependencies = getDefaultDependencies(),
) {
  if (dependencies.nodeEnv === "production") {
    return jsonError(new GmailTestSendError("not_available", "Local Gmail campaign testing is unavailable in production.", 404));
  }
  if (!isGmailTestSendEnabled({ NODE_ENV: dependencies.nodeEnv, ENABLE_GMAIL_TEST_SEND: dependencies.enabledFlag })) {
    return jsonError(new GmailTestSendError("feature_disabled", "Local Gmail campaign testing is disabled.", 404));
  }

  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    sameOrigin = !!origin && new URL(origin).origin === new URL(request.url).origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) return jsonError(new GmailTestSendError("invalid_origin", "Invalid request origin.", 403));

  const user = await dependencies.authenticate();
  if (!user) return jsonError(new GmailTestSendError("unauthorized", "Sign in to send this local Gmail campaign test.", 401));

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonError(new GmailTestSendError("invalid_json", "Send a valid JSON request.", 400));
  }

  try {
    const result = await dependencies.send(user.id, input);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const known = error instanceof GmailTestSendError
      ? error
      : new GmailTestSendError("campaign_send_failed", "The local Gmail campaign test could not be completed.", 502);
    return jsonError(known);
  }
}

export async function POST(request: Request) {
  return handleDemoCampaignRequest(request);
}

export type { DemoCampaignRouteDependencies };
