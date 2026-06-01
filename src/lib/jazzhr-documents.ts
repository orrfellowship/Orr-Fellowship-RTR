// Resolve a candidate's resume document via the prospect-level documentList.
// Takes the NUMERIC prospect id (see jazz_prospect_map bridge).

import { JazzAuthExpiredError, jazzHeaders } from "./jazzhr-client";

interface RawDoc {
  id: number;
  name: string;
  mimeType: string;
  size: number;
  isResume: boolean;
  collectionStatus: string;
  collectionArchivedAt: string | null;
  updatedAt: string;
}

export interface JazzResumeDoc {
  documentId: number;
  name: string;
  size: number;
  updatedAt: string;
}

export async function getResumeDocument(
  prospectNumericId: number | string,
  ticket: string,
): Promise<JazzResumeDoc | null> {
  const url =
    `https://api.jazz.co/prospect/${prospectNumericId}/documentList` +
    `?_partialAcl=true&includeArchived=false&per_page=50`;
  const res = await fetch(url, { headers: jazzHeaders(ticket) });

  if (res.status === 401 || res.status === 403)
    throw new JazzAuthExpiredError("sandcastle_ticket rejected — refresh it.");
  if (!res.ok) throw new Error(`documentList ${prospectNumericId}: ${res.status}`);
  if ((res.headers.get("content-type") ?? "").includes("text/html"))
    throw new JazzAuthExpiredError("Got HTML — ticket expired or CF challenge.");

  const docs = (await res.json()) as RawDoc[];
  const resume = docs
    .filter(
      (d) =>
        d.isResume &&
        d.mimeType === "application/pdf" &&
        d.collectionStatus === "Active" &&
        !d.collectionArchivedAt,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  return resume
    ? { documentId: resume.id, name: resume.name, size: resume.size, updatedAt: resume.updatedAt }
    : null;
}
