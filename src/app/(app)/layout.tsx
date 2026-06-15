import { redirect } from "next/navigation";
import { resolveViewer, getSchoolById, displaySchool } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isAdminPlus } from "@/lib/types";
import { accentFor, type Role } from "@/lib/nav/config";
import { loadNavData } from "@/lib/nav/thisWeek";
import AppShell from "@/components/nav/AppShell";

const ROLE_BADGE: Record<Role, string> = {
  super_admin: "Super Admin", admin: "Admin", team_lead: "Team Lead", fellow: "Fellow",
};
const SUBLABEL: Record<Role, string> = {
  super_admin: "Super Admin", admin: "Admin", team_lead: "Team Lead Workspace", fellow: "Fellow Workspace",
};

function initials(s: string): string {
  const p = s.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "OR";
}

// One shell for the whole authenticated area (workspace + console + how-to).
// Role + school are resolved here, server-side, and passed down as data so the
// client shell never guesses.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, real, previewing } = await resolveViewer();
  if (!profile) redirect("/login");
  const role = profile.role as Role;
  const db = createServiceClient();
  const canViewAs = !!real && isAdminPlus(real.role);

  // Satellite/bonus fellows are shown under their tier group with Orr branding,
  // not the arbitrary representative school their school_id points at.
  const school = displaySchool(await getSchoolById(profile.school_id));

  const accent = isAdminPlus(role)
    ? accentFor(role)
    : ((school as any)?.color_primary ?? accentFor(role, (school as any)?.name));

  const brand = isAdminPlus(role)
    ? { label: "Orr Recruiting", sublabel: SUBLABEL[role], crest: "OR", logoUrl: "/orr-emblem.png" as string | null }
    : { label: (school as any)?.name ?? "Workspace", sublabel: SUBLABEL[role], crest: initials((school as any)?.name ?? "Orr"), logoUrl: (school as any)?.logo_url ?? null };

  const [{ data: notifications }, navData, peopleRes] = await Promise.all([
    db.from("notifications").select("id, type, title, body, link, read, created_at").eq("recipient_id", profile.id).order("created_at", { ascending: false }).limit(30),
    loadNavData(profile),
    canViewAs ? db.from("profiles").select("id, full_name, role").eq("is_active", true).order("full_name") : Promise.resolve({ data: [] as any[] }),
  ]);

  return (
    <AppShell
      role={role}
      accent={accent}
      brand={brand}
      user={{ name: profile.full_name, roleBadge: ROLE_BADGE[role], schoolName: isAdminPlus(role) ? null : (school as any)?.name ?? null }}
      badges={navData.badges}
      thisWeek={navData.thisWeek}
      notifications={notifications ?? []}
      viewAs={{ canViewAs, previewing, people: (peopleRes.data ?? []) as { id: string; full_name: string; role: string }[] }}
    >
      {children}
    </AppShell>
  );
}
