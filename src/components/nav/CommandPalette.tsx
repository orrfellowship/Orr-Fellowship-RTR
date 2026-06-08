"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Command, CornerDownLeft, Sparkles } from "lucide-react";
import type { NavItem } from "@/lib/nav/config";

const c = {
  card: "#ffffff", cardLine: "#eceaf2", bg: "#f4f4f9",
  ink: "#211d44", inkMid: "#5c5878", inkLo: "#938fad",
};
const FD = "'Cabin', sans-serif";
const FB = "'Open Sans', sans-serif";
const FM = "'JetBrains Mono', ui-monospace, monospace";

type FlatItem = NavItem & { group: string };

// ⌘K command palette. Built from the same role-filtered nav the sidebar uses,
// so results can never surface a route the role isn't allowed to see.
export default function CommandPalette({ items, activeHref, accent, onClose }: {
  items: FlatItem[]; activeHref: string; accent: string; onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const accentDim = `${accent}29`;

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((i) =>
      i.label.toLowerCase().includes(t) || i.group.toLowerCase().includes(t) || (i.hint ?? "").toLowerCase().includes(t));
  }, [q, items]);
  useEffect(() => { setHi(0); }, [q]);

  const go = (href: string) => { onClose(); router.push(href); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); if (results[hi]) go(results[hi].href); }
  };

  const grouped = useMemo(() => {
    const m: Record<string, (FlatItem & { idx: number })[]> = {};
    results.forEach((r, idx) => { (m[r.group] = m[r.group] || []).push({ ...r, idx }); });
    return m;
  }, [results]);

  const miniKbd = { fontFamily: FM, fontSize: 10, padding: "1px 5px", borderRadius: 5, background: "#fff", color: c.inkMid, border: `1px solid ${c.cardLine}` };

  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label="Command palette"
      style={{ position: "fixed", inset: 0, background: "rgba(23,21,46,0.5)", backdropFilter: "blur(6px)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh", animation: "orrFade .15s ease" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(620px, 92vw)", background: c.card, borderRadius: 18, boxShadow: "0 28px 80px rgba(23,21,46,0.45)", overflow: "hidden", border: `1px solid ${c.cardLine}`, animation: "orrPop .18s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${c.cardLine}` }}>
          <Command size={18} style={{ color: accent }} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search pages, sections…"
            style={{ flex: 1, border: "none", outline: "none", fontSize: 16, fontFamily: FB, color: c.ink, background: "transparent" }} />
          <kbd style={{ ...miniKbd, fontSize: 10.5 }}>esc</kbd>
        </div>
        <div style={{ maxHeight: 360, overflowY: "auto", padding: 8 }}>
          {results.length === 0 && <div style={{ padding: "30px 16px", textAlign: "center", color: c.inkLo, fontSize: 14 }}>No matches for “{q}”.</div>}
          {Object.entries(grouped).map(([group, list]) => (
            <div key={group} style={{ marginBottom: 4 }}>
              <div style={{ fontFamily: FM, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: c.inkLo, padding: "10px 12px 6px" }}>{group}</div>
              {list.map((it) => {
                const Icon = it.icon;
                const isHi = it.idx === hi;
                const isCurrent = activeHref === it.href;
                return (
                  <button key={it.id} onMouseEnter={() => setHi(it.idx)} onClick={() => go(it.href)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 13, padding: "11px 12px", borderRadius: 11, border: "none", cursor: "pointer", textAlign: "left", background: isHi ? accentDim : "transparent", color: c.ink, transition: "background .1s" }}>
                    <span style={{ width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", background: isHi ? "#fff" : c.bg, color: isHi ? accent : c.inkMid, flexShrink: 0 }}><Icon size={17} /></span>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "block", fontSize: 14.5, fontWeight: 600 }}>{it.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: c.inkLo }}>{it.hint}</span>
                    </span>
                    {isCurrent && <span style={{ fontFamily: FM, fontSize: 10, color: accent, padding: "2px 7px", borderRadius: 6, background: "#fff" }}>current</span>}
                    {isHi && <CornerDownLeft size={15} style={{ color: accent }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "10px 18px", borderTop: `1px solid ${c.cardLine}`, background: c.bg, fontSize: 11.5, color: c.inkLo, fontFamily: FM }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><kbd style={miniKbd}>↑</kbd><kbd style={miniKbd}>↓</kbd> navigate</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><kbd style={miniKbd}>↵</kbd> open</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}><Sparkles size={12} style={{ color: accent }} /> {results.length} results</span>
        </div>
      </div>
    </div>
  );
}
