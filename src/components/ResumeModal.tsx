"use client";

import { useEffect, useState } from "react";

// Inline résumé viewer shared by the Console and Workspace candidate views.
// Fetches /api/resume?jazzId=…; handles both the JSON { url } preferred path
// and the legacy streamed-PDF fallback, plus needsSync / needsRefresh states.

const NAVY = "#11123E";
const HEAD = "'Cabin', sans-serif";

export default function ResumeModal({ jazzId, name, onClose }: {
  jazzId: string; name: string; onClose: () => void;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; url: string; filename: string }
    | { kind: "expired" }
    | { kind: "needsSync" }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(`/api/resume?jazzId=${encodeURIComponent(jazzId)}`);
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const data = await res.json();
          if (!active) return;
          if (data.needsRefresh) setState({ kind: "expired" });
          else if (data.needsSync) setState({ kind: "needsSync" });
          else if (data.url) setState({ kind: "ready", url: data.url, filename: data.filename ?? "resume.pdf" });
          else setState({ kind: "error", message: data.error ?? "Resume unavailable." });
        } else if (res.ok) {
          const blob = await res.blob();
          if (!active) return;
          objectUrl = URL.createObjectURL(blob);
          setState({ kind: "ready", url: objectUrl, filename: "resume.pdf" });
        } else {
          setState({ kind: "error", message: "Resume unavailable for this candidate." });
        }
      } catch {
        if (active) setState({ kind: "error", message: "Could not load resume." });
      }
    })();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [jazzId]);

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(11,12,42,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, width: 900, maxWidth: "95vw", height: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,0,.4)" }}>
        <div style={{ background: NAVY, color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16 }}>{name} — Résumé</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {state.kind === "ready" && (
              <a href={state.url} target="_blank" rel="noopener noreferrer"
                style={{ color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none", border: "1px solid rgba(255,255,255,.3)", padding: "5px 12px", borderRadius: 8 }}>Open ↗</a>
            )}
            <button onClick={onClose} style={{ background: "rgba(255,255,255,.14)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 16 }}>×</button>
          </div>
        </div>
        <div style={{ flex: 1, background: "#525659", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {state.kind === "loading" && <div style={{ color: "#fff", fontSize: 14 }}>Loading résumé…</div>}
          {state.kind === "ready" && (
            <iframe src={state.url} title={state.filename} style={{ width: "100%", height: "100%", border: "none" }} />
          )}
          {state.kind === "expired" && (
            <div style={{ color: "#fff", fontSize: 14, textAlign: "center", padding: 30, maxWidth: 420, lineHeight: 1.6 }}>
              JazzHR session expired. An admin needs to refresh the <code style={{ background: "rgba(255,255,255,.15)", padding: "1px 6px", borderRadius: 4 }}>JAZZHR_SANDCASTLE_TICKET</code>, then reopen this résumé.
            </div>
          )}
          {state.kind === "needsSync" && (
            <div style={{ color: "#fff", fontSize: 14, textAlign: "center", padding: 30, maxWidth: 420, lineHeight: 1.6 }}>
              This candidate isn't mapped yet. An admin needs to run <b>Sync → Step 5 — Sync résumé IDs</b>, then reopen this résumé.
            </div>
          )}
          {state.kind === "error" && (
            <div style={{ color: "#fff", fontSize: 14, textAlign: "center", padding: 30, maxWidth: 420, lineHeight: 1.6 }}>{state.message}</div>
          )}
        </div>
      </div>
    </div>
  );
}
