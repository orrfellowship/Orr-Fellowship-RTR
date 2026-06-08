// Lightweight assertions for the nav config (§8). Run: npx tsx src/lib/nav/config.test.ts
import { navForRole, flatNav, accentFor, ORR_ORANGE, SCHOOL_ACCENT } from "./config";

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

// admin: Operations = Review Sync only; no Users/Sync
check("admin has Review Sync", ids("admin").includes("review"));
check("admin has NO Users", !ids("admin").includes("users"));
check("admin has NO Sync", !ids("admin").includes("sync"));

// fellow / team_lead: no Operations, lead with Weekly Snapshot
for (const r of ["fellow", "team_lead"] as const) {
  check(`${r} has NO Operations group`, !groups(r).includes("Operations"));
  check(`${r} leads with Weekly Snapshot`, flatNav(r)[0]?.id === "snapshot");
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
