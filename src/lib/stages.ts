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
  { school_name: "IU", match: ["indiana university bloomington", "indiana university indianapolis", "indiana university south bend", "indiana university east", "indiana university", "iu bloomington", "iu indianapolis", "iu south bend", "iu east", "iu kokomo", "iu northwest", "iu southeast", "iu columbus", "iu fort wayne", "iu online", "iub", "iui", "iu"] },
  { school_name: "Ball State", match: ["ball state university", "ball state"] },
  { school_name: "Indiana State", match: ["indiana state university", "indiana state", "isu terre haute"] },
  { school_name: "USI", match: ["university of southern indiana", "usi", "southern indiana"] },
  { school_name: "UIndy", match: ["university of indianapolis", "uindy"] },
  { school_name: "University of Cincinnati", match: ["university of cincinnati", "cincinnati university", "cincinnati"] },
  { school_name: "Xavier", match: ["xavier university", "xavier"] },
  { school_name: "Dayton", match: ["university of dayton", "dayton"] },
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
  { school_name: "Wash U (St Louis)", match: ["washington university in saint louis", "washington university saint louis", "wash u saint louis", "wash u st louis", "washu", "wash u"] },
  { school_name: "St. Louis University", match: ["saint louis university", "st louis university", "slu"] },
  { school_name: "Huntington", match: ["huntington university", "huntington"] },
  { school_name: "Bethel", match: ["bethel university", "bethel college", "bethel"] },
  { school_name: "Grace College", match: ["grace college", "grace"] },
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

// Short single-word abbreviations ("iu", "usi", "slu") must match as a whole
// word — plain substring matching would fire inside unrelated words (e.g. the
// "usi" in "business"). Longer or multi-word terms keep substring matching.
function termMatches(u: string, term: string): boolean {
  if (term.length <= 4 && !term.includes(" ")) return new RegExp(`\\b${term}\\b`).test(u);
  return u.includes(term);
}

// Returns the seeded school NAME this university routes to, or null (unrouted).
export function routeToSchoolName(university: string | null): string | null {
  if (!university) return null;
  const u = normalizeUniversity(university);
  for (const entry of SCHOOL_MATCH) {
    if (entry.match.some((m) => termMatches(u, m))) return entry.school_name;
  }
  return null;
}

// ----------------------------------------------------------------------------
// EMAIL → SCHOOL ROUTING — used as a fallback when a candidate is entered with
// a `.edu` address but no school selected. domains[] are the school's email
// domains (lowercase); a candidate matches if their address's domain equals one
// of them or is a subdomain of it (e.g. "umail.iu.edu" → "iu.edu"). school_name
// values map to the same seeded `schools.name` rows as SCHOOL_MATCH above.
// ----------------------------------------------------------------------------
interface SchoolEmailMatch { school_name: string; domains: string[]; }

export const SCHOOL_EMAIL_DOMAINS: SchoolEmailMatch[] = [
  { school_name: "Purdue", domains: ["purdue.edu", "pfw.edu"] },
  { school_name: "IU", domains: ["iu.edu", "indiana.edu", "iupui.edu"] },
  { school_name: "Ball State", domains: ["bsu.edu"] },
  { school_name: "Indiana State", domains: ["indstate.edu", "sycamores.indstate.edu"] },
  { school_name: "USI", domains: ["usi.edu", "eagles.usi.edu"] },
  { school_name: "UIndy", domains: ["uindy.edu"] },
  { school_name: "University of Cincinnati", domains: ["uc.edu", "mail.uc.edu"] },
  { school_name: "Xavier", domains: ["xavier.edu"] },
  { school_name: "Dayton", domains: ["udayton.edu"] },
  { school_name: "Ivy Tech", domains: ["ivytech.edu"] },
  { school_name: "Butler", domains: ["butler.edu"] },
  { school_name: "Marian", domains: ["marian.edu"] },
  { school_name: "Wabash", domains: ["wabash.edu"] },
  { school_name: "DePauw", domains: ["depauw.edu"] },
  { school_name: "Hanover", domains: ["hanover.edu"] },
  { school_name: "Franklin", domains: ["franklincollege.edu"] },
  { school_name: "Earlham", domains: ["earlham.edu"] },
  { school_name: "Manchester U", domains: ["manchester.edu"] },
  { school_name: "Anderson", domains: ["anderson.edu"] },
  { school_name: "Taylor", domains: ["taylor.edu"] },
  { school_name: "Rose-Hulman", domains: ["rose-hulman.edu"] },
  { school_name: "Valparaiso", domains: ["valpo.edu"] },
  { school_name: "Notre Dame & Saint Marys", domains: ["nd.edu", "saintmarys.edu"] },
  { school_name: "Miami of Ohio", domains: ["miamioh.edu"] },
  { school_name: "Trine", domains: ["trine.edu"] },
  { school_name: "Denison", domains: ["denison.edu"] },
  { school_name: "Wash U (St Louis)", domains: ["wustl.edu"] },
  { school_name: "St. Louis University", domains: ["slu.edu"] },
  { school_name: "Huntington", domains: ["huntington.edu"] },
  { school_name: "Bethel", domains: ["betheluniversity.edu"] },
  { school_name: "Grace College", domains: ["grace.edu"] },
  { school_name: "IWU", domains: ["indwes.edu"] },
];

// Returns the seeded school NAME an email's domain routes to, or null. Personal
// addresses (gmail/outlook/etc.) and any unrecognized domain return null.
export function routeToSchoolNameByEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;
  for (const entry of SCHOOL_EMAIL_DOMAINS) {
    if (entry.domains.some((d) => domain === d || domain.endsWith("." + d))) return entry.school_name;
  }
  return null;
}

export type SchoolLite = { id: string; name: string; tier?: string | null };

// Resolve a typed/selected school name to a school_id for candidate entry.
// Core matches map to that school. Satellite/Bonus matches map to the tier's
// representative row and keep the typed school in university_raw, so ownership is
// grouped first while the person's actual school still displays second.
export function resolveCandidateSchool(
  typed: string,
  schools: SchoolLite[],
): { school_id: string | null; university_raw: string | null } {
  const t = (typed ?? "").trim();
  if (!t) return { school_id: null, university_raw: null };
  const lc = t.toLowerCase();
  const isGrouped = (s: SchoolLite) => s.tier === "satellite" || s.tier === "bonus";
  const firstByTier = (tier: string) => schools.filter((s) => s.tier === tier).sort((a, b) => a.name.localeCompare(b.name))[0];

  if (lc === "satellite" || lc === "satellite school" || lc === "satellite schools") {
    return { school_id: firstByTier("satellite")?.id ?? null, university_raw: null };
  }
  if (lc === "bonus" || lc === "bonus school" || lc === "bonus schools") {
    return { school_id: firstByTier("bonus")?.id ?? null, university_raw: null };
  }

  const exact = schools.find((s) => s.name.toLowerCase() === lc);
  if (exact?.tier === "core") return { school_id: exact.id, university_raw: null };
  if (exact?.tier === "satellite" || exact?.tier === "bonus") return { school_id: firstByTier(exact.tier)?.id ?? exact.id, university_raw: t };
  if (!exact) {
    const routed = routeToSchoolName(t);
    if (routed) {
      const rs = schools.find((s) => s.name.toLowerCase() === routed.toLowerCase());
      if (rs?.tier === "core") return { school_id: rs.id, university_raw: null };
      if (rs?.tier === "satellite" || rs?.tier === "bonus") return { school_id: firstByTier(rs.tier)?.id ?? rs.id, university_raw: t };
    }
  }
  // Not Core (or unknown) → Bonus group; keep what they typed.
  const bonus = firstByTier("bonus");
  return { school_id: bonus?.id ?? null, university_raw: t };
}
