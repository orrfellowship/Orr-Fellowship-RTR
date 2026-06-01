// JazzHR document-list lookup — finds the candidate's resume documentId so it
// can be handed to fetchJazzResume(). Uses the sandcastle_ticket JWT cookie.

import { JazzAuthExpiredError } from "./jazzhr-resume";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

// The exact documentList URL is the one item to confirm from DevTools
// (Copy-as-cURL on the documentList request). It is overridable via the
// JAZZHR_DOCLIST_URL env var so it can be corrected without a code change.
// Placeholders {jobId} and {candidateId} are substituted at call time; if the
// confirmed URL is candidate-scoped only, simply omit {jobId} from the env value.
export const DOCUMENTS_URL_TEMPLATE =
  process.env.JAZZHR_DOCLIST_URL ??
  "https://api.jazz.co/job/{jobId}/candidate/{candidateId}/documentList" +
    "?_partialAcl=true&includeArchived=false&per_page=50";

interface RawJazzDocument {
  id: number;
  name: string;
  type: string;
  mimeType: string;
  size: number;
  isResume: boolean;
  typeStatus: string;
  collectionStatus: string;
  collectionArchivedAt: string | null;
  collectionDownloadUrl: string;
  prospectProspectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JazzDocument {
  documentId: number;
  name: string;
  mimeType: string;
  size: number;
  isResume: boolean;
  downloadPath: string;
  prospectId: string | null;
  createdAt: string;
  updatedAt: string;
}

function buildDocumentsUrl(candidateId: string | number, jobId: string | number) {
  return DOCUMENTS_URL_TEMPLATE
    .replace("{candidateId}", String(candidateId))
    .replace("{jobId}", String(jobId));
}

export async function listJazzDocuments(
  candidateId: string | number,
  jobId: string | number,
  sandcastleTicket: string,
): Promise<JazzDocument[]> {
  const res = await fetch(buildDocumentsUrl(candidateId, jobId), {
    headers: {
      cookie: `sandcastle_ticket=${sandcastleTicket}`,
      "user-agent": BROWSER_UA,
      accept: "application/json",
      referer: "https://app.jazz.co/",
    },
  });

  if (res.status === 401 || res.status === 403)
    throw new JazzAuthExpiredError("sandcastle_ticket rejected — refresh it.");
  if (!res.ok) throw new Error(`documentList failed for ${candidateId}: ${res.status}`);
  if ((res.headers.get("content-type") ?? "").includes("text/html"))
    throw new JazzAuthExpiredError("Got HTML, not JSON — ticket expired or CF challenge.");

  const raw = (await res.json()) as RawJazzDocument[];
  return raw
    .filter((d) => d.collectionStatus === "Active" && !d.collectionArchivedAt)
    .map((d) => ({
      documentId: d.id,
      name: d.name,
      mimeType: d.mimeType,
      size: d.size,
      isResume: d.isResume,
      downloadPath: d.collectionDownloadUrl,
      prospectId: d.prospectProspectId,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
}

/** The candidate's resume document (most recent active PDF flagged isResume). */
export async function getResumeDocument(
  candidateId: string | number,
  jobId: string | number,
  sandcastleTicket: string,
): Promise<JazzDocument | null> {
  const docs = await listJazzDocuments(candidateId, jobId, sandcastleTicket);
  return (
    docs
      .filter((d) => d.isResume && d.mimeType === "application/pdf")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}
