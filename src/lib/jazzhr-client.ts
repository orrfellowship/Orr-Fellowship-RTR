// Shared helpers for JazzHR's internal api.jazz.co endpoints.
// Auth is the sandcastle_ticket JWT cookie (~20h lifetime, user-scoped).
// Server-side calls pass Cloudflare with only a real user-agent header.

export const JAZZ_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

/** Thrown when the sandcastle_ticket is rejected/expired or a CF challenge fires. */
export class JazzAuthExpiredError extends Error {}

export function jazzHeaders(ticket: string, json = true) {
  return {
    cookie: `sandcastle_ticket=${ticket}`,
    "user-agent": JAZZ_UA,
    accept: json ? "application/json, text/plain, */*" : "*/*",
    referer: "https://app.jazz.co/",
  };
}
