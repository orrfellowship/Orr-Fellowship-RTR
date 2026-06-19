// Types mirroring the Supabase schema (migration 0001).
// Kept hand-written for now; can be replaced by `supabase gen types` later.

export type AppRole = "super_admin" | "admin" | "team_lead" | "fellow";
export type SchoolTier = "core" | "satellite" | "bonus";
export type CandidateSource = "jazzhr" | "user_created";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: AppRole;
  school_id: string | null;
  is_active: boolean;
}

export interface School {
  id: string;
  name: string;
  tier: SchoolTier;
  logo_url: string | null;
  color_primary: string | null;
}

export interface Candidate {
  id: string;
  jazz_id: string | null;
  school_id: string | null;
  name: string;
  email: string | null;
  stage: string | null;
  university_raw: string | null;
  job_title: string | null;
  linkedin: string | null;
  resume_link: string | null;
  gpa: string | null;
  area_of_study: string | null;
  point_person_id: string | null;
  source: CandidateSource;
  not_interested: boolean;
}

// ---- role capability helpers (mirror the RLS, for UI gating) ----
export const isAdminPlus = (r: AppRole) => r === "admin" || r === "super_admin";
export const isSuper = (r: AppRole) => r === "super_admin";
export const canEditPlaybook = (r: AppRole) => isAdminPlus(r) || r === "team_lead";
export const canReassign = (r: AppRole) => isAdminPlus(r) || r === "team_lead";
export const canManageResources = (r: AppRole) => isAdminPlus(r);
export const canReviewMatches = (r: AppRole) => isAdminPlus(r);
export const canEditEvents = (r: AppRole) => canEditPlaybook(r);

export interface Resource {
  id: string;
  name: string;
  description: string | null;
  link: string | null;
  created_by: string | null;
  created_at: string | null;
}
