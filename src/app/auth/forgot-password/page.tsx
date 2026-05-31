"use client";

import { useState } from "react";
import { sendPasswordReset } from "@/app/login/actions";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/callback?type=recovery`;
    const result = await sendPasswordReset(email.trim(), redirectTo);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSent(true);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--navy)" }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 36, width: 380, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", margin: "0 0 4px" }}>Reset password</h1>

        {sent ? (
          <p style={{ fontSize: 14, color: "var(--navy)", background: "#E1E9F4", padding: 14, borderRadius: 10, marginTop: 12 }}>
            Check your inbox — we sent a reset link to {email}.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 14, color: "#6E7385", marginTop: 0, marginBottom: 20 }}>
              Enter your email and we'll send you a link to set a new password.
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6E7385", display: "block", marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@orrfellowship.org"
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #D1D5E0", fontSize: 14, marginBottom: 18, boxSizing: "border-box" }}
            />
            <button
              onClick={submit}
              disabled={loading}
              style={{ width: "100%", border: "none", background: "var(--orange)", color: "#fff", fontWeight: 700, padding: 12, borderRadius: 10, cursor: loading ? "default" : "pointer", fontSize: 14, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>

            {error && <p style={{ color: "#C0392B", fontSize: 13, marginTop: 10 }}>{error}</p>}

            <p style={{ fontSize: 13, color: "#6E7385", textAlign: "center", marginTop: 16 }}>
              <a href="/login" style={{ color: "var(--navy)", textDecoration: "underline" }}>Back to sign in</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
