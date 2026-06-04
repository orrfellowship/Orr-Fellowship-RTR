"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { C, HEAD } from "./constants";
import type { School } from "./types";

const TABS = [
  ["/workspace/dashboard", "Weekly Snapshot"],
  ["/workspace/school-board", "My School"],
  ["/workspace/playbook", "Playbook"],
  ["/workspace/standings", "Standings"],
  ["/workspace/applicants", "Applicants"],
] as const;

export default function WorkspaceNav({
  school, groupName, fullName, role, accent,
}: {
  school: School | null;
  groupName: string | null;
  fullName: string;
  role: string;
  accent: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingTab, setPendingTab] = useState<string | null>(null);

  useEffect(() => {
    setPendingTab(null);
  }, [pathname]);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  return (
    <div style={{ background: C.navy, padding: "0 28px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <div style={{ padding: "14px 0", display: "flex", alignItems: "center", gap: 10 }}>
            {school?.logo_url && (
              <img src={school.logo_url} alt={school.name} style={{ height: 32, width: 32, objectFit: "contain", borderRadius: 6, background: "rgba(255,255,255,.12)", padding: 3 }} />
            )}
            <div>
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16, color: "#fff" }}>{groupName ?? school?.name ?? "Orr Recruiting"}</div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: "rgba(255,255,255,.45)", textTransform: "uppercase" }}>
                {role === "team_lead" ? "Team Lead" : "Fellow"} Workspace
              </div>
            </div>
          </div>
          {TABS.map(([href, label]) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            const pending = pendingTab === href && !active;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => {
                  if (!active) setPendingTab(href);
                }}
                style={{
                  textDecoration: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "15px 0",
                  fontFamily: HEAD,
                  fontSize: 14.5,
                  fontWeight: active ? 700 : 600,
                  color: active || pending ? "#fff" : "rgba(255,255,255,.55)",
                  borderBottom: active ? `3px solid ${accent}` : "3px solid transparent",
                  display: "inline-block",
                  opacity: active ? 1 : pending ? 0.85 : 0.8,
                  background: pending ? "rgba(255,255,255,.08)" : "transparent",
                  transition: "color 0.15s ease, opacity 0.15s ease, background 0.15s ease",
                }}
              >
                {label}
              </Link>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{fullName}</div>
          <button onClick={signOut} style={{ border: "1px solid rgba(255,255,255,.3)", background: "transparent", color: "rgba(255,255,255,.75)", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 8, cursor: "pointer" }}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
