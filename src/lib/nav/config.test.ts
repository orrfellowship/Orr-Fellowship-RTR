// Lightweight assertions for the nav config (§8). Run: npx tsx src/lib/nav/config.test.ts
import {
  navForRole, flatNav, accentFor, canAccessConsoleSection, canAccessWorkspaceSection,
  WORKSPACE_SECTIONS, ORR_ORANGE, SCHOOL_ACCENT,
} from "./config";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) { console.log(`  ok  ${name}`); }
  else { console.error(`FAIL  ${name}`); failures++; }
}
const ids = (role: any) => flatNav(role).map((i) => i.id);
const groups = (role: any) => navForRole(role).map((g) => g.group).filter(Boolean);

// super_admin: Operations has Users AND Sync
check("super_admin has Users + Sync", ids("super_admin").includes("users") && ids("super_admin").includes("sync"));
check("super_admin Operations group present", groups("super_admin").includes("Operations"));
check("super_admin has Campaign History", ids("super_admin").includes("campaign-history"));

// admin: Operations includes Users + Review Sync; JazzHR Sync stays super-only
check("admin has Review Sync", ids("admin").includes("review"));
check("admin has Users", ids("admin").includes("users"));
check("admin has Campaign History", ids("admin").includes("campaign-history"));
check("admin has NO Sync", !ids("admin").includes("sync"));
check("admin can access Campaign History", canAccessConsoleSection("admin", "campaign-history"));
check("admin can access Email Campaigns", canAccessConsoleSection("admin", "email-campaigns"));
check("super_admin can access Email Campaigns", canAccessConsoleSection("super_admin", "email-campaigns"));

const recruitingIds = (role: any) => navForRole(role).find((g) => g.group === "Recruiting")?.items.map((i) => i.id) ?? [];
const expectedConsoleRecruiting = "applicants,email-campaigns,standings,schools,calendar";
check("admin Recruiting order includes Email Campaigns", recruitingIds("admin").join(",") === expectedConsoleRecruiting);
check("super_admin Recruiting order includes Email Campaigns", recruitingIds("super_admin").join(",") === expectedConsoleRecruiting);
check("workspace sections include Email Campaigns (fellows email their candidates)", (WORKSPACE_SECTIONS as readonly string[]).includes("email-campaigns"));

// fellow / team_lead: no Operations, lead with Weekly Snapshot
for (const r of ["fellow", "team_lead"] as const) {
  check(`${r} has NO Operations group`, !groups(r).includes("Operations"));
  check(`${r} leads with Weekly Snapshot`, flatNav(r)[0]?.id === "snapshot");
  check(`${r} HAS an Email Campaigns nav item`, ids(r).includes("email-campaigns"));
  check(`${r} can access the workspace Email Campaigns section`, canAccessWorkspaceSection(r, "email-campaigns"));
  check(`${r} cannot access the CONSOLE Email Campaigns section`, !canAccessConsoleSection(r, "email-campaigns"));
  check(`${r} cannot access Campaign History`, !canAccessConsoleSection(r, "campaign-history"));
}

// palette results ⊆ allowed routes (flatNav IS the palette source, so trivially a subset of itself,
// but assert every palette href is a real nav href for that role)
for (const r of ["super_admin", "admin", "team_lead", "fellow"] as const) {
  const hrefs = new Set(navForRole(r).flatMap((g) => g.items.map((i) => i.href)));
  check(`${r} palette ⊆ allowed routes`, flatNav(r).every((i) => hrefs.has(i.href)));
}

// accentFor
check("accentFor super_admin = orange", accentFor("super_admin") === ORR_ORANGE);
check("accentFor admin = orange", accentFor("admin") === ORR_ORANGE);
check("accentFor fellow IU = crimson", accentFor("fellow", "IU") === SCHOOL_ACCENT.IU);
check("accentFor fellow unknown = default", accentFor("fellow", "Nowhere U") === SCHOOL_ACCENT.default);

console.log(failures === 0 ? "\nAll nav config checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
