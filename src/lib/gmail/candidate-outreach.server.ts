import { createServiceClient } from "@/lib/supabase/server";
import { getSchoolsCached, fetchAllRows } from "@/lib/queries";
import { candidateSchoolDisplay } from "@/lib/candidateSchool";
import { isAdminPlus, type AppRole, type Profile } from "@/lib/types";
import { candidateOutreachTokens, renderOutreachTemplate, findUnsupportedOutreachVariables, type ComposerRecipient, type OutreachAudience, type CampaignHistoryItem } from "./candidate-tokens";
import { enqueueOutreachCampaign, type EnqueueRecipient, type EnqueueResult } from "./outreach-queue.server";
import { GmailTestSendError } from "./test-send.server";

// Shared input validation for the live outreach routes. Throws GmailTestSendError
// (same shape the routes already translate to JSON) so a bad payload — or a
// typo'd merge token — fails loudly before anything is enqueued.
export const OUTREACH_LIMITS = { campaignName: 120, subject: 200, body: 20_000, maxRecipients: 1000, idempotencyKey: 128 } as const;

export type ValidatedOutreachInput = { campaignName: string; subject: string; body: string; ids: string[]; idempotencyKey: string };

export function validateOutreachInput(value: unknown): ValidatedOutreachInput {
  const bad = (code: string, msg: string): never => { throw new GmailTestSendError(code, msg, 400); };
  if (!value || typeof value !== "object" || Array.isArray(value)) bad("invalid_campaign", "Send valid campaign content.");
  const v = value as Record<string, unknown>;
  const ids = v.selectedIds ?? v.selectedCandidateIds ?? v.selectedUserIds;
  if (typeof v.campaignName !== "string" || typeof v.subject !== "string" || typeof v.body !== "string" || !Array.isArray(ids) || typeof v.idempotencyKey !== "string") {
    bad("invalid_campaign", "Send valid campaign content and a recipient selection.");
  }
  const campaignName = (v.campaignName as string).trim();
  const subject = (v.subject as string).trim();
  const body = v.body as string;
  if (!campaignName || !subject || !body.trim()) bad("invalid_campaign", "Campaign name, subject, and message are required.");
  if (campaignName.length > OUTREACH_LIMITS.campaignName) bad("invalid_campaign", "Campaign name is too long.");
  if (subject.length > OUTREACH_LIMITS.subject) bad("invalid_campaign", "Subject is too long.");
  if (/[\r\n]/.test(subject)) bad("invalid_campaign", "Subject cannot contain line breaks.");
  if (body.length > OUTREACH_LIMITS.body) bad("invalid_campaign", "Message is too long.");
  const unsupported = [...findUnsupportedOutreachVariables(subject), ...findUnsupportedOutreachVariables(body)];
  if (unsupported.length) bad("unsupported_merge_variable", `Unknown merge field(s): ${unsupported.join(", ")}. Fix them before sending.`);
  const list = ids as unknown[];
  if (!list.length) bad("missing_recipients", "Select at least one recipient.");
  if (list.length > OUTREACH_LIMITS.maxRecipients) bad("too_many_recipients", `Select no more than ${OUTREACH_LIMITS.maxRecipients} recipients.`);
  if (list.some((id) => typeof id !== "string" || !id)) bad("invalid_recipient", "Recipient selection is invalid.");
  if (new Set(list as string[]).size !== list.length) bad("duplicate_recipient", "A recipient was selected more than once.");
  const idempotencyKey = (v.idempotencyKey as string).trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) bad("invalid_idempotency_key", "Invalid request identifier.");
  return { campaignName, subject, body, ids: list as string[], idempotencyKey };
}

// Real-candidate outreach (Phase 4). Turns a sender's selected candidates into
// enqueued sends, enforcing the core rule: you may only email candidates you're
// the point person for. Admins/supers oversee the whole pipeline, so they may
// email any candidate; fellows/leads are strictly scoped to their assignments.
// Everything else (email-format, do_not_contact, 2/week, 300/day) is enforced
// by the queue engine at enqueue AND drain — this layer only adds the
// assignment guard and token rendering.

export type OutreachCandidate = {
  id: string; name: string | null; email: string | null; stage: string | null;
  gradDate: string | null; pointPersonId: string | null;
  schoolLabel: string; pointPersonName: string;
};

// Pure core (unit-tested): assignment guard + per-candidate token rendering.
export function buildCandidateRecipients(
  candidates: OutreachCandidate[],
  opts: { subject: string; body: string; senderUserId: string; isAdmin: boolean },
): { recipients: EnqueueRecipient[]; skippedUnassigned: string[] } {
  const recipients: EnqueueRecipient[] = [];
  const skippedUnassigned: string[] = [];
  for (const c of candidates) {
    // The security boundary: a fellow/lead can only email their own assignments.
    // Never trust a candidate id from the client without this check.
    if (!opts.isAdmin && c.pointPersonId !== opts.senderUserId) { skippedUnassigned.push(c.id); continue; }
    const tokens = candidateOutreachTokens({
      name: c.name, stage: c.stage, gradDate: c.gradDate,
      school: c.schoolLabel, pointPerson: c.pointPersonName,
    });
    recipients.push({
      candidateId: c.id,
      toEmail: (c.email ?? "").trim(),
      renderedSubject: renderOutreachTemplate(opts.subject, tokens),
      renderedBody: renderOutreachTemplate(opts.body, tokens),
    });
  }
  return { recipients, skippedUnassigned };
}

export type CandidateCampaignInput = {
  campaignName: string; subject: string; body: string;
  selectedCandidateIds: string[]; idempotencyKey?: string | null;
};

export type CandidateCampaignDeps = {
  loadCandidates?: (ids: string[]) => Promise<Array<{ id: string; name: string | null; email: string | null; stage: string | null; grad_date: string | null; school_id: string | null; university_raw: string | null; point_person_id: string | null }>>;
  loadSchools?: () => Promise<any[]>;
  loadProfileNames?: (ids: string[]) => Promise<Map<string, string>>;
  enqueue?: typeof enqueueOutreachCampaign;
};

// Server entrypoint: sender + role come from the session (never the body).
export async function enqueueCandidateCampaign(
  senderUserId: string,
  role: AppRole,
  input: CandidateCampaignInput,
  deps: CandidateCampaignDeps = {},
): Promise<EnqueueResult & { skippedUnassigned: string[] }> {
  const loadCandidates = deps.loadCandidates ?? defaultLoadCandidates;
  const loadSchools = deps.loadSchools ?? getSchoolsCached;
  const loadProfileNames = deps.loadProfileNames ?? defaultLoadProfileNames;
  const enqueue = deps.enqueue ?? enqueueOutreachCampaign;

  const rows = await loadCandidates(input.selectedCandidateIds);
  const schools = await loadSchools();
  const ownerIds = Array.from(new Set(rows.map((r) => r.point_person_id).filter((v): v is string => !!v)));
  const ownerNames = ownerIds.length ? await loadProfileNames(ownerIds) : new Map<string, string>();

  const candidates: OutreachCandidate[] = rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, stage: r.stage,
    gradDate: r.grad_date, pointPersonId: r.point_person_id,
    // {{school}} must be the SPECIFIC school ("IU Indianapolis"), never the
    // "Satellite School" group label — use the specific label when grouped.
    schoolLabel: (() => { const d = candidateSchoolDisplay(r, schools); return d.specificLabel ?? d.label; })(),
    pointPersonName: (r.point_person_id && ownerNames.get(r.point_person_id)) || "your Orr contact",
  }));

  const { recipients, skippedUnassigned } = buildCandidateRecipients(candidates, {
    subject: input.subject, body: input.body, senderUserId, isAdmin: isAdminPlus(role),
  });

  const result = await enqueue(senderUserId, {
    campaignName: input.campaignName, subject: input.subject, body: input.body,
    recipients, idempotencyKey: input.idempotencyKey,
  });
  return { ...result, skippedUnassigned };
}

async function defaultLoadCandidates(ids: string[]) {
  if (!ids.length) return [];
  const db = createServiceClient();
  const { data } = await db.from("candidates")
    .select("id, name, email, stage, grad_date, school_id, university_raw, point_person_id")
    .in("id", ids);
  return (data ?? []) as any[];
}

async function defaultLoadProfileNames(ids: string[]): Promise<Map<string, string>> {
  const db = createServiceClient();
  const { data } = await db.from("profiles").select("id, full_name").in("id", ids);
  return new Map((data ?? []).map((p: any) => [p.id as string, p.full_name as string]));
}

// ---------------------------------------------------------------------------
// "Whole team" audience — email the RTR users themselves (fellows), not
// candidates. ADMIN/SUPER ONLY (e.g. a celebration note to the fellows). These
// recipients aren't candidates, so per-candidate rules (do_not_contact, 2/week)
// don't apply — candidate_id is null and only the 300/sender/day cap governs.
// ---------------------------------------------------------------------------

export type OutreachUser = { id: string; fullName: string | null; email: string | null };

export function excludePreviouslyEmailedUsers<T extends { email: string | null }>(users: T[], sentEmails: Iterable<string>): T[] {
  const sent = new Set(Array.from(sentEmails, (email) => email.trim().toLowerCase()).filter(Boolean));
  return users.filter((user) => {
    const email = user.email?.trim().toLowerCase();
    return !!email && !sent.has(email);
  });
}

export function buildUserRecipients(
  users: OutreachUser[],
  opts: { subject: string; body: string },
): EnqueueRecipient[] {
  return users.map((u) => {
    const tokens = candidateOutreachTokens({ name: u.fullName, stage: "", gradDate: "", school: "", pointPerson: "" });
    return {
      candidateId: null, // team members are not candidate rows
      toEmail: (u.email ?? "").trim(),
      renderedSubject: renderOutreachTemplate(opts.subject, tokens),
      renderedBody: renderOutreachTemplate(opts.body, tokens),
    };
  });
}

export type UsersCampaignInput = {
  campaignName: string; subject: string; body: string;
  selectedUserIds?: string[]; // omit/empty → every active user with an email
  idempotencyKey?: string | null;
};

export type UsersCampaignDeps = {
  loadUsers?: (ids: string[] | null) => Promise<OutreachUser[]>;
  enqueue?: typeof enqueueOutreachCampaign;
};

export async function enqueueUsersCampaign(
  senderUserId: string,
  role: AppRole,
  input: UsersCampaignInput,
  deps: UsersCampaignDeps = {},
): Promise<EnqueueResult & { forbidden?: true }> {
  // Emailing the whole team is an admin/super power — never a fellow's.
  if (!isAdminPlus(role)) return { forbidden: true, campaignId: "", queued: 0, skippedDnc: 0, skippedQuota: 0, invalid: 0, replayed: false };
  const loadUsers = deps.loadUsers ?? defaultLoadUsers;
  const enqueue = deps.enqueue ?? enqueueOutreachCampaign;

  const ids = input.selectedUserIds?.length ? input.selectedUserIds : null;
  const users = await loadUsers(ids);
  const recipients = buildUserRecipients(users, { subject: input.subject, body: input.body });
  return enqueue(senderUserId, {
    campaignName: input.campaignName, subject: input.subject, body: input.body,
    recipients, idempotencyKey: input.idempotencyKey,
  });
}

async function defaultLoadUsers(ids: string[] | null): Promise<OutreachUser[]> {
  const db = createServiceClient();
  let q = db.from("profiles").select("id, full_name, email").eq("is_active", true).not("email", "is", null);
  if (ids) q = q.in("id", ids);
  const [{ data, error }, { data: sentRows, error: sentError }] = await Promise.all([
    q,
    db.from("outreach_sends").select("to_email").eq("status", "sent"),
  ]);
  if (error) throw new Error(`Failed to load team recipients: ${error.message}`);
  if (sentError) throw new Error(`Failed to load prior outreach recipients: ${sentError.message}`);
  const users = (data ?? []).map((p: any) => ({ id: p.id, fullName: p.full_name, email: p.email }));
  return excludePreviouslyEmailedUsers(users, (sentRows ?? []).map((row: any) => row.to_email as string));
}

// ---------------------------------------------------------------------------
// Audience loading for the composer. Fellows/leads see their own assigned
// candidates, while admins/supers see all candidates. Each recipient carries a
// precomputed token set so the client preview matches the server's send.
// ---------------------------------------------------------------------------

function candidateToComposer(row: any, schools: any[], ownerNames: Map<string, string>): ComposerRecipient {
  const d = candidateSchoolDisplay(row, schools);
  const school = d.specificLabel ?? d.label;
  const pointPerson = (row.point_person_id && ownerNames.get(row.point_person_id)) || "your Orr contact";
  const tokens = candidateOutreachTokens({ name: row.name, stage: row.stage, gradDate: row.grad_date, school, pointPerson });
  return {
    id: row.id, name: (row.name ?? "").trim(), email: row.email, school,
    stage: row.stage ?? "", classYear: tokens.class_year, area: row.area_of_study ?? null,
    doNotContact: !!row.do_not_contact, tokens,
  };
}

const CAND_FIELDS = "id, name, email, stage, grad_date, school_id, university_raw, point_person_id, do_not_contact, area_of_study";

export async function loadOutreachAudiences(profile: Profile): Promise<OutreachAudience[]> {
  const db = createServiceClient();
  const schools = (await getSchoolsCached()) as any[];

  if (isAdminPlus(profile.role)) {
    const cands = await fetchAllRows<any>((from, to) => db.from("candidates").select(CAND_FIELDS).order("name").range(from, to));
    const ownerIds = Array.from(new Set(cands.map((c) => c.point_person_id).filter((v): v is string => !!v)));
    const ownerNames = ownerIds.length ? await defaultLoadProfileNames(ownerIds) : new Map<string, string>();
    return [
      { key: "all", label: "All candidates", description: "Every candidate in the pipeline", endpoint: "candidates", recipients: cands.map((c) => candidateToComposer(c, schools, ownerNames)) },
    ];
  }

  // Fellow / team lead: only your own assignments.
  const cands = await fetchAllRows<any>((from, to) => db.from("candidates").select(CAND_FIELDS).eq("point_person_id", profile.id).order("name").range(from, to));
  const ownerNames = new Map<string, string>([[profile.id, profile.full_name]]);
  return [
    { key: "mine", label: "My candidates", description: "Candidates you're the point person for", endpoint: "candidates", recipients: cands.map((c) => candidateToComposer(c, schools, ownerNames)) },
  ];
}

// The viewer's recent campaigns with aggregate counts — so they can click away
// and come back to check how a send went (sent / failed / replied / bounced).
export async function loadRecentCampaigns(profile: Profile, limit = 25): Promise<CampaignHistoryItem[]> {
  const db = createServiceClient();
  const { data: camps } = await db.from("outreach_campaigns")
    .select("id, name, status, created_at, total_count")
    .eq("created_by", profile.id).order("created_at", { ascending: false }).limit(limit);
  if (!camps?.length) return [];
  const ids = camps.map((c: any) => c.id);
  const sends = await fetchAllRows<any>((from, to) => db.from("outreach_sends").select("campaign_id, status, replied_at, bounced_at").in("campaign_id", ids).range(from, to));
  const agg = new Map<string, { sent: number; failed: number; pending: number; skipped: number; replied: number; bounced: number }>();
  for (const id of ids) agg.set(id, { sent: 0, failed: 0, pending: 0, skipped: 0, replied: 0, bounced: 0 });
  for (const s of sends) {
    const a = agg.get(s.campaign_id); if (!a) continue;
    if (s.status === "sent") a.sent++;
    else if (s.status === "failed") a.failed++;
    else if (s.status === "queued") a.pending++;
    else if (s.status === "skipped_dnc" || s.status === "skipped_quota") a.skipped++;
    if (s.replied_at) a.replied++;
    if (s.bounced_at) a.bounced++;
  }
  return camps.map((c: any) => ({ id: c.id, name: c.name, status: c.status, createdAt: c.created_at, total: c.total_count, ...agg.get(c.id)! }));
}
