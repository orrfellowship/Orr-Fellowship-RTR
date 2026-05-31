"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailPassword } from "./actions";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    setLoading(true);
    const result = await signInWithEmailPassword(email.trim(), password);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      router.push("/");
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--navy)" }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 36, width: 380, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", margin: "0 0 4px" }}>Orr Recruiting</h1>
        <p style={{ fontSize: 14, color: "#6E7385", marginTop: 0, marginBottom: 20 }}>Sign in with your Orr account.</p>

        <label style={{ fontSize: 12, fontWeight: 600, color: "#6E7385", display: "block", marginBottom: 4 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@orrfellowship.org"
          onKeyDown={(e) => e.key === "Enter" && signIn()}
          style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #D1D5E0", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }}
        />

        <label style={{ fontSize: 12, fontWeight: 600, color: "#6E7385", display: "block", marginBottom: 4 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          onKeyDown={(e) => e.key === "Enter" && signIn()}
          style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #D1D5E0", fontSize: 14, marginBottom: 18, boxSizing: "border-box" }}
        />

        <button
          onClick={signIn}
          disabled={loading}
          style={{ width: "100%", border: "none", background: "var(--orange)", color: "#fff", fontWeight: 700, padding: 12, borderRadius: 10, cursor: loading ? "default" : "pointer", fontSize: 14, opacity: loading ? 0.7 : 1 }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        {error && <p style={{ color: "#C0392B", fontSize: 13, marginTop: 10 }}>{error}</p>}

        <p style={{ fontSize: 13, color: "#6E7385", textAlign: "center", marginTop: 16 }}>
          <a href="/auth/forgot-password" style={{ color: "var(--navy)", textDecoration: "underline" }}>Forgot password?</a>
        </p>
      </div>
    </div>
  );
}
