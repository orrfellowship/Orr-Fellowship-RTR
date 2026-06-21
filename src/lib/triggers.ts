import { phaseOf } from "@/lib/stages";

// Single source of truth for the recruiting "next move" rules. Both the on-screen
// Action Queue (Weekly Snapshot) and the email digests are derived from this, so
// what a fellow sees and what they get emailed never drift apart.

export const NO_CONTACT_DAYS = 10; // "no contact in N days" threshold
const DAY = 86_400_000;

export type TriggerKind = "applied" | "finalist" | "claim" | "next_step" | "follow_up" | "rapport";

export interface Trigger {
  kind: TriggerKind;
  type: string;   // short label shown in the queue ("Follow up", "Applied", …)
  why: string;    // one-line reason
  rank: number;   // sort order (lower = more urgent)
}

export interface TriggerCandidate {
  point_person_id: string | null;
  stage: string | null;
  not_interested: boolean;
}

// Evaluate one candidate for one viewer. `profileId` is the person whose queue
// we're building (null = no "mine" context, e.g. pure unclaimed scan).
export function evaluateCandidate(
  c: TriggerCandidate,
  ctx: { profileId: string | null; lastContactISO?: string | null; now: number },
): Trigger | null {
  if (c.not_interested) return null;
  const ph = phaseOf(c.stage);
  if (ph === "rejected" || ph === "moved") return null;

  const mine = !!ctx.profileId && c.point_person_id === ctx.profileId;
  const last = ctx.lastContactISO ?? null;
  const days = last ? Math.floor((ctx.now - new Date(last).getTime()) / DAY) : Infinity;

  if (ph === "applied" && mine) return { kind: "applied", type: "Applied", why: "They applied — anything needed from you?", rank: 0 };
  if (ph === "finalist" && mine) return { kind: "finalist", type: "Finalist prep", why: "Confirm logistics", rank: 1 };
  if (ph === "sourced" && !c.point_person_id) return { kind: "claim", type: "Claim", why: "New & unclaimed", rank: 4 };
  if (mine && (ph === "sourced" || ph === "contacted")) {
    if (!last) return { kind: "next_step", type: "Next step", why: "You claimed them — log your first outreach", rank: 3 };
    if (days >= NO_CONTACT_DAYS) return { kind: "follow_up", type: "Follow up", why: `No contact in ${days} days`, rank: 2 };
    if (days >= 3) return { kind: "rapport", type: "Rapport", why: "Warm now — quick intro message?", rank: 3 };
  }
  return null;
}

// Kinds that warrant a daily email digest to the candidate's owner. All of these
// require an owner (`mine`); `claim` (unclaimed) is intentionally excluded, so a
// digest item always has a recipient.
export const DIGEST_KINDS: TriggerKind[] = ["applied", "follow_up", "finalist", "next_step", "rapport"];
