"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { navForRole, flatNav, type Role, type BadgeKey } from "@/lib/nav/config";
import type { ThisWeek } from "@/lib/nav/thisWeek";
import { setViewAs } from "@/app/(app)/console/actions";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import NotificationBell, { type AppNotification } from "@/components/NotificationBell";

const C = { bg: "#F7F8FB", card: "#ffffff", cardLine: "#eceaf2", ink: "#211d44", inkLo: "#938fad", inkMid: "#5c5878" };
const FM = "'JetBrains Mono', ui-monospace, monospace";

const STORAGE_KEY = "orr-nav-collapsed";

export default function AppShell({
  role, accent, brand, user, badges, thisWeek, notifications, viewAs, children,
}: {
  role: Role; accent: string;
  brand: { label: string; sublabel: string; crest: string; logoUrl?: string | null };
  user: { name: string; roleBadge: string; schoolName?: string | null };
  badges: Partial<Record<BadgeKey, number>>;
  thisWeek: ThisWeek | null;
  notifications: AppNotification[];
  viewAs?: { canViewAs: boolean; previewing: { realName: string; asName: string } | null; people: { id: string; full_name: string; role: string }[] };
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Build nav client-side (Lucide icon components aren't serializable as props).
  const groups = useMemo(() => navForRole(role), [role]);
  const flat = useMemo(() => flatNav(role), [role]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
      // Default to the icon rail on small screens (no stored preference yet).
      else if (stored == null && window.matchMedia("(max-width: 820px)").matches) setCollapsed(true);
    } catch {}
  }, []);
  const toggleCollapse = () => setCollapsed((v) => { const n = !v; try { localStorage.setItem(STORAGE_KEY, n ? "1" : "0"); } catch {} return n; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); }
      if (e.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const signOut = async () => { await createClient().auth.signOut(); router.push("/login"); };
  const exitViewAs = () => { setViewAs(null).then(() => { router.push("/console/overview"); router.refresh(); }); };

  const activeItem = useMemo(
    () => flat.find((i) => pathname === i.href || pathname.startsWith(i.href + "/")) ?? null,
    [flat, pathname],
  );
  const activeHref = activeItem?.href ?? pathname;

  return (
    <div style={{ ["--accent" as any]: accent, display: "flex", minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "'Open Sans', sans-serif" }}>
      <NavStyles />
      <Sidebar
        groups={groups} accent={accent} brand={brand} user={user} badges={badges} thisWeek={thisWeek}
        collapsed={collapsed} onToggleCollapse={toggleCollapse} onOpenPalette={() => setPaletteOpen(true)} onSignOut={signOut}
      />

      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", maxHeight: "100vh", overflow: "hidden" }}>
        {viewAs?.previewing && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 28px", background: "#211d44", color: "#fff", fontSize: 13, flexShrink: 0 }}>
            <span aria-hidden>👁</span>
            <span style={{ flex: 1 }}>Viewing as <b>{viewAs.previewing.asName}</b> — read-only preview.</span>
            <button onClick={() => exitViewAs()} style={{ border: "1px solid rgba(255,255,255,.3)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 12.5, padding: "5px 12px", borderRadius: 8, cursor: "pointer" }}>Exit preview</button>
          </div>
        )}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 28px", borderBottom: `1px solid ${C.cardLine}`, background: "rgba(255,255,255,0.72)", backdropFilter: "blur(8px)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: C.inkLo, fontFamily: FM, minWidth: 0 }}>
            {activeItem && <><span style={{ whiteSpace: "nowrap" }}>{activeItem.group}</span><span style={{ color: C.cardLine }}>/</span><span style={{ color: C.ink, fontWeight: 500, whiteSpace: "nowrap" }}>{activeItem.label}</span></>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <button onClick={() => setPaletteOpen(true)} className="orr-lift" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", borderRadius: 10, border: `1px solid ${C.cardLine}`, background: C.card, color: C.inkMid, cursor: "pointer", fontSize: 13 }}>
              <Search size={15} /> <span className="orr-hide-sm">Search</span> <kbd style={{ fontFamily: FM, fontSize: 10.5, padding: "2px 6px", borderRadius: 6, background: C.bg, color: C.inkLo, border: `1px solid ${C.cardLine}` }}>⌘K</kbd>
            </button>
            {viewAs?.canViewAs && <ViewAsControl people={viewAs.people} previewing={!!viewAs.previewing} />}
            <NotificationBell notifications={notifications} />
          </div>
        </header>

        <div style={{ flex: 1, overflowY: "auto" }} className="orr-scroll">
          {children}
        </div>
      </main>

      {paletteOpen && <CommandPalette items={flat} activeHref={activeHref} accent={accent} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

function ViewAsControl({ people, previewing }: { people: { id: string; full_name: string; role: string }[]; previewing: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const list = q.trim() ? people.filter((p) => p.full_name.toLowerCase().includes(q.trim().toLowerCase())) : people;
  const pick = (id: string) => { setViewAs(id).then(() => { setOpen(false); router.push("/workspace/snapshot"); router.refresh(); }); };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} title="View the app as another person"
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 12px", borderRadius: 10, border: `1px solid ${previewing ? "#211d44" : C.cardLine}`, background: previewing ? "#211d44" : C.card, color: previewing ? "#fff" : C.inkMid, cursor: "pointer", fontSize: 13 }}>
        <Eye size={15} /> <span className="orr-hide-sm">View as</span>
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 30, top: "calc(100% + 6px)", right: 0, width: 260, background: C.card, border: `1px solid ${C.cardLine}`, borderRadius: 12, boxShadow: "0 8px 24px rgba(17,18,62,.14)", padding: 8 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" autoFocus
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.cardLine}`, fontSize: 13, boxSizing: "border-box", marginBottom: 6 }} />
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {list.map((p) => (
              <button key={p.id} onClick={() => pick(p.id)}
                style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8, border: "none", background: "transparent", cursor: "pointer", padding: "8px 10px", borderRadius: 8, textAlign: "left" }}>
                <span style={{ fontSize: 13.5, color: C.ink }}>{p.full_name}</span>
                <span style={{ fontSize: 10.5, color: C.inkLo, textTransform: "capitalize" }}>{p.role.replace("_", " ")}</span>
              </button>
            ))}
            {list.length === 0 && <div style={{ padding: "8px 10px", fontSize: 13, color: C.inkLo }}>No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function NavStyles() {
  return (
    <style>{`
      @keyframes orrRise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @keyframes orrFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes orrPop { from { opacity: 0; transform: translateY(-8px) scale(.98); } to { opacity: 1; transform: none; } }
      .orr-navitem:hover { background: #2a2650 !important; color: #eeedf8 !important; }
      .orr-ghost:hover { background: #2a2650 !important; color: #eeedf8 !important; }
      .orr-lift { transition: transform .12s ease, box-shadow .12s ease; }
      .orr-lift:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(33,29,68,0.12); }
      .orr-scroll::-webkit-scrollbar { width: 9px; }
      .orr-scroll::-webkit-scrollbar-thumb { background: #e2e0ec; border-radius: 8px; }
      .orr-sidebar-scroll::-webkit-scrollbar { width: 5px; }
      .orr-sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
      .orr-sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.22); border-radius: 99px; }
      .orr-sidebar-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.35); }
      @media (max-width: 720px) { .orr-hide-sm { display: none; } }
    `}</style>
  );
}
