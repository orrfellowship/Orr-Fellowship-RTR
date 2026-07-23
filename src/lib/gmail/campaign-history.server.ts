import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { isAdminPlus, type Profile } from "@/lib/types";
import type {
  CampaignHistoryData,
  CampaignHistoryFilters,
  CampaignHistoryRow,
} from "./campaign-history";

const PAGE_SIZE = 25;
const CAMPAIGN_STATUSES = new Set(["queued", "sending", "sent", "partial", "failed", "canceled"]);

const clampPage = (page: number | undefined) =>
  Number.isFinite(page) ? Math.max(0, Math.floor(page!)) : 0;

export async function loadAdminCampaignHistory(
  profile: Profile,
  filters: CampaignHistoryFilters,
): Promise<CampaignHistoryData> {
  if (!isAdminPlus(profile.role)) throw new Error("Forbidden");

  const db = createServiceClient();
  const page = clampPage(filters.page);
  const [{ data: peopleData, error: peopleError }, { data: schoolData, error: schoolError }] = await Promise.all([
    db.from("profiles").select("id, full_name, email, school_id").order("full_name"),
    db.from("schools").select("id, name").order("name"),
  ]);
  if (peopleError || schoolError) throw new Error("Campaign history filters are temporarily unavailable.");

  const people = (peopleData ?? []) as Array<{ id: string; full_name: string; email: string; school_id: string | null }>;
  const schools = (schoolData ?? []) as Array<{ id: string; name: string }>;
  const schoolNameById = new Map(schools.map((school) => [school.id, school.name]));
  const personById = new Map(people.map((person) => [person.id, person]));

  let allowedCreatorIds: string[] | null = null;
  if (filters.schoolId) {
    allowedCreatorIds = people.filter((person) => person.school_id === filters.schoolId).map((person) => person.id);
  }
  if (filters.senderId) {
    allowedCreatorIds = allowedCreatorIds
      ? allowedCreatorIds.filter((id) => id === filters.senderId)
      : [filters.senderId];
  }

  if (allowedCreatorIds?.length === 0) {
    return {
      rows: [],
      total: 0,
      page,
      pageSize: PAGE_SIZE,
      senders: people.map((person) => ({ id: person.id, name: person.full_name })),
      schools: schools.map((school) => ({ id: school.id, name: school.name })),
    };
  }

  let query = db.from("outreach_campaigns")
    .select("id, created_by, name, subject, body, status, total_count, created_at, completed_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  const q = filters.q?.trim();
  if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "\\$&")}%`);
  if (allowedCreatorIds) query = query.in("created_by", allowedCreatorIds);
  if (filters.status && CAMPAIGN_STATUSES.has(filters.status)) query = query.eq("status", filters.status);
  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) query = query.gte("created_at", `${filters.from}T00:00:00`);
  if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) query = query.lte("created_at", `${filters.to}T23:59:59.999`);

  const { data: campaignData, count, error: campaignError } = await query;
  if (campaignError) throw new Error("Campaign history is temporarily unavailable.");

  const campaigns = (campaignData ?? []) as Array<{
    id: string;
    created_by: string;
    name: string;
    subject: string;
    body: string;
    status: string;
    total_count: number;
    created_at: string;
    completed_at: string | null;
  }>;
  const campaignIds = campaigns.map((campaign) => campaign.id);
  const aggregate = new Map<string, Omit<CampaignHistoryRow, "id" | "name" | "subject" | "body" | "status" | "createdAt" | "completedAt" | "total" | "sender">>();
  for (const id of campaignIds) aggregate.set(id, { sent: 0, failed: 0, pending: 0, skipped: 0, replied: 0, bounced: 0 });

  if (campaignIds.length) {
    const { data: sendData, error: sendError } = await db.from("outreach_sends")
      .select("campaign_id, status, replied_at, bounced_at")
      .in("campaign_id", campaignIds);
    if (sendError) throw new Error("Campaign delivery totals are temporarily unavailable.");
    for (const send of sendData ?? []) {
      const counts = aggregate.get((send as any).campaign_id);
      if (!counts) continue;
      if ((send as any).status === "sent") counts.sent++;
      else if ((send as any).status === "failed") counts.failed++;
      else if ((send as any).status === "queued") counts.pending++;
      else counts.skipped++;
      if ((send as any).replied_at) counts.replied++;
      if ((send as any).bounced_at) counts.bounced++;
    }
  }

  const rows: CampaignHistoryRow[] = campaigns.map((campaign) => {
    const sender = personById.get(campaign.created_by);
    return {
      id: campaign.id,
      name: campaign.name,
      subject: campaign.subject,
      body: campaign.body,
      status: campaign.status,
      createdAt: campaign.created_at,
      completedAt: campaign.completed_at,
      total: campaign.total_count,
      ...aggregate.get(campaign.id)!,
      sender: {
        id: campaign.created_by,
        name: sender?.full_name ?? "Unknown sender",
        email: sender?.email ?? "",
        schoolId: sender?.school_id ?? null,
        schoolName: sender?.school_id ? schoolNameById.get(sender.school_id) ?? null : null,
      },
    };
  });

  return {
    rows,
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    senders: people.map((person) => ({ id: person.id, name: person.full_name })),
    schools: schools.map((school) => ({ id: school.id, name: school.name })),
  };
}
