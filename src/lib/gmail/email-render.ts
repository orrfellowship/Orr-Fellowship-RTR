// Pure rendering of an outreach body (plain text as authored in the composer)
// into the two MIME representations we send:
//   • an HTML part — branded with the Orr emblem, with links made clickable
//   • a plain-text alternative — links flattened to "label (url)"
//
// No server imports, so it is unit-testable and shared by every send path.
//
// Link syntax: [label](https://url). This deliberately reuses markdown's link
// form; findManualPlaceholders() excludes the "[label](" shape so a link is
// never mistaken for a [fill-me-in] placeholder. Bare http(s) URLs are also
// auto-linked. Only http/https is allowed — anything else is left as text.

export const ORR_EMBLEM_CID = "orr-emblem";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A safe href for an http/https URL. Returns null for anything else so we never
// emit a javascript:/data: link.
function safeHref(url: string): string | null {
  return /^https?:\/\/[^\s<>"']+$/i.test(url) ? url : null;
}

// [label](url) links first, then bare URLs. Callback receives either a matched
// link or a run of plain text, in order.
const SEGMENT_RE = /\[([^\][\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)/g;

type Segment =
  | { kind: "text"; text: string }
  | { kind: "link"; label: string; url: string };

export function parseBodySegments(body: string): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const match of body.matchAll(SEGMENT_RE)) {
    const index = match.index ?? 0;
    if (index > cursor) out.push({ kind: "text", text: body.slice(cursor, index) });
    if (match[1] !== undefined && match[2] !== undefined) {
      out.push({ kind: "link", label: match[1], url: match[2] });
    } else {
      out.push({ kind: "link", label: match[3], url: match[3] });
    }
    cursor = index + match[0].length;
  }
  if (cursor < body.length) out.push({ kind: "text", text: body.slice(cursor) });
  return out;
}

// HTML body content (the inner message, minus the branded wrapper).
function renderBodyHtml(body: string): string {
  return parseBodySegments(body)
    .map((seg) => {
      if (seg.kind === "text") return escapeHtml(seg.text).replace(/\r?\n/g, "<br>\n");
      const href = safeHref(seg.url);
      const label = escapeHtml(seg.label);
      return href
        ? `<a href="${escapeHtml(href)}" style="color:#DD5434; text-decoration:underline;">${label}</a>`
        : escapeHtml(seg.kind === "link" ? (seg.label === seg.url ? seg.url : `${seg.label} (${seg.url})`) : "");
    })
    .join("");
}

// The full HTML document: a simple, email-client-safe letterhead with the
// emblem on top (referenced by CID) when one is available.
export function renderOutreachHtml(body: string, opts: { emblemCid?: string | null } = {}): string {
  const inner = renderBodyHtml(body);
  const emblem = opts.emblemCid
    ? `<img src="cid:${opts.emblemCid}" alt="Orr Fellowship" width="120" style="display:block; height:auto; margin:0 0 20px; border:0;" />`
    : "";
  return [
    `<!DOCTYPE html>`,
    `<html><body style="margin:0; padding:0; background:#ffffff;">`,
    `<div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.55; color:#303333; max-width:600px; margin:0 auto; padding:24px;">`,
    emblem,
    `<div>${inner}</div>`,
    `</div>`,
    `</body></html>`,
  ].join("\r\n");
}

// Plain-text alternative: links flattened so text-only clients still get the
// destination. "[Learn More](https://x)" → "Learn More (https://x)"; a bare URL
// stays as-is.
export function renderOutreachPlainText(body: string): string {
  return parseBodySegments(body)
    .map((seg) => {
      if (seg.kind === "text") return seg.text;
      return seg.label === seg.url ? seg.url : `${seg.label} (${seg.url})`;
    })
    .join("");
}
