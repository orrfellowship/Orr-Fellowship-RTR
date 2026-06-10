// ============================================================================
// STAGE CONFIG + SCHOOL ROUTING — single source of truth
// Ported from the Base44 build. Stages, phases, and order match JazzHR's
// applicant_progress values exactly. routeToSchool uses ONLY seeded schools;
// everything else is intentionally left unrouted (school_id = null).
// ============================================================================

export type Phase =
  | "sourced" | "contacted" | "applied" | "advanced"
  | "finalist" | "fellow" | "moved" | "rejected";

export interface StageDef { key: string; phase: Phase; order: number; }

// All 28 stages. `key` is the lowercased applicant_progress string from JazzHR.
export const STAGE_CONFIG: StageDef[] = [
  { key: "new", phase: "sourced", order: 0 },
  { key: "maybe", phase: "sourced", order: 1 },
  { key: "left message", phase: "contacted", order: 2 },
  { key: "passed first stage", phase: "contacted", order: 3 },
  { key: "school top pick", phase: "contacted", order: 4 },
  { key: "applied to both", phase: "applied", order: 5 },
  { key: "invite to bmi", phase: "advanced", order: 6 },
  { key: "invite to oni indy", phase: "advanced", order: 7 },
  { key: "move to rotr?", phase: "advanced", order: 8 },
  { key: "rotr, applied to both", phase: "advanced", order: 8 },
  { key: "rotc", phase: "advanced", order: 9 },
  { key: "reapplied", phase: "advanced", order: 10 },
  { key: "reapplication evansville", phase: "advanced", order: 10 },
  { key: "resume book", phase: "advanced", order: 11 },
  { key: "3.5", phase: "advanced", order: 12 },
  { key: "finalist day invite", phase: "finalist", order: 13 },
  { key: "finalist day waitlist", phase: "finalist", order: 14 },
  { key: "fellow", phase: "fellow", order: 15 },
  { key: "moved to evansville", phase: "moved", order: 16 },
  { key: "picked indy over evansville", phase: "moved", order: 16 },
  { key: "picked evansville over indy", phase: "moved", order: 16 },
  { key: "post application rejection", phase: "rejected", order: 20 },
  { key: "post bmi rejection", phase: "rejected", order: 21 },
  { key: "finalist day rejection", phase: "rejected", order: 22 },
  { key: "not interested rejection", phase: "rejected", order: 23 },
  { key: "auto rejection", phase: "rejected", order: 24 },
  { key: "pre rotc backout", phase: "rejected", order: 25 },
  { key: "backed out", phase: "rejected", order: 26 },
  { key: "did not reapply", phase: "rejected", order: 27 },
];

const STAGE_BY_KEY = new Map(STAGE_CONFIG.map((s) => [s.key, s]));
export const stageDef = (key: string | null): StageDef | null =>
  key ? STAGE_BY_KEY.get(key.toLowerCase().trim()) ?? null : null;

export const phaseOf = (key: string | null): Phase | null => stageDef(key)?.phase ?? null;

// Terminal phases — candidate is out of the active pipeline.
export const TERMINAL: Phase[] = ["moved", "rejected"];
export const isActive = (key: string | null): boolean => {
  const p = phaseOf(key);
  return p != null && !TERMINAL.includes(p);
};

// "Most advanced stage wins" across a candidate's jobs. Highest order wins;
// ties broken deterministically by the stage key (stable, not random).
// Falls back to the raw lowercased value when no STAGE_CONFIG key matches,
// so unknown JazzHR stages are shown in the UI rather than disappearing.
export function mostAdvancedStage(progressValues: string[]): string | null {
  let best: StageDef | null = null;
  let firstRaw: string | null = null;
  for (const raw of progressValues) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (!firstRaw) firstRaw = trimmed.toLowerCase();
    const d = stageDef(trimmed);
    if (!d) continue;
    if (
      best === null ||
      d.order > best.order ||
      (d.order === best.order && d.key < best.key)
    ) {
      best = d;
    }
  }
  return best?.key ?? firstRaw;
}

// ----------------------------------------------------------------------------
// SCHOOL ROUTING — seeded schools only. school_name must match the DB `name`.
// Each entry's match[] is lowercase substrings; first match (in this order) wins.
// Out-of-state / unmatched universities intentionally return null (unrouted).
// ----------------------------------------------------------------------------
interface SchoolMatch { school_name: string; match: string[]; }

// NB: school_name values map to the seeded `schools.name` rows.
export const SCHOOL_MATCH: SchoolMatch[] = [
  { school_name: "Purdue", match: ["purdue university indianapolis", "purdue university fort wayne", "purdue university", "purdue fort wayne", "purdue", "iupui", "pui"] },
  { school_name: "IU", match: ["indiana university bloomington", "indiana university indianapolis", "indiana university south bend", "indiana university east", "indiana university", "iu bloomington", "iub", "iui"] },
  { school_name: "Ball State", match: ["ball state university", "ball state"] },
  { school_name: "Indiana State", match: ["indiana state university", "indiana state", "isu terre haute"] },
  { school_name: "USI", match: ["university of southern indiana", "usi", "southern indiana"] },
  { school_name: "UIndy", match: ["university of indianapolis", "uindy"] },
  { school_name: "Ivy Tech", match: ["ivy tech community college", "ivy tech"] },
  { school_name: "Butler", match: ["butler university", "butler"] },
  { school_name: "Marian", match: ["marian university", "marian"] },
  { school_name: "Wabash", match: ["wabash college", "wabash"] },
  { school_name: "DePauw", match: ["depauw university", "depauw"] },
  { school_name: "Hanover", match: ["hanover college", "hanover"] },
  { school_name: "Franklin", match: ["franklin college of indiana", "franklin college"] },
  { school_name: "Earlham", match: ["earlham college", "earlham"] },
  { school_name: "Manchester U", match: ["manchester university", "manchester college"] },
  { school_name: "Anderson", match: ["anderson university indiana", "anderson university"] },
  { school_name: "Taylor", match: ["taylor university", "taylor"] },
  { school_name: "Rose-Hulman", match: ["rose-hulman institute", "rose-hulman", "rose hulman"] },
  { school_name: "Valparaiso", match: ["valparaiso university", "valparaiso", "valpo"] },
  { school_name: "Notre Dame & Saint Marys", match: ["university of notre dame", "notre dame", "saint mary"] },
  { school_name: "Miami of Ohio", match: ["miami university ohio", "miami university", "miami oh", "miami (ohio)"] },
  { school_name: "Trine", match: ["trine university", "trine"] },
  { school_name: "Denison", match: ["denison university", "denison"] },
  { school_name: "IWU", match: ["indiana wesleyan university", "indiana wesleyan", "iwu"] },
];

// Normalize a raw university string before matching.
// Strips punctuation, expands common abbreviations, collapses whitespace.
function normalizeUniversity(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,\-()&]/g, " ")            // punctuation → space
    .replace(/\bft\b/g, "fort")            // Ft. Wayne → fort wayne
    .replace(/\bst\b/g, "saint")           // St. → saint (avoid matching "state")
    .replace(/\bu\b(?=\s|$)/g, "university")  // trailing "U" → university
    .replace(/\bcol\b/g, "college")
    .replace(/\binst\b/g, "institute")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns the seeded school NAME this university routes to, or null (unrouted).
export function routeToSchoolName(university: string | null): string | null {
  if (!university) return null;
  const u = normalizeUniversity(university);
  for (const entry of SCHOOL_MATCH) {
    if (entry.match.some((m) => u.includes(m))) return entry.school_name;
  }
  return null;
}
