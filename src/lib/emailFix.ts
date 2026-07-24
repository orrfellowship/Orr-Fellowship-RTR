// Malformed-email detection + best-guess corrections for the admin email review.
// Pure + no imports, so it's shared by the review UI and unit-tested. The rule
// mirrors the outreach validity check: local@domain.tld, no spaces, real TLD.

const VALID = /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/;

export function isValidEmail(email: string | null | undefined): boolean {
  return !!email && VALID.test(email.trim());
}

// Common domain misspellings → the intended domain.
const DOMAIN_FIXES: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmal.com": "gmail.com",
  "gnail.com": "gmail.com", "gmaill.com": "gmail.com", "gmail.co": "gmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com", "outlok.com": "outlook.com", "iclould.com": "icloud.com",
};

// Best-guess correction for a malformed address, or null if we can't confidently
// repair it. Only returns a value that is itself valid and different from the
// input, so a suggestion is always safe to accept as-is.
export function suggestEmailFix(raw: string | null | undefined): string | null {
  let e = (raw ?? "").trim().replace(/\s+/g, "").toLowerCase();
  if (!e) return null;

  // Collapse duplicate '@' down to the last one (keeps "a@@b" → "a@b").
  const parts = e.split("@").filter(Boolean);
  if (parts.length >= 2) e = `${parts.slice(0, -1).join("")}@${parts[parts.length - 1]}`;

  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return null; // no repairable local/domain split
  const local = e.slice(0, at);
  let domain = e.slice(at + 1).replace(/\.{2,}/g, "."); // collapse ".." → "."

  // Obvious TLD typos (kept conservative: never touch a real TLD like .co).
  domain = domain
    .replace(/\.con$/, ".com").replace(/\.cim$/, ".com").replace(/\.cmo$/, ".com")
    .replace(/\.ocm$/, ".com").replace(/\.comm$/, ".com").replace(/\.cm$/, ".com")
    .replace(/\.edu\.$/, ".edu").replace(/\.$/, "");
  // Missing dot before a known TLD ("gmailcom" → "gmail.com").
  domain = domain.replace(/^(gmail|yahoo|hotmail|outlook|icloud|aol)com$/, "$1.com");
  if (DOMAIN_FIXES[domain]) domain = DOMAIN_FIXES[domain];

  const fixed = `${local}@${domain}`;
  return isValidEmail(fixed) && fixed !== (raw ?? "").trim().toLowerCase() ? fixed : null;
}

export type EmailCand = { id: string; name: string; email: string | null };

// Candidates that HAVE an email worth reviewing: either it's outright invalid,
// or it passes the basic shape but looks like a typo we can confidently repair
// (e.g. "gmail.con"). A blank email isn't "malformed" — it's just missing.
export function findMalformedEmails<T extends EmailCand>(cands: T[]): T[] {
  return cands.filter((c) => !!c.email && !!c.email.trim() && (!isValidEmail(c.email) || suggestEmailFix(c.email) !== null));
}
