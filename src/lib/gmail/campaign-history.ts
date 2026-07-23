export type CampaignHistoryFilters = {
  q?: string;
  senderId?: string;
  schoolId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
};

export type CampaignHistoryRow = {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  skipped: number;
  replied: number;
  bounced: number;
  sender: {
    id: string;
    name: string;
    email: string;
    schoolId: string | null;
    schoolName: string | null;
  };
};

export type CampaignHistoryFacet = {
  id: string;
  name: string;
};

export type CampaignHistoryData = {
  rows: CampaignHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  senders: CampaignHistoryFacet[];
  schools: CampaignHistoryFacet[];
};
