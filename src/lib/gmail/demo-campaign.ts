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
  name: "Sam Brumley",
  firstName: "Sam",
  email: "samuel.brumley@orrfellowship.org",
  schoolName: "Purdue University",
} as const;

export const DEMO_CANDIDATES: readonly DemoCandidate[] = [
  { id: "ava-patel", firstName: "Ava", lastName: "Patel", email: "samuel.brumley@orrfellowship.org", schoolName: "Purdue University", graduationYear: 2027, major: "Industrial Engineering", stage: "Sourced", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "malik-johnson", firstName: "Malik", lastName: "Johnson", email: "sam@brumley.cloud", schoolName: "Indiana University", graduationYear: 2027, major: "Finance", stage: "Contacted", lastContactedAt: "2026-07-08", unsubscribed: false, doNotContact: false },
  { id: "elena-garcia", firstName: "Elena", lastName: "Garcia", email: "samuel.brumley@orrfellowship.org", schoolName: "Butler University", graduationYear: 2028, major: "Marketing", stage: "Applied", lastContactedAt: "2026-06-24", unsubscribed: false, doNotContact: false },
  { id: "noah-kim", firstName: "Noah", lastName: "Kim", email: "sam@brumley.cloud", schoolName: "Purdue University", graduationYear: 2027, major: "Computer Science", stage: "Sourced", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "maya-thompson", firstName: "Maya", lastName: "Thompson", email: "samuel.brumley@orrfellowship.org", schoolName: "DePauw University", graduationYear: 2028, major: "Economics", stage: "Contacted", lastContactedAt: "2026-07-02", unsubscribed: false, doNotContact: false },
  { id: "liam-obrien", firstName: "Liam", lastName: "O'Brien", email: "sam@brumley.cloud", schoolName: "Wabash College", graduationYear: 2027, major: "Political Science", stage: "Applied", lastContactedAt: "2026-06-18", unsubscribed: false, doNotContact: false },
  { id: "zoe-williams", firstName: "Zoe", lastName: "Williams", email: "samuel.brumley@orrfellowship.org", schoolName: "Indiana University", graduationYear: 2028, major: "Information Systems", stage: "Sourced", lastContactedAt: null, unsubscribed: false, doNotContact: true },
  { id: "ethan-nguyen", firstName: "Ethan", lastName: "Nguyen", email: "samuel.brumley@orrfellowship.org", schoolName: "Purdue University", graduationYear: 2027, major: "Supply Chain Management", stage: "Finalist", lastContactedAt: "2026-07-10", unsubscribed: false, doNotContact: false },
  { id: "isabella-reed", firstName: "Isabella", lastName: "Reed", email: null, schoolName: "Butler University", graduationYear: 2028, major: "Strategic Communication", stage: "Sourced", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "caleb-brooks", firstName: "Caleb", lastName: "Brooks", email: "sam@brumley.cloud", schoolName: "Indiana University", graduationYear: 2027, major: "Accounting", stage: "Contacted", lastContactedAt: "2026-06-30", unsubscribed: true, doNotContact: false },
  { id: "grace-okafor", firstName: "Grace", lastName: "Okafor", email: "sam@brumley.cloud", schoolName: "Purdue University", graduationYear: 2027, major: "Mechanical Engineering", stage: "Sourced", lastContactedAt: null, unsubscribed: false, doNotContact: false },
  { id: "daniel-mueller", firstName: "Daniel", lastName: "Mueller", email: "samuel.brumley@orrfellowship.org", schoolName: "DePauw University", graduationYear: 2028, major: "Data Science", stage: "Contacted", lastContactedAt: "2026-07-05", unsubscribed: false, doNotContact: false },
  { id: "priya-shah", firstName: "Priya", lastName: "Shah", email: "sam@brumley.cloud", schoolName: "Butler University", graduationYear: 2027, major: "Entrepreneurship", stage: "Applied", lastContactedAt: "2026-06-28", unsubscribed: false, doNotContact: false },
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
  return `${candidate.firstName} ${candidate.lastName}`;
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
