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

export type ValidatedOutreachInput = {
  campaignName: string; subject: string; body: string; ids: string[];
  idempotencyKey: string; templateId: string | null;
  replacements: Record<string, string>;
};

// Live sending is enabled for every app role. Fellows and team leads remain
// scoped to assigned candidates and admin-authored templates below.
export function candidateOutreachSendingEnabled(role: AppRole): boolean {
  return isAdminPlus(role) || role === "fellow" || role === "team_lead";
}

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
  // Optional template reference; the routes resolve + enforce it per role.
  let templateId: string | null = null;
  if (v.templateId != null) {
    if (typeof v.templateId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.templateId)) {
      bad("invalid_template", "The selected template reference is invalid.");
    }
    templateId = v.templateId as string;
  }
  // Optional [placeholder] → value map for fellow "fill in the blanks" sends.
  // Shape-checked here; the exact key set + content rules are enforced when the
  // template is re-materialized server-side (materializeTemplateBundle).
  const replacements: Record<string, string> = {};
  if (v.replacements != null) {
    if (typeof v.replacements !== "object" || Array.isArray(v.replacements)) bad("invalid_replacement", "Template values are invalid.");
    const entries = Object.entries(v.replacements as Record<string, unknown>);
    if (entries.length > 50) bad("invalid_replacement", "Too many template values.");
    for (const [k, val] of entries) {
      if (typeof val !== "string" || k.length > 200 || val.length > 5000) bad("invalid_replacement", "Template values are invalid.");
      replacements[k] = val as string;
    }
  }
  return { campaignName, subject, body, ids: list as string[], idempotencyKey, templateId, replacements };
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
  templateId?: string | null;
  attachments?: import("./outreach-templates.server").CampaignAttachment[];
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
    templateId: input.templateId ?? null, attachments: input.attachments ?? [],
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
// Fellow-cohort audiences — email the RTR users themselves, not candidates.
// ADMIN/SUPER ONLY (e.g. a note to first- or second-year fellows). These
// recipients aren't candidates, so per-candidate rules (do_not_contact, 2/week)
// don't apply — candidate_id is null and only the 300/sender/day cap governs.
// ---------------------------------------------------------------------------

export type OutreachUser = {
  id: string;
  fullName: string | null;
  email: string | null;
  role?: AppRole | null;
  fellowshipYear?: 1 | 2 | null;
};

// Duplicate active profiles should never produce duplicate cohort recipients.
// Prefer the team-lead row when the same person has both fellow + team-lead
// profiles, then de-duplicate any remaining repeated email.
export function dedupeOutreachUsers<T extends OutreachUser>(users: T[]): T[] {
  const byName = new Map<string, T>();
  for (const user of users) {
    if (!user.email?.trim()) continue;
    const nameKey = (user.fullName ?? "").trim().toLowerCase();
    const key = nameKey || `id:${user.id}`;
    const current = byName.get(key);
    if (!current || (user.role === "team_lead" && current.role !== "team_lead")) byName.set(key, user);
  }
  const emails = new Set<string>();
  return Array.from(byName.values()).filter((user) => {
    const email = user.email!.trim().toLowerCase();
    if (emails.has(email)) return false;
    emails.add(email);
    return true;
  });
}

export function splitFellowCohorts<T extends OutreachUser>(users: T[]): { firstYears: T[]; secondYears: T[] } {
  const eligible = dedupeOutreachUsers(users).filter((user) =>
    (user.role === "fellow" || user.role === "team_lead")
    && (user.fellowshipYear === 1 || user.fellowshipYear === 2),
  );
  return {
    firstYears: eligible.filter((user) => user.fellowshipYear === 1),
    secondYears: eligible.filter((user) => user.fellowshipYear === 2),
  };
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
  selectedUserIds?: string[]; // omit/empty → every classified active fellow
  idempotencyKey?: string | null;
  templateId?: string | null;
  attachments?: import("./outreach-templates.server").CampaignAttachment[];
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
  // Emailing fellow cohorts is an admin/super power — never a fellow's.
  if (!isAdminPlus(role)) return { forbidden: true, campaignId: "", queued: 0, skippedDnc: 0, skippedQuota: 0, invalid: 0, replayed: false };
  const loadUsers = deps.loadUsers ?? defaultLoadUsers;
  const enqueue = deps.enqueue ?? enqueueOutreachCampaign;

  const ids = input.selectedUserIds?.length ? input.selectedUserIds : null;
  const users = await loadUsers(ids);
  const recipients = buildUserRecipients(users, { subject: input.subject, body: input.body });
  return enqueue(senderUserId, {
    campaignName: input.campaignName, subject: input.subject, body: input.body,
    recipients, idempotencyKey: input.idempotencyKey,
    templateId: input.templateId ?? null, attachments: input.attachments ?? [],
  });
}

async function defaultLoadUsers(ids: string[] | null): Promise<OutreachUser[]> {
  const db = createServiceClient();
  let q = db.from("profiles")
    .select("id, full_name, email, role, fellowship_year")
    .eq("is_active", true)
    .in("role", ["fellow", "team_lead"])
    .not("fellowship_year", "is", null)
    .not("email", "is", null);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to load fellow recipients: ${error.message}`);
  const cohorts = splitFellowCohorts((data ?? []).map((p: any) => ({
    id: p.id,
    fullName: p.full_name,
    email: p.email,
    role: p.role,
    fellowshipYear: p.fellowship_year,
  })));
  return [...cohorts.firstYears, ...cohorts.secondYears];
}

// ---------------------------------------------------------------------------
// Audience loading for the composer. Fellows/leads see one audience — their own
// assigned candidates. Admins/supers see all candidates + separate first- and
// second-year fellow audiences. Each recipient carries a precomputed token set
// so the client
// preview matches the server's send.
// ---------------------------------------------------------------------------

function candidateToComposer(row: any, schools: any[], ownerNames: Map<string, string>, favoriteIds: Set<string>): ComposerRecipient {
  const d = candidateSchoolDisplay(row, schools);
  const school = d.specificLabel ?? d.label;
  const pointPerson = (row.point_person_id && ownerNames.get(row.point_person_id)) || "your Orr contact";
  const tokens = candidateOutreachTokens({ name: row.name, stage: row.stage, gradDate: row.grad_date, school, pointPerson });
  return {
    id: row.id, name: (row.name ?? "").trim(), email: row.email, school,
    stage: row.stage ?? "", classYear: tokens.class_year, area: row.area_of_study ?? null,
    doNotContact: !!row.do_not_contact, isFavorite: favoriteIds.has(row.id), tokens,
  };
}

function userToComposer(u: OutreachUser): ComposerRecipient {
  const tokens = candidateOutreachTokens({ name: u.fullName, stage: "", gradDate: "", school: "", pointPerson: "" });
  const yearLabel = u.fellowshipYear === 1 ? "First-year fellow" : "Second-year fellow";
  return { id: u.id, name: (u.fullName ?? "").trim(), email: u.email, school: "", stage: yearLabel, classYear: "", area: u.role ?? null, doNotContact: false, isFavorite: false, tokens };
}

// The current user's favorited candidate ids — drives the "★ Favorites" filter
// in the composer (favorites are per-user).
async function loadFavoriteCandidateIds(userId: string): Promise<Set<string>> {
  const { data } = await createServiceClient().from("favorites").select("candidate_id").eq("user_id", userId);
  return new Set((data ?? []).map((r: any) => r.candidate_id));
}

const CAND_FIELDS = "id, name, email, stage, grad_date, school_id, university_raw, point_person_id, do_not_contact, area_of_study";

export async function loadOutreachAudiences(profile: Profile): Promise<OutreachAudience[]> {
  const db = createServiceClient();
  const schools = (await getSchoolsCached()) as any[];

  const favoriteIds = await loadFavoriteCandidateIds(profile.id);

  if (isAdminPlus(profile.role)) {
    const cands = await fetchAllRows<any>((from, to) => db.from("candidates").select(CAND_FIELDS).order("name").range(from, to));
    const ownerIds = Array.from(new Set(cands.map((c) => c.point_person_id).filter((v): v is string => !!v)));
    const ownerNames = ownerIds.length ? await defaultLoadProfileNames(ownerIds) : new Map<string, string>();
    const { data: userRows, error: usersError } = await db.from("profiles")
      .select("id, full_name, email, role, fellowship_year")
      .eq("is_active", true)
      .in("role", ["fellow", "team_lead"])
      .not("fellowship_year", "is", null)
      .not("email", "is", null)
      .order("full_name");
    if (usersError) throw new Error(`Failed to load fellow audiences: ${usersError.message}`);
    const { firstYears, secondYears } = splitFellowCohorts((userRows ?? []).map((p: any) => ({
      id: p.id,
      fullName: p.full_name,
      email: p.email,
      role: p.role,
      fellowshipYear: p.fellowship_year,
    })));
    return [
      { key: "all", label: "All candidates", description: "Every candidate in the pipeline", endpoint: "candidates", recipients: cands.map((c) => candidateToComposer(c, schools, ownerNames, favoriteIds)) },
      { key: "first_year_fellows", label: "First-year fellows", description: "Active first-year fellows and team leads", endpoint: "team", recipients: firstYears.map(userToComposer) },
      { key: "second_year_fellows", label: "Second-year fellows", description: "Active second-year fellows and team leads", endpoint: "team", recipients: secondYears.map(userToComposer) },
    ];
  }

  // Fellow / team lead: only your own assignments.
  const cands = await fetchAllRows<any>((from, to) => db.from("candidates").select(CAND_FIELDS).eq("point_person_id", profile.id).order("name").range(from, to));
  const ownerNames = new Map<string, string>([[profile.id, profile.full_name]]);
  return [
    { key: "mine", label: "My candidates", description: "Candidates you're the point person for", endpoint: "candidates", recipients: cands.map((c) => candidateToComposer(c, schools, ownerNames, favoriteIds)) },
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
