// Merge-token rendering for real-candidate outreach (Phase 4). Pure + no server
// imports, so the composer can use it for live previews and the send route can
// use it authoritatively. Substitution is plain string replacement — no AI, no
// LLM. Unknown tokens are surfaced (findUnsupportedOutreachVariables) so a typo
// fails loudly at preview instead of shipping "{{frist_name}}" to a candidate.

export const OUTREACH_MERGE_VARIABLES = [
  "{{candidate_first_name}}", "{{candidate_last_name}}", "{{candidate_full_name}}",
  "{{school}}", "{{stage}}", "{{class_year}}", "{{fellow_point_person}}",
] as const;

const LEGACY_MERGE_VARIABLES: Record<string, keyof OutreachTokens> = {
  first_name: "candidate_first_name",
  last_name: "candidate_last_name",
  full_name: "candidate_full_name",
  point_person: "fellow_point_person",
};

const SUPPORTED = new Set([
  ...OUTREACH_MERGE_VARIABLES.map((v) => v.slice(2, -2)),
  ...Object.keys(LEGACY_MERGE_VARIABLES),
]);

// Keep saved templates made before the rename working, while presenting and
// persisting the clearer names everywhere going forward.
export function normalizeOutreachMergeVariables(template: string): string {
  return template.replace(/\{\{\s*(first_name|last_name|full_name|point_person)\s*\}\}/gi, (_match, key: string) =>
    `{{${LEGACY_MERGE_VARIABLES[key.toLowerCase()]}}}`,
  );
}

// Any {{token}} whose key isn't supported, plus a catch for a stray unmatched
// "{{" / "}}" (a malformed variable). Mirrors the demo's detector.
export function findUnsupportedOutreachVariables(template: string): string[] {
  const found = template.match(/\{\{[^{}]*\}\}/g) ?? [];
  const unsupported = found.filter((v) => !SUPPORTED.has(v.slice(2, -2).trim().toLowerCase()));
  if (/\{\{|\}\}/.test(template.replace(/\{\{[^{}]*\}\}/g, ""))) unsupported.push("Malformed merge variable");
  return [...new Set(unsupported)];
}

// Single-bracket [placeholders] are things a person must replace on their own
// before sending — unlike {{merge_fields}}, they never auto-fill. The composer
// highlights them red and blocks sending until they're gone; the send path
// re-checks server-side so a modified client can't slip one through. Matches
// "[text]" on a single line (no nested brackets); {{merge}} tokens use braces
// and never match here. A "[label](url)" markdown link is NOT a placeholder —
// the trailing "(" is excluded so links don't block sends or get filled in.
export function findManualPlaceholders(template: string): string[] {
  return [...new Set(template.match(/\[[^[\]\n]+\](?!\()/g) ?? [])];
}

const MANUAL_PLACEHOLDER_RE = /\[[^[\]\n]+\](?!\()/g;
export type TemplateReplacements = Record<string, string>;
export type TemplateBundleMaterialization =
  | { ok: true; values: string[] }
  | { ok: false; reason: "replacement_keys_changed" | "unfilled_placeholder" | "invalid_replacement" };

export function templatePlaceholderKeys(...templates: string[]): string[] {
  return [...new Set(templates.flatMap(findManualPlaceholders))];
}

// Used while composing: filled prompts are rendered into the locked template;
// unfilled prompts remain visible and continue to block Preview.
export function previewTemplateMaterialization(
  template: string,
  replacements: TemplateReplacements,
): string {
  return normalizeOutreachMergeVariables(template).replace(MANUAL_PLACEHOLDER_RE, (placeholder) => {
    const replacement = replacements[placeholder];
    return typeof replacement === "string" && replacement.trim() ? replacement : placeholder;
  });
}

// Strict server/client contract. The request carries only values for the exact
// placeholder keys in the stored admin template. The final subject/body are
// reconstructed from that template, never trusted from browser-composed text.
export function materializeTemplateBundle(
  templates: string[],
  replacements: TemplateReplacements,
): TemplateBundleMaterialization {
  const expected = templatePlaceholderKeys(...templates);
  const expectedSorted = [...expected].sort();
  const actual = Object.keys(replacements).sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expectedSorted[index])
  ) {
    return { ok: false, reason: "replacement_keys_changed" };
  }
  for (const placeholder of expected) {
    const value = replacements[placeholder];
    if (
      typeof value !== "string"
      || !value.trim()
      || findManualPlaceholders(value).length > 0
    ) {
      return { ok: false, reason: "unfilled_placeholder" };
    }
    if (
      value.length > 5_000
      || /\{\{|\}\}/.test(value)
    ) {
      return { ok: false, reason: "invalid_replacement" };
    }
  }
  return {
    ok: true,
    values: templates.map((template) => previewTemplateMaterialization(template, replacements)),
  };
}

export type OutreachTokens = {
  candidate_first_name: string; candidate_last_name: string; candidate_full_name: string;
  school: string; stage: string; class_year: string; fellow_point_person: string;
};

// One recipient as the composer renders it: display fields + a precomputed token
// set so the client preview matches the server's send exactly. Client-safe.
export type ComposerRecipient = {
  id: string; name: string; email: string | null;
  school: string; stage: string; classYear: string; area: string | null;
  doNotContact: boolean; tokens: OutreachTokens;
};

// A selectable group. endpoint routes the send: "candidates" (assignment-scoped)
// or "team" (admin-only fellow cohorts).
export type OutreachAudience = {
  key: "mine" | "all" | "first_year_fellows" | "second_year_fellows";
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
    const normalizedKey = LEGACY_MERGE_VARIABLES[key.toLowerCase()] ?? key.toLowerCase();
    const value = (tokens as Record<string, string>)[normalizedKey];
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
    candidate_first_name: first,
    candidate_last_name: last,
    candidate_full_name: (input.name ?? "").trim(),
    school: input.school,
    stage: input.stage ?? "",
    class_year: parseClassYear(input.gradDate),
    fellow_point_person: input.pointPerson,
  };
}
