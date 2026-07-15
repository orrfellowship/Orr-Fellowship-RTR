import {
  DEMO_CAMPAIGN_LIMITS,
  DEMO_CANDIDATES,
  demoCandidateFullName,
  findUnsupportedMergeVariables,
  getAutomaticExclusionReason,
  maskDemoRecipient,
  renderTemplate,
  type DemoCampaignRecipientResult,
  type DemoCampaignResult,
  type DemoCandidate,
} from "./demo-campaign";
import {
  buildGmailMimeMessage,
  createGmailSendSessionForUser,
  GmailTestSendError,
  sendRawGmailMessage,
  validateGmailTestInput,
  type GmailSendResult,
  type GmailSendSession,
} from "./test-send.server";

export type DemoCampaignInput = {
  campaignName: string;
  subject: string;
  body: string;
  selectedCandidateIds: string[];
  idempotencyKey: string;
};

type PreparedMessage = {
  candidate: DemoCandidate;
  subject: string;
  body: string;
};

type DemoCampaignDependencies = {
  createSession?: (userId: string) => Promise<GmailSendSession>;
  sendMessage?: (accessToken: string, raw: string, fetchImpl: typeof fetch) => Promise<GmailSendResult>;
  now?: () => number;
};

type IdempotencyEntry = {
  fingerprint: string;
  expiresAt: number;
  result: Promise<DemoCampaignResult>;
};

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const idempotencyEntries = new Map<string, IdempotencyEntry>();

function invalidCampaign(code: string, message: string, status = 400): never {
  throw new GmailTestSendError(code, message, status);
}

export function validateDemoCampaignInput(value: unknown): DemoCampaignInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidCampaign("invalid_campaign", "Enter valid campaign content and candidate selections.");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.campaignName !== "string"
    || typeof input.subject !== "string"
    || typeof input.body !== "string"
    || !Array.isArray(input.selectedCandidateIds)
    || typeof input.idempotencyKey !== "string"
  ) {
    return invalidCampaign("invalid_campaign", "Enter valid campaign content and candidate selections.");
  }

  const campaignName = input.campaignName.trim();
  const subject = input.subject.trim();
  const body = input.body;
  if (!campaignName || !subject || !body.trim()) invalidCampaign("invalid_campaign", "Campaign name, subject, and body are required.");
  if (campaignName.length > DEMO_CAMPAIGN_LIMITS.campaignName) invalidCampaign("invalid_campaign", "Campaign name is too long.");
  if (subject.length > DEMO_CAMPAIGN_LIMITS.subject) invalidCampaign("invalid_campaign", "Campaign subject is too long.");
  if (body.length > DEMO_CAMPAIGN_LIMITS.body) invalidCampaign("invalid_campaign", "Campaign body is too long.");
  if (/[\r\n]/.test(subject)) invalidCampaign("invalid_campaign", "Campaign subject cannot contain line breaks.");

  const selectedCandidateIds = input.selectedCandidateIds;
  if (!selectedCandidateIds.length) invalidCampaign("missing_recipients", "Select at least one mock candidate.");
  if (selectedCandidateIds.length > DEMO_CAMPAIGN_LIMITS.selectedCandidates) {
    invalidCampaign("too_many_recipients", `Select no more than ${DEMO_CAMPAIGN_LIMITS.selectedCandidates} mock candidates.`);
  }
  if (selectedCandidateIds.some((id) => typeof id !== "string" || !id)) {
    invalidCampaign("invalid_candidate", "Candidate selections are invalid.");
  }
  if (new Set(selectedCandidateIds).size !== selectedCandidateIds.length) {
    invalidCampaign("duplicate_candidate", "Each mock candidate may be selected only once.");
  }

  const knownIds = new Set(DEMO_CANDIDATES.map((candidate) => candidate.id));
  if (selectedCandidateIds.some((id) => !knownIds.has(id))) {
    invalidCampaign("unknown_candidate", "One or more selected mock candidates are unknown.");
  }

  const unsupported = [...findUnsupportedMergeVariables(subject), ...findUnsupportedMergeVariables(body)];
  if (unsupported.length) {
    invalidCampaign("unsupported_merge_variable", "Remove unsupported or unresolved merge variables before sending.");
  }

  const idempotencyKey = input.idempotencyKey.trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey) || idempotencyKey.length > DEMO_CAMPAIGN_LIMITS.idempotencyKey) {
    invalidCampaign("invalid_idempotency_key", "The campaign request identifier is invalid.");
  }

  return { campaignName, subject, body, selectedCandidateIds: selectedCandidateIds as string[], idempotencyKey };
}

function prepareMessages(input: DemoCampaignInput): {
  messages: PreparedMessage[];
  excluded: DemoCampaignRecipientResult[];
} {
  const candidateById = new Map(DEMO_CANDIDATES.map((candidate) => [candidate.id, candidate]));
  const messages: PreparedMessage[] = [];
  const excluded: DemoCampaignRecipientResult[] = [];

  for (const candidateId of input.selectedCandidateIds) {
    const candidate = candidateById.get(candidateId)!;
    const exclusionReason = getAutomaticExclusionReason(candidate);
    if (exclusionReason) {
      excluded.push({
        candidateId,
        candidateName: demoCandidateFullName(candidate),
        maskedRecipient: maskDemoRecipient(candidate.email),
        status: "excluded",
        exclusionReason,
      });
      continue;
    }

    const subject = renderTemplate(input.subject, candidate);
    const body = renderTemplate(input.body, candidate);
    validateGmailTestInput({ recipient: candidate.email, subject, body });
    messages.push({ candidate, subject, body });
  }
  return { messages, excluded };
}

async function runCampaignSend(
  userId: string,
  input: DemoCampaignInput,
  dependencies: DemoCampaignDependencies,
): Promise<DemoCampaignResult> {
  const { messages, excluded } = prepareMessages(input);
  if (!messages.length) invalidCampaign("missing_recipients", "No selected mock candidates are eligible for Gmail delivery.");

  const session = await (dependencies.createSession ?? createGmailSendSessionForUser)(userId);
  const sendMessage = dependencies.sendMessage ?? sendRawGmailMessage;
  const recipients: DemoCampaignRecipientResult[] = [...excluded];

  for (const message of messages) {
    const candidateName = demoCandidateFullName(message.candidate);
    const maskedRecipient = maskDemoRecipient(message.candidate.email);
    const { raw } = buildGmailMimeMessage({
      sender: session.sender,
      recipient: message.candidate.email!,
      subject: message.subject,
      body: message.body,
    });
    try {
      const result = await sendMessage(session.accessToken, raw, session.fetchImpl);
      recipients.push({
        candidateId: message.candidate.id,
        candidateName,
        maskedRecipient,
        status: "sent",
        messageId: result.messageId,
      });
    } catch (error) {
      const failureReason = error instanceof GmailTestSendError
        ? error.message
        : "Google could not send this personalized message.";
      recipients.push({
        candidateId: message.candidate.id,
        candidateName,
        maskedRecipient,
        status: "failed",
        failureReason,
      });
    }
  }

  const sent = recipients.filter((recipient) => recipient.status === "sent").length;
  const failed = recipients.filter((recipient) => recipient.status === "failed").length;
  return {
    success: true,
    attempted: messages.length,
    sent,
    failed,
    excluded: excluded.length,
    recipients,
  };
}

export async function sendDemoCampaignForUser(
  userId: string,
  value: unknown,
  dependencies: DemoCampaignDependencies = {},
): Promise<DemoCampaignResult> {
  const input = validateDemoCampaignInput(value);
  const fingerprint = JSON.stringify({
    campaignName: input.campaignName,
    subject: input.subject,
    body: input.body,
    selectedCandidateIds: input.selectedCandidateIds,
  });
  const now = (dependencies.now ?? Date.now)();
  for (const [key, entry] of idempotencyEntries) {
    if (entry.expiresAt <= now) idempotencyEntries.delete(key);
  }

  const storageKey = `${userId}:${input.idempotencyKey}`;
  const existing = idempotencyEntries.get(storageKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      invalidCampaign("idempotency_conflict", "This campaign request identifier was already used for different content.", 409);
    }
    return existing.result;
  }

  const result = runCampaignSend(userId, input, dependencies);
  idempotencyEntries.set(storageKey, { fingerprint, expiresAt: now + IDEMPOTENCY_TTL_MS, result });
  try {
    return await result;
  } catch (error) {
    idempotencyEntries.delete(storageKey);
    throw error;
  }
}

export function resetDemoCampaignIdempotencyForTests(): void {
  idempotencyEntries.clear();
}

export type { DemoCampaignDependencies };
