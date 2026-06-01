// Authenticated JazzHR resume download.
//
// The public resumator API returns an UNSIGNED private S3 link (403 forever).
// Instead we hit JazzHR's own document endpoint with a sandcastle_ticket JWT,
// which 302-redirects to a freshly pre-signed S3 URL we can then fetch.
// See JAZZHR_RESUME_DISPLAY_HANDOFF.md for the full reverse-engineering notes.

const JAZZHR_BASE = "https://api.jazz.co";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

export interface ResumeFile {
  buffer: Buffer;
  contentType: string;
}

/** Thrown when the sandcastle_ticket is rejected/expired or a CF challenge fires. */
export class JazzAuthExpiredError extends Error {}

/** Download a resume by JazzHR document id using a valid sandcastle_ticket. */
export async function fetchJazzResume(
  documentId: string | number,
  sandcastleTicket: string,
): Promise<ResumeFile> {
  const url = `${JAZZHR_BASE}/document/${documentId}/download?binary=true`;
  const res = await fetch(url, {
    method: "GET",
    redirect: "manual", // follow the S3 redirect ourselves
    headers: {
      cookie: `sandcastle_ticket=${sandcastleTicket}`,
      "user-agent": BROWSER_UA,
      accept: "*/*",
      referer: "https://app.jazz.co/",
    },
  });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) throw new Error("Redirect returned no Location header.");
    const fileRes = await fetch(location); // signed URL self-authenticates
    if (!fileRes.ok) throw new Error(`Signed S3 fetch failed: ${fileRes.status}`);
    return {
      buffer: Buffer.from(await fileRes.arrayBuffer()),
      contentType: fileRes.headers.get("content-type") ?? "application/pdf",
    };
  }

  if (res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html"))
      throw new JazzAuthExpiredError("Got HTML, not a file — ticket expired or CF challenge.");
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: ct || "application/pdf",
    };
  }

  if (res.status === 401 || res.status === 403)
    throw new JazzAuthExpiredError("sandcastle_ticket rejected — refresh it.");
  throw new Error(`Unexpected status from JazzHR: ${res.status}`);
}
