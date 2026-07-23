// Merge-token rendering for real-candidate outreach (Phase 4). Pure + no server
// imports, so the composer can use it for live previews and the send route can
// use it authoritatively. Substitution is plain string replacement — no AI, no
// LLM. Unknown tokens are surfaced (findUnsupportedOutreachVariables) so a typo
// fails loudly at preview instead of shipping "{{frist_name}}" to a candidate.

export const OUTREACH_MERGE_VARIABLES = [
  "{{first_name}}", "{{last_name}}", "{{full_name}}",
  "{{school}}", "{{stage}}", "{{class_year}}", "{{point_person}}",
] as const;

const SUPPORTED = new Set(OUTREACH_MERGE_VARIABLES.map((v) => v.slice(2, -2)));

// Any {{token}} whose key isn't supported, plus a catch for a stray unmatched
// "{{" / "}}" (a malformed variable). Mirrors the demo's detector.
export function findUnsupportedOutreachVariables(template: string): string[] {
  const found = template.match(/\{\{[^{}]*\}\}/g) ?? [];
  const unsupported = found.filter((v) => !SUPPORTED.has(v.slice(2, -2).trim().toLowerCase()));
  if (/\{\{|\}\}/.test(template.replace(/\{\{[^{}]*\}\}/g, ""))) unsupported.push("Malformed merge variable");
  return [...new Set(unsupported)];
}

export type OutreachTokens = {
  first_name: string; last_name: string; full_name: string;
  school: string; stage: string; class_year: string; point_person: string;
};

// One recipient as the composer renders it: display fields + a precomputed token
// set so the client preview matches the server's send exactly. Client-safe.
export type ComposerRecipient = {
  id: string; name: string; email: string | null;
  school: string; stage: string; classYear: string; area: string | null;
  doNotContact: boolean; tokens: OutreachTokens;
};

// A selectable group. endpoint routes the send: "candidates" (assignment-scoped)
// or "team" (admin-only whole-team).
export type OutreachAudience = {
  key: "mine" | "all" | "team";
  label: string; description: string;
  endpoint: "candidates" | "team";
  recipients: ComposerRecipient[];
};

// A past/in-progress campaign, for the history panel you can return to after
// clicking away. Counts are aggregated from its send rows.
export type CampaignHistoryItem = {
  id: string; name: string; status: string; createdAt: string; total: number;
  sent: number; failed: number; pending: number; skipped: number; replied: number; bounced: number;
};

export function renderOutreachTemplate(template: string, tokens: OutreachTokens): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = (tokens as Record<string, string>)[key.toLowerCase()];
    return value !== undefined ? value : match;
  });
}

// Effective send rate: 1.5s spacing + Gmail latency, ~50s per drain pass, once
// a minute. Used only for the "about X minutes" ETA shown in the composer.
export const ESTIMATED_SENDS_PER_MINUTE = 30;
export function sendEtaLabel(count: number): string {
  if (count <= 0) return "—";
  const minutes = Math.ceil(count / ESTIMATED_SENDS_PER_MINUTE);
  return minutes <= 1 ? "about a minute" : `about ${minutes} minutes`;
}

// A candidate's name is one column; split on the first space for first/last.
export function splitName(name: string | null | undefined): { first: string; last: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// grad_date is free text from a JazzHR questionnaire ("May 2027", "2026-05-15",
// "Spring '27"). Pull the first plausible 4-digit year; fall back to the raw
// string so we never render an empty class year when something is there.
export function parseClassYear(gradDate: string | null | undefined): string {
  const raw = (gradDate ?? "").trim();
  if (!raw) return "";
  const m = raw.match(/\b(20\d{2})\b/);
  return m ? m[1] : raw;
}

// Build the token set from a candidate's resolved fields. school/pointPerson are
// resolved by the caller (school needs the schools table for the specific-label
// logic; point person needs a profile lookup) so this stays pure + testable.
export function candidateOutreachTokens(input: {
  name: string | null; stage: string | null; gradDate: string | null;
  school: string; pointPerson: string;
}): OutreachTokens {
  const { first, last } = splitName(input.name);
  return {
    first_name: first,
    last_name: last,
    full_name: (input.name ?? "").trim(),
    school: input.school,
    stage: input.stage ?? "",
    class_year: parseClassYear(input.gradDate),
    point_person: input.pointPerson,
  };
}
