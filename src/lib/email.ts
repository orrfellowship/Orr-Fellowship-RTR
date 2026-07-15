import { Resend } from "resend";

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

export async function sendEmail(opts: { to: string; subject: string; html: string; text?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = client();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!resend || !from) return { ok: false, error: "Resend not configured" };
  try {
    const { error } = await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? htmlToText(opts.html),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "send failed" };
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
