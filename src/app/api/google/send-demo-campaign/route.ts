import { NextResponse } from "next/server";
import { sendDemoCampaignForUser } from "@/lib/gmail/demo-campaign.server";
import type { DemoCampaignResult } from "@/lib/gmail/demo-campaign";
import { isPreviewing } from "@/lib/auth";
import { getAuthenticatedRtrAdmin } from "@/lib/gmail/server";
import { GmailTestSendError, isGmailTestSendEnabled, safeTestSendError } from "@/lib/gmail/test-send.server";

export const runtime = "nodejs";

type DemoCampaignRouteDependencies = {
  nodeEnv: string | undefined;
  enabledFlag: string | undefined;
  productionEnabledFlag: string | undefined;
  authenticate: () => Promise<{ id: string } | null>;
  previewing: () => Promise<boolean>;
  send: (userId: string, input: unknown) => Promise<DemoCampaignResult>;
};

function getDefaultDependencies(): DemoCampaignRouteDependencies {
  return {
    nodeEnv: process.env.NODE_ENV,
    enabledFlag: process.env.ENABLE_GMAIL_TEST_SEND,
    productionEnabledFlag: process.env.ENABLE_GMAIL_PRODUCTION_TEST_SEND,
    authenticate: getAuthenticatedRtrAdmin,
    previewing: isPreviewing,
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
  if (!isGmailTestSendEnabled({
    NODE_ENV: dependencies.nodeEnv,
    ENABLE_GMAIL_TEST_SEND: dependencies.enabledFlag,
    ENABLE_GMAIL_PRODUCTION_TEST_SEND: dependencies.productionEnabledFlag,
  })) {
    return jsonError(new GmailTestSendError("feature_disabled", "Controlled Gmail campaign testing is disabled.", 404));
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
  if (!user) return jsonError(new GmailTestSendError("forbidden", "Active Admin or Super Admin access is required.", 403));
  if (await dependencies.previewing()) {
    return jsonError(new GmailTestSendError("preview_read_only", "Exit View As mode before sending a Gmail test campaign.", 403));
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonError(new GmailTestSendError("invalid_json", "Send a valid JSON request.", 400));
  }
  if (
    dependencies.nodeEnv === "production"
    && input
    && typeof input === "object"
    && !Array.isArray(input)
    && Array.isArray((input as Record<string, unknown>).selectedCandidateIds)
    && ((input as Record<string, unknown>).selectedCandidateIds as unknown[]).length > 1
  ) {
    return jsonError(new GmailTestSendError("production_test_limit", "Select exactly one candidate for the production Gmail smoke test.", 400));
  }

  try {
    const result = await dependencies.send(user.id, input);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const known = error instanceof GmailTestSendError
      ? error
      : new GmailTestSendError("campaign_send_failed", "The controlled Gmail campaign test could not be completed.", 502);
    return jsonError(known);
  }
}

export async function POST(request: Request) {
  return handleDemoCampaignRequest(request);
}

export type { DemoCampaignRouteDependencies };
