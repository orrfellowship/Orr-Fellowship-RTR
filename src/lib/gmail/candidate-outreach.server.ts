import { createServiceClient } from "@/lib/supabase/server";
import { getSchoolsCached } from "@/lib/queries";
import { candidateSchoolDisplay } from "@/lib/candidateSchool";
import { isAdminPlus, type AppRole } from "@/lib/types";
import { candidateOutreachTokens, renderOutreachTemplate } from "./candidate-tokens";
import { enqueueOutreachCampaign, type EnqueueRecipient, type EnqueueResult } from "./outreach-queue.server";

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
  const { data } = await q;
  return (data ?? []).map((p: any) => ({ id: p.id, fullName: p.full_name, email: p.email }));
}
