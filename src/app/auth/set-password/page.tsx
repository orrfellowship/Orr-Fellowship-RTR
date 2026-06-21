"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The confirm flow should have established a session before we land here. If
  // it didn't (link expired/consumed, direct navigation), bounce to the
  // recoverable page rather than letting updateUser throw "Auth session missing".
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/auth/link-expired");
    });
  }, [router]);

  async function submit() {
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      setDone(true);
      setTimeout(() => router.push("/"), 1500);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--navy)" }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 36, width: 380, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,.3)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", margin: "0 0 4px" }}>Set your password</h1>
        <p style={{ fontSize: 14, color: "#6E7385", marginTop: 0, marginBottom: 20 }}>
          Choose a password you'll use to sign in going forward.
        </p>

        {done ? (
          <p style={{ fontSize: 14, color: "#10b981", background: "#E1F5EE", padding: 14, borderRadius: 10 }}>
            Password set! Taking you to the app…
          </p>
        ) : (
          <>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6E7385", display: "block", marginBottom: 4 }}>New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #D1D5E0", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }}
            />

            <label style={{ fontSize: 12, fontWeight: 600, color: "#6E7385", display: "block", marginBottom: 4 }}>Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #D1D5E0", fontSize: 14, marginBottom: 18, boxSizing: "border-box" }}
            />

            <button
              onClick={submit}
              disabled={loading}
              style={{ width: "100%", border: "none", background: "var(--orange)", color: "#fff", fontWeight: 700, padding: 12, borderRadius: 10, cursor: loading ? "default" : "pointer", fontSize: 14, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "Saving…" : "Set password"}
            </button>

            {error && <p style={{ color: "#C0392B", fontSize: 13, marginTop: 10 }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
