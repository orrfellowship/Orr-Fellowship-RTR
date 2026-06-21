// Shown when an invite/reset token can't be verified — expired, already used, or
// consumed by an email scanner. Gives a clear next step instead of the cryptic
// "Auth session missing" that surfaced when the failure was swallowed.
export default function LinkExpiredPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const isInvite = searchParams.type === "invite" || searchParams.type === "signup";

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--navy)" }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 36, width: 380, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", margin: "0 0 4px" }}>This link can't be used</h1>
        <p style={{ fontSize: 14, color: "#6E7385", marginTop: 0, marginBottom: 20 }}>
          {isInvite
            ? "Your invite link has expired or was already used. Ask an Orr admin to resend your invite, then open the newest email."
            : "Your reset link has expired or was already used. Request a new one below, then open the newest email."}
        </p>

        {isInvite ? (
          <a
            href="/login"
            style={{ display: "block", textAlign: "center", textDecoration: "none", border: "none", background: "var(--orange)", color: "#fff", fontWeight: 700, padding: 12, borderRadius: 10, fontSize: 14 }}
          >
            Back to sign in
          </a>
        ) : (
          <a
            href="/auth/forgot-password"
            style={{ display: "block", textAlign: "center", textDecoration: "none", border: "none", background: "var(--orange)", color: "#fff", fontWeight: 700, padding: 12, borderRadius: 10, fontSize: 14 }}
          >
            Request a new reset link
          </a>
        )}
      </div>
    </div>
  );
}
