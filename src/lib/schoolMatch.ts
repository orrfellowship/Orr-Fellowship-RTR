import { createServiceClient } from "@/lib/supabase/server";
import { getSchoolById } from "@/lib/auth";
import { isAdminPlus, type Profile } from "@/lib/types";

// Server-side face of the phase20 school matcher (public.match_school).
// Raw school text entered at intake is matched against the alias table scoped
// to the entrant's group; anything that can't be auto-assigned lands in
// school_match_review instead of silently defaulting to the Bonus group.

export type SchoolMatchMethod = "alias" | "fuzzy" | "unresolved" | "tripwire";

export type SchoolMatch = {
  matched_school_id: string | null;   // non-null only when auto-assigned
  method: SchoolMatchMethod;
  suggestion_school_id: string | null; // best in-group candidate (review pre-select)
  suggestion_score: number | null;
  cross_school_id: string | null;      // tripwire: strong match in another group
  cross_score: number | null;
};

const UNRESOLVED: SchoolMatch = {
  matched_school_id: null, method: "unresolved",
  suggestion_school_id: null, suggestion_score: null,
  cross_school_id: null, cross_score: null,
};

// The entrant's group for scoped matching: fellows/leads match within their
// school's tier ("Feeder" == tier 'core'); admins are unscoped (null) since
// they enter candidates for every group.
export async function entrantTierFor(profile: Profile): Promise<string | null> {
  if (isAdminPlus(profile.role)) return null;
  const school = await getSchoolById(profile.school_id);
  return school?.tier ?? null;
}

export async function matchSchool(raw: string, entrantTier: string | null): Promise<SchoolMatch> {
  const { data, error } = await createServiceClient()
    .rpc("match_school", { p_raw: raw, p_entrant_tier: entrantTier });
  const row = (data as any[] | null)?.[0];
  if (error || !row) return UNRESOLVED; // tolerate a missing/failed RPC: goes to review
  return row as SchoolMatch;
}

// "Satellite School" / "Bonus School" are deliberate GROUP picks (the import
// datalist offers them), not school names — they bypass matching and land on
// the tier's representative row, mirroring resolveCandidateSchool.
export function groupPhraseTier(raw: string): "satellite" | "bonus" | null {
  const t = raw.trim().toLowerCase();
  if (t === "satellite" || t === "satellite school" || t === "satellite schools") return "satellite";
  if (t === "bonus" || t === "bonus school" || t === "bonus schools") return "bonus";
  return null;
}

// Pending review rows with the candidate's name, for the console review panel.
// Callers gate on admin+ before using this (service-role read).
export type PendingSchoolReview = {
  id: string; candidate_id: string; candidate_name: string;
  raw_input: string; entrant_tier: string | null;
  suggested_school_id: string | null; suggested_score: number | null;
  cross_school_id: string | null; cross_score: number | null;
  reason: "unresolved" | "tripwire"; created_at: string;
};

export async function listPendingSchoolReviews(): Promise<PendingSchoolReview[]> {
  const { data } = await createServiceClient()
    .from("school_match_review")
    .select("id, candidate_id, raw_input, entrant_tier, suggested_school_id, suggested_score, cross_school_id, cross_score, reason, created_at, candidate:candidates(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return (data ?? []).map((r: any) => ({
    id: r.id, candidate_id: r.candidate_id, candidate_name: r.candidate?.name ?? "—",
    raw_input: r.raw_input, entrant_tier: r.entrant_tier,
    suggested_school_id: r.suggested_school_id, suggested_score: r.suggested_score,
    cross_school_id: r.cross_school_id, cross_score: r.cross_score,
    reason: r.reason, created_at: r.created_at,
  }));
}

// Shape of a pending review row for insertion (candidate_id added by caller).
export function reviewFieldsFor(raw: string, entrantTier: string | null, m: SchoolMatch) {
  return {
    raw_input: raw,
    entrant_tier: entrantTier,
    suggested_school_id: m.suggestion_school_id,
    suggested_score: m.suggestion_score,
    cross_school_id: m.cross_school_id,
    cross_score: m.cross_score,
    reason: (m.method === "tripwire" ? "tripwire" : "unresolved") as "tripwire" | "unresolved",
  };
}
