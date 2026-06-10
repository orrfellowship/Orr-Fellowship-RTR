import nodemailer from "nodemailer";

// Transactional email over the SMTP credentials configured in Supabase.
// Env (add to .env.local and Vercel):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// If SMTP isn't configured we no-op gracefully so the rest of the app keeps
// working (notifications still queue + show in-app; they just aren't emailed).

let cached: nodemailer.Transporter | null = null;

function transporter(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  if (cached) return cached;
  const port = Number(process.env.SMTP_PORT ?? 587);
  cached = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass },
    // Pool one authenticated connection and reuse it across messages. Without
    // this, nodemailer logs in fresh for EVERY send — a bulk invite then trips
    // Gmail's "454 Too many login attempts". Throttle to a few msgs/sec too.
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 3,
  });
  return cached;
}

export function emailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendEmail(opts: { to: string; subject: string; html: string; text?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const tx = transporter();
  if (!tx) return { ok: false, error: "SMTP not configured" };
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER!;
  try {
    await tx.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? htmlToText(opts.html),
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "send failed" };
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
