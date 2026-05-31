"use client";

import { useState } from "react";
import { checkEmailAndSignIn } from "./actions";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    const result = await checkEmailAndSignIn(
      email,
      `${window.location.origin}/auth/callback`
    );
    if (result.error) setError(result.error);
    else setSent(true);
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--navy)" }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 36, width: 380, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", margin: "0 0 4px" }}>Orr Recruiting</h1>
        <p style={{ fontSize: 14, color: "#6E7385", marginTop: 0 }}>Sign in with your Orr email.</p>
        {sent ? (
          <p style={{ fontSize: 14, color: "var(--navy)", background: "#E1E9F4", padding: 14, borderRadius: 10 }}>
            Check your inbox — we sent a sign-in link to {email}.
          </p>
        ) : (
          <>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@orrfellowship.org"
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 14, marginBottom: 12 }}
            />
            <button
              onClick={signIn}
              style={{ width: "100%", border: "none", background: "var(--orange)", color: "#fff", fontWeight: 700, padding: 12, borderRadius: 10, cursor: "pointer", fontSize: 14 }}
            >
              Send sign-in link
            </button>
            {error && <p style={{ color: "#C0392B", fontSize: 13, marginTop: 10 }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
