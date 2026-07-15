export type GmailConnectionStatus = {
  connected: boolean;
  connectedEmail: string | null;
  connectedAt: string | null;
  grantedScopes?: string[];
};
