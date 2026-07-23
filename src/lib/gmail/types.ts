export type GmailConnectionStatus = {
  connected: boolean;
  connectedEmail: string | null;
  connectedAt: string | null;
  grantedScopes?: string[];
};

export const GMAIL_TEST_SEND_LIMITS = {
  recipient: 254,
  subject: 200,
  body: 10_000,
} as const;
