"use client";

import { useState, useEffect, useTransition } from "react";
import { C, HEAD } from "./constants";
import StagePill from "./StagePill";
import type { Cand } from "./types";
import {
  toggleFavorite, setNotInterested, logOutreach,
  getOutreach, addConnection, getConnections,
  deleteOutreach, deleteConnection,
} from "./actions";

type Connection = { id: string; fellow_id: string; name: string; relationship: string };
const REL_QUICK = ["Knows personally", "Went to school together", "Worked together", "Alumni connection", "Mutual friend"];

export default function CandidateDrawer({ c, onClose }: {
  c: Cand;
  onClose: () => void;
}) {
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<{ id: string; body: string; created_at: string }[] | null>(null);
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [relDraft, setRelDraft] = useState("");
  const QUICK = ["Called — left voicemail", "Emailed", "Met in person", "Scheduled follow-up"];

  useEffect(() => {
    let active = true;
    Promise.all([getOutreach(c.id), getConnections(c.id)]).then(([outreach, connections]) => {
      if (!active) return;
      setLog((("log" in outreach ? outreach.log : []) as any) ?? []);
      setConns(("connections" in connections ? connections.connections : []) as Connection[]);
    });
    return () => { active = false; };
  }, [c.id]);

  const doAddConn = (rel: string) => {
    if (!rel.trim()) return;
    startTransition(() => {
      addConnection(c.id, rel.trim());
      setConns((prev) => [{ id: Math.random().toString(), fellow_id: "", name: "You", relationship: rel.trim() }, ...(prev ?? [])]);
      setRelDraft("");
    });
  };

  const doDelConn = (id: string) => {
    startTransition(() => {
      deleteConnection(id);
      setConns((prev) => (prev ?? []).filter((cn) => cn.id !== id));
    });
  };

  const doLog = (body: string) => startTransition(() => {
    logOutreach(c.id, body);
    setLog((prev) => [{ id: Math.random().toString(), body, created_at: new Date().toISOString() }, ...(prev ?? [])]);
  });

  const doDelLog = (id: string) => {
    startTransition(() => {
      deleteOutreach(id);
      setLog((prev) => (prev ?? []).filter((n) => n.id !== id));
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(11,12,42,.45)" }} />
      <div style={{ position: "relative", width: 440, maxWidth: "93vw", background: C.canvas, height: "100%", overflowY: "auto" }}>
        <div style={{ background: C.navy, color: "#fff", padding: "24px 24px 20px", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,.14)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 16 }}>×</button>
          <h2 style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 24, margin: "0 0 2px" }}>{c.name}</h2>
          <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.72)" }}>{c.area_of_study}</div>
          <div style={{ marginTop: 12 }}><StagePill stage={c.stage} /></div>
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <button onClick={() => startTransition(() => { toggleFavorite(c.id, !c.is_favorite); })} style={{ flex: 1, border: `1px solid ${c.is_favorite ? C.gold : C.line}`, background: c.is_favorite ? "#FBF3D6" : "#fff", color: c.is_favorite ? "#8A6D0E" : C.gray, fontWeight: 700, padding: 10, borderRadius: 9, cursor: "pointer", fontSize: 13 }}>{c.is_favorite ? "★ Favorited" : "☆ Favorite"}</button>
            <button onClick={() => startTransition(() => { setNotInterested(c.id, !c.not_interested); })} style={{ flex: 1, border: `1px solid ${C.line}`, background: c.not_interested ? "#EFEFF2" : "#fff", color: C.gray, fontWeight: 700, padding: 10, borderRadius: 9, cursor: "pointer", fontSize: 13 }}>{c.not_interested ? "Unflag" : "Flag not interested"}</button>
          </div>

          {[["Email", c.email], ["GPA", c.gpa]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 13, color: C.grayMute, fontWeight: 600 }}>{k}</span>
              <span style={{ fontSize: 13, color: C.gray, fontWeight: 600 }}>{v ?? "—"}</span>
            </div>
          ))}

          <div style={{ display: "flex", gap: 8, margin: "16px 0 20px" }}>
            <a href={c.linkedin ?? "#"} target="_blank" rel="noopener noreferrer"
              style={{ flex: 1, textAlign: "center", textDecoration: "none", border: `1px solid ${C.line}`, background: "#fff", color: c.linkedin ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, pointerEvents: c.linkedin ? "auto" : "none" }}>LinkedIn ↗</a>
            <button
              onClick={async () => {
                if (!c.jazz_id) return;
                const res = await fetch(`/api/resume?jazzId=${encodeURIComponent(c.jazz_id)}`);
                if (res.ok) { const url = URL.createObjectURL(await res.blob()); window.open(url, "_blank"); }
                else { alert("Resume unavailable (private file) — view this candidate directly in JazzHR."); }
              }}
              disabled={!c.jazz_id}
              style={{ flex: 1, textAlign: "center", border: `1px solid ${C.line}`, background: "#fff", color: c.jazz_id ? C.navy : C.grayMute, fontWeight: 700, padding: 10, borderRadius: 9, fontSize: 13, cursor: c.jazz_id ? "pointer" : "not-allowed" }}>Résumé ↗</button>
          </div>

          {/* Warm intros */}
          <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
            <div style={{ fontFamily: HEAD, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, marginBottom: 10, letterSpacing: 0.8 }}>Warm Intros</div>
            {conns === null ? (
              <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>Loading…</div>
            ) : conns.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {conns.map((cn) => (
                  <div key={cn.id} style={{ fontSize: 13, color: C.gray, display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 16 }}>●</span>
                    <span style={{ flex: 1 }}><b>{cn.name}</b> — <span style={{ color: C.grayMute }}>{cn.relationship}</span></span>
                    <button onClick={() => doDelConn(cn.id)} title="Remove" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }}>×</button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic", marginBottom: 10 }}>No connections logged yet.</div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
              {REL_QUICK.map((r) => (
                <button key={r} onClick={() => doAddConn(r)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 600, fontSize: 11.5, padding: "4px 10px", borderRadius: 999, cursor: "pointer" }}>+ {r}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <input value={relDraft} onChange={(e) => setRelDraft(e.target.value)} placeholder="Custom relationship…"
                style={{ flex: 1, padding: "8px 11px", borderRadius: 8, border: `1px solid ${C.line}`, fontSize: 13 }} />
              <button onClick={() => doAddConn(relDraft)} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 600, padding: "0 13px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Add</button>
            </div>
          </div>

          {/* Outreach log */}
          <div style={{ fontFamily: HEAD, fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: C.grayMute, marginBottom: 10 }}>Outreach log</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {QUICK.map((q) => <button key={q} onClick={() => doLog(q)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontWeight: 600, fontSize: 12, padding: "6px 11px", borderRadius: 999, cursor: "pointer" }}>+ {q}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a note…" style={{ flex: 1, padding: "10px 13px", borderRadius: 9, border: `1px solid ${C.line}`, fontSize: 13.5 }} />
            <button onClick={() => { if (draft.trim()) { doLog(draft.trim()); setDraft(""); } }} style={{ border: "none", background: C.navy, color: "#fff", fontWeight: 600, padding: "0 16px", borderRadius: 9, cursor: "pointer" }}>Log</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(log ?? []).map((n) => (
              <div key={n.id} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 9, padding: "11px 13px", fontSize: 13, color: C.gray, display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ flex: 1 }}>{n.body}</span>
                <button onClick={() => doDelLog(n.id)} title="Remove" style={{ border: "none", background: "none", color: C.grayMute, cursor: "pointer", fontSize: 15, lineHeight: 1, flexShrink: 0, padding: "0 2px" }}>×</button>
              </div>
            ))}
            {(log ?? []).length === 0 && <div style={{ fontSize: 13, color: C.grayMute, fontStyle: "italic" }}>No outreach logged yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
