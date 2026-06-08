"use client";

import { useState, useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { navForRole, flatNav, type Role, type BadgeKey } from "@/lib/nav/config";
import type { ThisWeek } from "@/lib/nav/thisWeek";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import NotificationBell, { type AppNotification } from "@/components/NotificationBell";

const C = { bg: "#F7F8FB", card: "#ffffff", cardLine: "#eceaf2", ink: "#211d44", inkLo: "#938fad", inkMid: "#5c5878" };
const FM = "'JetBrains Mono', ui-monospace, monospace";

const STORAGE_KEY = "orr-nav-collapsed";

export default function AppShell({
  role, accent, brand, user, badges, thisWeek, notifications, children,
}: {
  role: Role; accent: string;
  brand: { label: string; sublabel: string; crest: string; logoUrl?: string | null };
  user: { name: string; roleBadge: string; schoolName?: string | null };
  badges: Partial<Record<BadgeKey, number>>;
  thisWeek: ThisWeek | null;
  notifications: AppNotification[];
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
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 28px", borderBottom: `1px solid ${C.cardLine}`, background: "rgba(255,255,255,0.72)", backdropFilter: "blur(8px)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: C.inkLo, fontFamily: FM, minWidth: 0 }}>
            {activeItem && <><span style={{ whiteSpace: "nowrap" }}>{activeItem.group}</span><span style={{ color: C.cardLine }}>/</span><span style={{ color: C.ink, fontWeight: 500, whiteSpace: "nowrap" }}>{activeItem.label}</span></>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <button onClick={() => setPaletteOpen(true)} className="orr-lift" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", borderRadius: 10, border: `1px solid ${C.cardLine}`, background: C.card, color: C.inkMid, cursor: "pointer", fontSize: 13 }}>
              <Search size={15} /> <span className="orr-hide-sm">Search</span> <kbd style={{ fontFamily: FM, fontSize: 10.5, padding: "2px 6px", borderRadius: 6, background: C.bg, color: C.inkLo, border: `1px solid ${C.cardLine}` }}>⌘K</kbd>
            </button>
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
      @media (max-width: 720px) { .orr-hide-sm { display: none; } }
    `}</style>
  );
}
