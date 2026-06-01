// Download resume PDF bytes by JazzHR document id.

import { JazzAuthExpiredError, jazzHeaders } from "./jazzhr-client";

export interface ResumeFile {
  buffer: Buffer;
  contentType: string;
}

export async function fetchJazzResume(
  documentId: number | string,
  ticket: string,
): Promise<ResumeFile> {
  // Server-side this returns the PDF directly (HTTP 200, application/pdf).
  // redirect:"manual" + the 3xx branch are kept as a safety net.
  const res = await fetch(
    `https://api.jazz.co/document/${documentId}/download?binary=true`,
    { headers: jazzHeaders(ticket, false), redirect: "manual" },
  );

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) throw new Error("Redirect without Location.");
    const f = await fetch(loc); // signed URL self-authenticates
    if (!f.ok) throw new Error(`S3 fetch failed: ${f.status}`);
    return {
      buffer: Buffer.from(await f.arrayBuffer()),
      contentType: f.headers.get("content-type") ?? "application/pdf",
    };
  }

  if (res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html"))
      throw new JazzAuthExpiredError("Got HTML, not a PDF — ticket expired or CF challenge.");
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: ct || "application/pdf" };
  }

  if (res.status === 401 || res.status === 403)
    throw new JazzAuthExpiredError("sandcastle_ticket rejected — refresh it.");
  throw new Error(`Download unexpected status: ${res.status}`);
}
