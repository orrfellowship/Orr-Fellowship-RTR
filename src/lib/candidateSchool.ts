import { routeToSchoolName } from "@/lib/stages";

export type CandidateSchool = {
  id: string;
  name: string;
  tier?: string | null;
  color_primary?: string | null;
};

export type CandidateSchoolFields = {
  school_id: string | null;
  university_raw?: string | null;
};

export function groupLabelForTier(tier?: string | null): string | null {
  return tier === "satellite" ? "Satellite School" : tier === "bonus" ? "Bonus School" : null;
}

export function representativeSchoolId(schools: CandidateSchool[], tier: string): string | null {
  return schools
    .filter((s) => s.tier === tier)
    .sort((a, b) => a.name.localeCompare(b.name))[0]?.id ?? null;
}

export function resolveSpecificSchoolName(raw: string | null | undefined, tier: string | null | undefined, schools: CandidateSchool[]): string | null {
  const typed = (raw ?? "").trim();
  if (!typed || !tier) return null;
  const tierSchools = schools.filter((s) => s.tier === tier);
  const exact = tierSchools.find((s) => s.name.toLowerCase() === typed.toLowerCase());
  if (exact) return exact.name;
  const routed = routeToSchoolName(typed);
  const routedSchool = routed ? tierSchools.find((s) => s.name.toLowerCase() === routed.toLowerCase()) : null;
  return routedSchool?.name ?? typed;
}

export function candidateSchoolDisplay(candidate: CandidateSchoolFields, schools: CandidateSchool[]) {
  const school = candidate.school_id ? schools.find((s) => s.id === candidate.school_id) ?? null : null;
  if (!school) {
    const raw = (candidate.university_raw ?? "").trim();
    return {
      label: raw || "Unrouted",
      groupLabel: null as string | null,
      specificLabel: raw || null,
      school,
      isGrouped: false,
      isUnrouted: !raw,
    };
  }

  const groupLabel = groupLabelForTier(school.tier);
  if (!groupLabel) {
    return {
      label: school.name,
      groupLabel: null as string | null,
      specificLabel: null as string | null,
      school,
      isGrouped: false,
      isUnrouted: false,
    };
  }

  const specificLabel = resolveSpecificSchoolName(candidate.university_raw, school.tier, schools)
    ?? (school.id === representativeSchoolId(schools, school.tier ?? "") ? null : school.name);
  return {
    label: specificLabel ? `${groupLabel} / ${specificLabel}` : groupLabel,
    groupLabel,
    specificLabel,
    school,
    isGrouped: true,
    isUnrouted: false,
  };
}

export function candidateSchoolKey(candidate: CandidateSchoolFields, schools: CandidateSchool[]): string | null {
  if (!candidate.school_id) return null;
  const school = schools.find((s) => s.id === candidate.school_id);
  const groupLabel = groupLabelForTier(school?.tier);
  if (!school || !groupLabel) return candidate.school_id;
  const specific = resolveSpecificSchoolName(candidate.university_raw, school.tier, schools);
  if (specific) {
    const exact = schools.find((s) => s.tier === school.tier && s.name.toLowerCase() === specific.toLowerCase());
    return exact?.id ?? `raw:${school.tier}:${specific.toLowerCase()}`;
  }
  return candidate.school_id === representativeSchoolId(schools, school.tier ?? "") ? `tier:${school.tier}` : candidate.school_id;
}
