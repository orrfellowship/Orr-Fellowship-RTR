"use client";

import { useState, useRef, useEffect } from "react";
import { LifeBuoy } from "lucide-react";
import { requestHelp } from "@/app/(app)/workspace/actions";

const C = {
  navy: "#11123E", orange: "#DD5434", gray: "#303333", grayMute: "#6E7385",
  line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B",
};
const HEAD = "var(--font-head)";

// Free-form "ask an admin for help" popover. Lives in the top bar for fellows and
// team leads (admins are hidden in AppShell). Submitting fans the question out to
// every admin as a notification + an open task on their snapshot.
export default function HelpButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const submit = async () => {
    setSending(true);
    setMsg(null);
    const res = await requestHelp(text);
    setSending(false);
    if ("error" in res && res.error) {
      setMsg({ ok: false, text: res.error });
    } else {
      setMsg({ ok: true, text: "Sent — an admin will follow up." });
      setText("");
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <style>{`
        .orr-help { transition: background .12s, border-color .12s, transform .1s; }
        .orr-help:hover { background: #f0eff7 !important; border-color: #d4d1e8 !important; }
        .orr-help:active { background: #e4e2f2 !important; transform: scale(.93); }
      `}</style>
      <button onClick={() => setOpen((v) => !v)} aria-label="Get help" className="orr-help"
        style={{ position: "relative", border: "1px solid #eceaf2", background: "#ffffff", color: "#211d44", width: 34, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <LifeBuoy size={15} />
      </button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 90, width: 320, maxWidth: "90vw", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, boxShadow: "0 10px 30px rgba(11,12,42,.18)", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontWeight: 700, fontSize: 14, color: C.navy }}>Ask an admin for help</div>
          <div style={{ padding: 14 }}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What do you need help with?"
              rows={4}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.line}`, fontSize: 13, resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }}
            />
            <button onClick={submit} disabled={sending || !text.trim()}
              style={{ width: "100%", marginTop: 10, border: "none", background: C.orange, color: "#fff", fontWeight: 700, padding: 10, borderRadius: 10, cursor: sending || !text.trim() ? "default" : "pointer", fontSize: 13.5, opacity: sending || !text.trim() ? 0.6 : 1 }}>
              {sending ? "Sending…" : "Send to admins"}
            </button>
            {msg && <div style={{ fontSize: 12, color: msg.ok ? C.good : "#C0392B", marginTop: 9, lineHeight: 1.35 }}>{msg.text}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
