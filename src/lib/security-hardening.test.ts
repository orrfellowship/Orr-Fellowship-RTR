import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const auth = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../db/phase24.sql", import.meta.url), "utf8");
const nav = readFileSync(new URL("./nav/thisWeek.ts", import.meta.url), "utf8");
const consoleActions = readFileSync(new URL("../app/(app)/console/actions.ts", import.meta.url), "utf8");
const workspacePage = readFileSync(new URL("../app/(app)/workspace/[section]/page.tsx", import.meta.url), "utf8");
const workspaceClient = readFileSync(new URL("../app/(app)/workspace/WorkspaceClient.tsx", import.meta.url), "utf8");
const personPicker = readFileSync(new URL("../components/PersonPicker.tsx", import.meta.url), "utf8");

assert.match(auth, /\.eq\("is_active", true\)/, "profile resolution must reject inactive accounts");
assert.match(migration, /drop policy if exists profiles_self_update/i, "self-service protected profile writes must be removed");
assert.match(nav, /from\("profiles"\)[\s\S]*?\.eq\("is_active", true\)/, "the users badge must count active profiles only");
assert.match(
  consoleActions,
  /export async function listCandidates[\s\S]*?const \{ profile \} = await resolveViewer\(\)/,
  "candidate list reads must honor the effective View As profile",
);
assert.match(workspacePage, /previewMode=\{!!previewing\}/, "workspace pages must pass View As state to interactive controls");
assert.match(workspaceClient, /disabled=\{previewMode\}/, "point-person picker must be read-only in View As");
assert.match(workspaceClient, /ActionToast/, "assignment errors must be visible instead of silently discarded");
assert.match(personPicker, /aria-disabled=\{disabled\}/, "disabled person pickers must expose their state accessibly");

console.log("security hardening checks passed");
