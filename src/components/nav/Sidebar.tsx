"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Search, PanelLeftClose, PanelLeft, LogOut, Inbox, ListChecks, ChevronRight,
} from "lucide-react";
import type { NavGroup, BadgeKey } from "@/lib/nav/config";
import type { ThisWeek } from "@/lib/nav/thisWeek";

const t = {
  navy: "#15132b", navy2: "#1c1937", navy3: "#2a2650", navy4: "#332d63",
  textHi: "#eeedf8", textMid: "#a7a3cb", textLo: "#6f6a98", line: "rgba(255,255,255,0.07)",
};
const FD = "'Cabin', sans-serif";
const FM = "'JetBrains Mono', ui-monospace, monospace";

export default function Sidebar({
  groups, accent, brand, user, badges, thisWeek, collapsed, onToggleCollapse, onOpenPalette, onSignOut,
}: {
  groups: NavGroup[]; accent: string;
  brand: { label: string; sublabel: string; crest: string; logoUrl?: string | null };
  user: { name: string; roleBadge: string; schoolName?: string | null };
  badges: Partial<Record<BadgeKey, number>>;
  thisWeek: ThisWeek | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenPalette: () => void;
  onSignOut: () => void;
}) {
  const pathname = usePathname();
  const accentDim = `${accent}29`;
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const kbd = { fontFamily: FM, fontSize: 10.5, padding: "2px 6px", borderRadius: 6, background: "rgba(255,255,255,0.08)", color: t.textMid, border: "1px solid rgba(255,255,255,0.1)" };

  const taskPct = thisWeek && thisWeek.tasksTotal > 0 ? Math.round((thisWeek.tasksDone / thisWeek.tasksTotal) * 100) : 0;

  return (
    <aside style={{ width: collapsed ? 78 : 268, flex: `0 0 ${collapsed ? 78 : 268}px`,
      background: `linear-gradient(180deg, ${t.navy2} 0%, ${t.navy} 100%)`, borderRight: `1px solid ${t.line}`,
      display: "flex", flexDirection: "column", transition: "width .28s cubic-bezier(.4,0,.2,1), flex-basis .28s cubic-bezier(.4,0,.2,1)",
      position: "sticky", top: 0, height: "100vh", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(420px 220px at -10% 15%, ${accent}22, transparent 70%)`, pointerEvents: "none" }} />

      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: collapsed ? "20px 0 16px" : "20px 20px 16px", justifyContent: collapsed ? "center" : "flex-start", position: "relative" }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: accent, display: "grid", placeItems: "center", flexShrink: 0, boxShadow: `0 6px 18px ${accent}55`, overflow: "hidden", fontFamily: FD, fontWeight: 700, color: "#fff", fontSize: 14, letterSpacing: 0.3 }}>
          {brand.logoUrl ? <img src={brand.logoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : brand.crest}
        </div>
        {!collapsed && (
          <div style={{ lineHeight: 1.1, overflow: "hidden" }}>
            <div style={{ fontFamily: FD, fontWeight: 700, fontSize: 16, color: t.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{brand.label}</div>
            <div style={{ fontFamily: FM, fontSize: 9.5, letterSpacing: 1.6, color: accent, textTransform: "uppercase", marginTop: 3, whiteSpace: "nowrap" }}>{brand.sublabel}</div>
          </div>
        )}
      </div>

      {/* This Week card (fellow/lead only) */}
      {thisWeek && (!collapsed ? (
        <Link href="/workspace/snapshot" style={{ textDecoration: "none", margin: "0 16px 10px", border: `1px solid ${t.line}`, background: t.navy3, borderRadius: 14, padding: "13px 14px", display: "block", position: "relative" }}>
          <div style={{ fontFamily: FM, fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", color: accent, marginBottom: 11 }}>This Week</div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: accentDim, display: "grid", placeItems: "center", color: accent, flexShrink: 0 }}><Inbox size={15} /></span>
            <span style={{ flex: 1, lineHeight: 1.1 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: t.textHi }}>{thisWeek.queueCount} queued</span>
              <span style={{ display: "block", fontSize: 11, color: t.textLo }}>Action queue</span>
            </span>
            <ChevronRight size={15} style={{ color: t.textLo }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: t.textMid }}><ListChecks size={14} style={{ color: t.textLo }} /> Tasks</span>
            <span style={{ fontFamily: FM, fontSize: 11.5, color: t.textMid }}>{thisWeek.tasksDone} / {thisWeek.tasksTotal}</span>
          </div>
          <div style={{ height: 5, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{ width: `${taskPct}%`, height: "100%", background: accent, transition: "width .4s ease" }} />
          </div>
        </Link>
      ) : (
        <div style={{ display: "grid", placeItems: "center", padding: "0 0 8px", position: "relative" }}>
          <Link href="/workspace/snapshot" title={`This week: ${thisWeek.queueCount} queued`} style={{ position: "relative", width: 44, height: 44, borderRadius: 12, background: t.navy3, border: `1px solid ${t.line}`, color: accent, display: "grid", placeItems: "center" }}>
            <Inbox size={18} />
            {thisWeek.queueCount > 0 && <span style={{ position: "absolute", top: -4, right: -4, minWidth: 17, height: 17, padding: "0 4px", borderRadius: 9, background: accent, color: "#fff", fontSize: 10, fontFamily: FM, display: "grid", placeItems: "center", border: `2px solid ${t.navy2}` }}>{thisWeek.queueCount}</span>}
          </Link>
        </div>
      ))}

      {/* ⌘K */}
      <div style={{ padding: collapsed ? "0 14px 8px" : "0 16px 10px", position: "relative" }}>
        <button onClick={onOpenPalette} className="orr-ghost"
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: collapsed ? "10px 0" : "10px 12px", justifyContent: collapsed ? "center" : "space-between", background: thisWeek ? "transparent" : t.navy3, border: `1px solid ${t.line}`, borderRadius: 11, cursor: "pointer", color: t.textMid }}>
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}><Search size={16} />{!collapsed && <span style={{ fontSize: 13.5 }}>Jump to…</span>}</span>
          {!collapsed && <kbd style={kbd}>⌘K</kbd>}
        </button>
      </div>

      {/* Nav groups */}
      <nav className="orr-sidebar-scroll" style={{ flex: 1, overflowY: "auto", padding: "4px 14px 12px", position: "relative" }}>
        {groups.map((section, si) => (
          <div key={si} style={{ marginTop: si === 0 ? 0 : 18 }}>
            {section.group && !collapsed && <div style={{ fontFamily: FM, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: t.textLo, padding: "0 10px 8px" }}>{section.group}</div>}
            {section.group && collapsed && si !== 0 && <div style={{ height: 1, background: t.line, margin: "12px 12px" }} />}
            {section.items.map((it, ii) => {
              const active = isActive(it.href);
              const Icon = it.icon;
              const badge = it.badgeKey ? badges[it.badgeKey] : undefined;
              return (
                <Link key={it.id} href={it.href} title={collapsed ? it.label : undefined} aria-current={active ? "page" : undefined} className="orr-navitem"
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, textDecoration: "none",
                    padding: collapsed ? "11px 0" : "10px 12px", justifyContent: collapsed ? "center" : "flex-start",
                    borderRadius: 11, marginBottom: 3, position: "relative",
                    background: active ? t.navy4 : "transparent", color: active ? t.textHi : t.textMid,
                    boxShadow: active ? `inset 0 0 0 1px ${accent}47, 0 4px 16px ${accent}1a` : "none",
                    animation: "orrRise .4s ease both", animationDelay: `${(si * 3 + ii) * 0.035}s` }}>
                  {active && <span style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 20, borderRadius: 4, background: accent }} />}
                  <Icon size={18} style={{ color: active ? accent : "inherit", flexShrink: 0 }} />
                  {!collapsed && <span style={{ fontSize: 14, fontWeight: active ? 600 : 500, flex: 1, whiteSpace: "nowrap" }}>{it.label}</span>}
                  {!collapsed && badge != null && badge > 0 && (
                    <span style={{ fontFamily: FM, fontSize: 10.5, fontWeight: 500, padding: "2px 7px", borderRadius: 7, background: active ? accentDim : "rgba(255,255,255,0.06)", color: active ? accent : t.textLo }}>{badge}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${t.line}`, padding: collapsed ? "12px 14px" : "12px 16px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, justifyContent: collapsed ? "center" : "flex-start" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#3a3470,#5a4fb0)", display: "grid", placeItems: "center", flexShrink: 0, fontFamily: FD, fontWeight: 700, color: "#fff", fontSize: 13 }}>{initials(user.name)}</div>
          {!collapsed && (
            <>
              <div style={{ lineHeight: 1.2, flex: 1, overflow: "hidden" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: t.textHi, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <span style={{ fontFamily: FM, fontSize: 9.5, letterSpacing: 0.6, textTransform: "uppercase", color: accent, padding: "1px 6px", borderRadius: 5, background: accentDim }}>{user.roleBadge}</span>
                  {user.schoolName && <span style={{ fontSize: 11, color: t.textLo }}>· {user.schoolName}</span>}
                </div>
              </div>
              <button onClick={onSignOut} className="orr-ghost" title="Sign out" style={{ background: "transparent", border: "none", color: t.textLo, cursor: "pointer", padding: 6, borderRadius: 8, display: "grid", placeItems: "center" }}><LogOut size={16} /></button>
            </>
          )}
        </div>
        <button onClick={onToggleCollapse} className="orr-ghost" style={{ marginTop: 12, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 8, background: "transparent", border: `1px solid ${t.line}`, borderRadius: 10, color: t.textMid, cursor: "pointer", fontSize: 12 }}>
          {collapsed ? <PanelLeft size={15} /> : <><PanelLeftClose size={15} /> Collapse</>}
        </button>
      </div>
    </aside>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
