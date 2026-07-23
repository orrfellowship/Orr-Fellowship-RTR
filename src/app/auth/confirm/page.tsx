import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

// Interstitial for emailed invite/reset links. The single-use token is verified
// ONLY when the user submits this form (a POST via the server action) — never on
// the bare GET. That's deliberate: corporate email scanners (SafeLinks, Mimecast,
// Proofpoint) and link-preview bots prefetch links with a GET, and verifyOtp is
// single-use, so a GET-time verify would burn the token before the human clicks
// and leave them with "Auth session missing" on the password screen.
export const dynamic = "force-dynamic";

async function confirm(formData: FormData) {
  "use server";
  const token_hash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "invite") as EmailOtpType;
  if (!token_hash) redirect(`/auth/link-expired?type=${encodeURIComponent(type)}`);

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });
  // Token expired or already consumed -> send to a page that explains how to get
  // a fresh link, instead of dropping them on set-password with no session.
  if (error) redirect(`/auth/link-expired?type=${encodeURIComponent(type)}`);

  redirect("/auth/set-password");
}

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const query = await searchParams;
  const token_hash = query.token_hash ?? "";
  const type = query.type ?? "invite";
  const isInvite = type === "invite" || type === "signup";

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--navy)" }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 36, width: 380, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", margin: "0 0 4px" }}>
          {isInvite ? "Welcome to Orr Recruiting" : "Reset your password"}
        </h1>
        <p style={{ fontSize: 14, color: "#6E7385", marginTop: 0, marginBottom: 20 }}>
          {isInvite
            ? "Click below to confirm your invite and set your password."
            : "Click below to continue and choose a new password."}
        </p>

        <form action={confirm}>
          <input type="hidden" name="token_hash" value={token_hash} />
          <input type="hidden" name="type" value={type} />
          <button
            type="submit"
            style={{ width: "100%", border: "none", background: "var(--orange)", color: "#fff", fontWeight: 700, padding: 12, borderRadius: 10, cursor: "pointer", fontSize: 14 }}
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
