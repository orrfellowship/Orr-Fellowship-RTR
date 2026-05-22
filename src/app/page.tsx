import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";

// The single entry point. Routes each role to the right workspace.
// Fellow & Team Lead → /workspace (school-scoped)
// Admin & Super-Admin → /console (org-wide)
export default async function Home() {
  const profile = await getCurrentProfile();

  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/login?inactive=1");

  switch (profile.role) {
    case "super_admin":
    case "admin":
      redirect("/console");
    case "team_lead":
    case "fellow":
      redirect("/workspace");
    default:
      redirect("/login");
  }
}
