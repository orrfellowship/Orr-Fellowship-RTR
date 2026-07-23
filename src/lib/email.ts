import { Resend } from "resend";
import { createHash } from "node:crypto";

// RTR transactional system email for fellows and RTR users only.
// Env (add to .env.local and Vercel):
//   RESEND_API_KEY, RESEND_FROM_EMAIL
// Candidate outreach, recruiting campaigns, and mass email must use a separate system.
// If Resend isn't configured we no-op gracefully so the rest of the app keeps
// working (notifications still queue + show in-app; they just aren't emailed).

let cached: Resend | null = null;

function client(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (cached) return cached;
  cached = new Resend(apiKey);
  return cached;
}

export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

export type SendEmailFailure = { ok: false; error: string; category: string; retriable: boolean };
export type SendEmailResult = { ok: true; providerMessageId: string } | SendEmailFailure;

export function transactionalIdempotencyKey(kind: string, stableValue: string): string {
  const digest = createHash("sha256").update(stableValue).digest("hex");
  return `${kind}/${digest}`.slice(0, 256);
}

export async function sendEmail(opts: {
  to: string; subject: string; html: string; text?: string; idempotencyKey: string;
}): Promise<SendEmailResult> {
  const resend = client();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!resend || !from) return { ok: false, error: "Resend not configured", category: "missing_configuration", retriable: false };
  if (!opts.idempotencyKey || opts.idempotencyKey.length > 256) {
    return { ok: false, error: "Invalid Resend idempotency key", category: "invalid_idempotency_key", retriable: false };
  }
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? htmlToText(opts.html),
    }, { idempotencyKey: opts.idempotencyKey });
    if (error) {
      const permanent = new Set([
        "invalid_idempotency_key", "invalid_idempotent_request", "validation_error",
        "invalid_from_address", "invalid_parameter", "missing_required_field",
        "missing_api_key", "restricted_api_key", "invalid_api_key", "security_error",
      ]).has(error.name);
      const category = error.name === "rate_limit_exceeded" ? "rate_limit"
        : error.name === "validation_error" ? "invalid_recipient_or_payload"
        : `resend_${error.name}`;
      return { ok: false, error: error.message, category, retriable: !permanent };
    }
    if (!data?.id) return { ok: false, error: "Resend accepted without a provider message ID", category: "provider_missing_message_id", retriable: false };
    return { ok: true, providerMessageId: data.id };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "send failed";
    const timedOut = /timeout|timed out|abort/i.test(message);
    return { ok: false, error: message, category: timedOut ? "resend_timeout" : "resend_network_error", retriable: true };
  }
}

function htmlToText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ---- shared email chrome -----------------------------------------------------
const NAVY = "#11123E";
const ORANGE = "#DD5434";

export function emailLayout(opts: { heading: string; intro?: string; bodyHtml: string; ctaLabel?: string; ctaUrl?: string }): string {
  const cta = opts.ctaLabel && opts.ctaUrl
    ? `<a href="${opts.ctaUrl}" style="display:inline-block;background:${ORANGE};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:9px;margin-top:18px">${opts.ctaLabel}</a>`
    : "";
  return `
  <div style="background:#F7F8FB;padding:24px 0;font-family:Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E4E7EE;border-radius:14px;overflow:hidden">
      <div style="background:${NAVY};padding:18px 24px">
        <div style="color:#fff;font-weight:700;font-size:16px">Orr Recruiting</div>
      </div>
      <div style="padding:24px">
        <div style="font-size:20px;font-weight:700;color:${NAVY};margin-bottom:8px">${opts.heading}</div>
        ${opts.intro ? `<div style="font-size:14px;color:#6E7385;margin-bottom:14px">${opts.intro}</div>` : ""}
        <div style="font-size:14px;color:#303333;line-height:1.5">${opts.bodyHtml}</div>
        ${cta}
      </div>
      <div style="padding:14px 24px;border-top:1px solid #E4E7EE;font-size:11px;color:#8591AD">
        You're receiving this because you're on the Orr recruiting team.
      </div>
    </div>
  </div>`;
}
