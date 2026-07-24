"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { markNotificationsRead } from "@/app/(app)/workspace/actions";
import { sendTestNotification } from "@/app/(app)/console/actions";

const C = {
  navy: "#11123E", orange: "#DD5434", gray: "#303333", grayMute: "#6E7385",
  line: "#E4E7EE", canvas: "#F7F8FB", good: "#2F8F6B",
};
const HEAD = "var(--font-head)";

export type AppNotification = {
  id: string; type: string; title: string; body: string | null;
  link: string | null; read: boolean; created_at: string;
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return d === 1 ? "yesterday" : `${d}d ago`;
}

export default function NotificationBell({ notifications, canTest = false }: { notifications: AppNotification[]; canTest?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Optimistically cleared ids: the moment the panel opens we mark everything
  // read locally so the badge drops to 0 immediately, without waiting on the
  // server round-trip / route refetch (which is what left the count "stuck").
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set());
  const isRead = (n: AppNotification) => n.read || clearedIds.has(n.id);
  const unread = notifications.filter((n) => !isRead(n)).length;

  const sendTest = async () => {
    setTesting(true);
    setTestMsg(null);
    const res = await sendTestNotification();
    setTesting(false);
    if ("error" in res && res.error) {
      setTestMsg(res.error);
    } else {
      const email = "email" in res ? res.email : undefined;
      setTestMsg(
        !email?.configured ? "Added to your bell. Email isn't configured, so none was sent."
        : email.ok ? "Sent — check your bell and inbox."
        : `Added to your bell, but the email failed: ${email.error ?? "unknown error"}.`
      );
      router.refresh();
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const openPanel = () => {
    setOpen((v) => {
      const next = !v;
      if (next && unread > 0) {
        // Clear the badge instantly, then persist server-side.
        setClearedIds((prev) => { const s = new Set(prev); for (const n of notifications) if (!n.read) s.add(n.id); return s; });
        startTransition(() => { markNotificationsRead([]).then(() => router.refresh()); });
      }
      return next;
    });
  };

  const go = (link: string | null) => { setOpen(false); if (link) router.push(link); };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <style>{`
        .orr-bell { transition: background .12s, border-color .12s, transform .1s; }
        .orr-bell:hover { background: #f0eff7 !important; border-color: #d4d1e8 !important; }
        .orr-bell:active { background: #e4e2f2 !important; transform: scale(.93); }
      `}</style>
      <button onClick={openPanel} aria-label="Notifications" className="orr-bell"
        style={{ position: "relative", border: "1px solid #eceaf2", background: "#ffffff", color: "#211d44", width: 34, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Bell size={15} />
        {unread > 0 && (
          <span style={{ position: "absolute", top: -6, right: -6, minWidth: 17, height: 17, padding: "0 4px", borderRadius: 999, background: C.orange, color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{unread > 9 ? "9+" : unread}</span>
        )}
      </button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 90, width: 340, maxWidth: "90vw", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, boxShadow: "0 10px 30px rgba(11,12,42,.18)", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, fontFamily: HEAD, fontWeight: 700, fontSize: 14, color: C.navy }}>Notifications</div>
          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            {notifications.length === 0 ? (
              <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: C.grayMute }}>You're all caught up.</div>
            ) : notifications.map((n) => (
              <div key={n.id} onClick={() => go(n.link)}
                style={{ padding: "11px 16px", borderBottom: `1px solid ${C.line}`, cursor: n.link ? "pointer" : "default", background: isRead(n) ? "#fff" : C.canvas, display: "flex", gap: 10 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: isRead(n) ? "transparent" : C.orange, marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.gray }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: 12.5, color: C.grayMute, marginTop: 1 }}>{n.body}</div>}
                  <div style={{ fontSize: 11, color: "#A0A6B8", marginTop: 3 }}>{timeAgo(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
          {canTest && (
            <div style={{ padding: "10px 16px", borderTop: `1px solid ${C.line}`, background: C.canvas }}>
              <button onClick={sendTest} disabled={testing}
                style={{ width: "100%", border: `1px solid ${C.line}`, background: "#fff", color: C.navy, fontSize: 12.5, fontWeight: 700, padding: "8px 10px", borderRadius: 8, cursor: testing ? "default" : "pointer", opacity: testing ? 0.6 : 1 }}>
                {testing ? "Sending…" : "Send myself a test notification"}
              </button>
              {testMsg && <div style={{ fontSize: 11.5, color: C.grayMute, marginTop: 7, lineHeight: 1.35 }}>{testMsg}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
