export type DemoCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  schoolName: string;
  graduationYear: number;
  major: string;
  stage: string;
  lastContactedAt: string | null;
  unsubscribed: boolean;
  doNotContact: boolean;
};

export type DemoCampaignRecipientResult = {
  candidateId: string;
  candidateName: string;
  maskedRecipient: string | null;
  status: "sent" | "failed" | "excluded";
  messageId?: string;
  failureReason?: string;
  exclusionReason?: string;
};

export type DemoCampaignResult = {
  success: true;
  attempted: number;
  sent: number;
  failed: number;
  excluded: number;
  recipients: DemoCampaignRecipientResult[];
};

export const DEMO_CAMPAIGN_LIMITS = {
  campaignName: 120,
  subject: 200,
  body: 10_000,
  selectedCandidates: 13,
  idempotencyKey: 128,
} as const;

export const MOCK_PRIMARY_CONTACT = {
  name: "Mark Stolte",
  firstName: "Mark",
  email: "mark.stolte@orrfellowship.org",
  schoolName: "Orr Fellowship",
} as const;

// The real test recipients. These addresses receive the campaign directly —
// there are no fictional candidates and no GMAIL_TEST_RECIPIENTS env var needed.
// To watch a failed send, flip one address to a malformed value (drop the .org).
export const DEMO_CANDIDATES: readonly DemoCandidate[] = [
  { id: "catherine-mazanek", firstName: "Catherine", lastName: "Mazanek", email: "catherine.mazanek@orrfellowship.org", schoolName: "Purdue University", graduationYear: 2027, major: "—", stage: "Test", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "jesse", firstName: "Jesse", lastName: "", email: "jesse@orrfellowship.org", schoolName: "Indiana University", graduationYear: 2027, major: "—", stage: "Test", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "jordan-lee-caracci", firstName: "Jordan", lastName: "Lee-Caracci", email: "jordan.lee-caracci@orrfellowship.org", schoolName: "Butler University", graduationYear: 2027, major: "—", stage: "Test", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "olivia-lux", firstName: "Olivia", lastName: "Lux", email: "olivia.lux@orrfellowship.org", schoolName: "DePauw University", graduationYear: 2027, major: "—", stage: "Test", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "mark-gmail", firstName: "Mark", lastName: "", email: "markstolte02@gmail.com", schoolName: "Orr Fellowship", graduationYear: 2027, major: "—", stage: "Test", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "mark-stolte", firstName: "Mark", lastName: "Stolte", email: "mark.stolte@orrfellowship.org", schoolName: "Orr Fellowship", graduationYear: 2027, major: "—", stage: "Test", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "samuel-brumley", firstName: "Samuel", lastName: "Brumley", email: "samuel.brumley@orrfellowship.org", schoolName: "Purdue University", graduationYear: 2027, major: "—", stage: "Test", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "sam", firstName: "Sam", lastName: "", email: "sam@brumley.cloud", schoolName: "Indiana University", graduationYear: 2027, major: "—", stage: "Test", lastContactedAt: null, unsubscribed: false, doNotContact: false },
];

export const MERGE_VARIABLES = [
  "{{first_name}}", "{{full_name}}", "{{school_name}}", "{{graduation_year}}",
  "{{major}}", "{{primary_contact_name}}", "{{primary_contact_email}}", "{{application_link}}",
] as const;

export const CAMPAIGN_STEPS = ["My Candidates", "Compose", "Preview", "Review"] as const;

const MERGE_VALUES = new Set<string>(MERGE_VARIABLES.map((variable) => variable.slice(2, -2)));

export const INITIAL_CAMPAIGN_SUBJECT = "{{first_name}}, explore Orr Fellowship opportunities";

export const INITIAL_CAMPAIGN_BODY = `Hi {{first_name}},

I hope your summer is going well! I wanted to reach out because your experience at {{school_name}} stood out to our recruiting team.

The Orr Fellowship connects ambitious graduating seniors with high-growth companies in Indianapolis, along with a two-year professional development experience and a close-knit peer community. I would love to tell you more and learn what you are looking for after graduation.

You can explore the Fellowship and start an application here: {{application_link}}

Best,
{{primary_contact_name}}`;

export function demoCandidateFullName(candidate: DemoCandidate): string {
  return `${candidate.firstName} ${candidate.lastName}`.trim();
}

export function getAutomaticExclusionReason(candidate: DemoCandidate): string | null {
  if (!candidate.email) return "Missing email address";
  if (candidate.unsubscribed) return "Unsubscribed from email";
  if (candidate.doNotContact) return "Marked Do Not Contact";
  return null;
}

export function isEligible(candidate: DemoCandidate): boolean {
  return getAutomaticExclusionReason(candidate) === null;
}

export function findUnsupportedMergeVariables(template: string): string[] {
  const variables = template.match(/\{\{[^{}]*\}\}/g) ?? [];
  const unsupported = variables.filter((variable) => {
    const key = variable.slice(2, -2).trim().toLowerCase();
    return !MERGE_VALUES.has(key);
  });
  if (/\{\{|\}\}/.test(template.replace(/\{\{[^{}]*\}\}/g, ""))) unsupported.push("Malformed merge variable");
  return [...new Set(unsupported)];
}

export function renderTemplate(template: string, candidate: DemoCandidate): string {
  const values: Record<string, string> = {
    first_name: candidate.firstName,
    full_name: demoCandidateFullName(candidate),
    school_name: candidate.schoolName,
    graduation_year: String(candidate.graduationYear),
    major: candidate.major,
    primary_contact_name: MOCK_PRIMARY_CONTACT.name,
    primary_contact_email: MOCK_PRIMARY_CONTACT.email,
    application_link: "https://orrfellowship.org/apply",
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => values[key.toLowerCase()] ?? match);
}

export function maskDemoRecipient(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}
