import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DIGEST_LIST_LIMIT,
  FIRST_ALLOWED_DIGEST_AT,
  easternLocalDay,
  parseDryRunPreviewAt,
  renderAssignmentDigest,
  weeklyDigestPeriod,
  type AssignmentDigestEvent,
} from "./weekly-assignment-digest";

function event(index: number): AssignmentDigestEvent {
  return {
    id: `event-${String(index).padStart(3, "0")}`,
    candidate_id: `candidate-${index}`,
    candidate_name: index === 0 ? "Avery <script>" : `Candidate ${String(index).padStart(3, "0")}`,
    school_name: "Purdue & Friends",
    university_raw: null,
    changed_at: "2026-07-19T12:00:00.000Z",
  };
}

{
  assert.equal(
    parseDryRunPreviewAt("2026-07-20T12:00:00.000Z")?.toISOString(),
    "2026-07-20T12:00:00.000Z",
  );
  assert.equal(parseDryRunPreviewAt("2026-07-20T11:59:59.000Z"), null);
  assert.equal(parseDryRunPreviewAt("2026-07-21T12:00:00.000Z"), null);
  assert.equal(parseDryRunPreviewAt("not-a-date"), null);
}

{
  const period = weeklyDigestPeriod(new Date("2026-07-20T12:00:00.000Z"));
  assert.ok(period, "first permitted Monday at 08:00 EDT should run");
  assert.equal(period.start.toISOString(), "2026-07-13T12:00:00.000Z");
  assert.equal(period.end.toISOString(), FIRST_ALLOWED_DIGEST_AT.toISOString());
  assert.equal(weeklyDigestPeriod(new Date("2026-07-20T11:59:59.000Z")), null);
  assert.equal(weeklyDigestPeriod(new Date("2026-07-20T13:00:00.000Z")), null);
}

// Spring-forward week: both endpoints remain 08:00 Eastern even though the UTC
// offset changes from -05:00 to -04:00.
{
  const period = weeklyDigestPeriod(new Date("2027-03-15T12:00:00.000Z"));
  assert.ok(period);
  assert.equal(period.start.toISOString(), "2027-03-08T13:00:00.000Z");
  assert.equal(period.end.toISOString(), "2027-03-15T12:00:00.000Z");
}

// Fall-back week has the inverse offset change and must also remain at 08:00.
{
  const period = weeklyDigestPeriod(new Date("2027-11-08T13:00:00.000Z"));
  assert.ok(period);
  assert.equal(period.start.toISOString(), "2027-11-01T12:00:00.000Z");
  assert.equal(period.end.toISOString(), "2027-11-08T13:00:00.000Z");
  assert.equal(easternLocalDay(new Date("2026-11-02T04:30:00.000Z")), "2026-11-01");
  assert.equal(easternLocalDay(new Date("2026-11-02T05:30:00.000Z")), "2026-11-02");
}

{
  const events = Array.from({ length: 75 }, (_, index) => event(index));
  const period = weeklyDigestPeriod(new Date("2026-07-20T12:05:00.000Z"));
  assert.ok(period);
  const rendered = renderAssignmentDigest({ recipientName: "Will Messmer", events, period, siteUrl: "https://rtr.example" });
  assert.equal(rendered.eventCount, 75);
  assert.equal(rendered.shownCount, DIGEST_LIST_LIMIT);
  assert.equal(rendered.hiddenCount, 25);
  assert.match(rendered.html, /Plus 25 more/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /Avery &lt;script&gt;/);
  assert.match(rendered.html, /Purdue &amp; Friends/);
  assert.match(rendered.html, /https:\/\/rtr\.example\/workspace/);
}

// Migration/source contracts protect the incident-critical behaviors even when
// a disposable Postgres instance is not available in CI.
{
  const root = process.cwd();
  const sql = fs.readFileSync(path.join(root, "db/phase18.sql"), "utf8");
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /attempt_count between 0 and 3/i);
  assert.match(sql, /where dedupe_key is not null and emailed_at is null and superseded = false/i);
  assert.match(sql, /old\.point_person_id is not distinct from new\.point_person_id/i);
  assert.match(sql, /unique \(candidate_id, assignment_version\)/i);
  assert.match(sql, /'assignment\/' \|\| new\.id::text \|\| '\/' \|\| new\.assignment_version::text/i);
  assert.match(sql, /status = 'superseded'/i);
  assert.match(sql, /current.*point_person_id|c\.point_person_id = e\.new_owner_id/is);
  assert.match(sql, /used >= 10/i);
  assert.match(sql, /provider_attempt_started_at > now\(\) - interval '23 hours'/i);
  assert.match(sql, /enabled, hard_paused, pause_reason/i);

  const workspaceActions = fs.readFileSync(path.join(root, "src/app/(app)/workspace/actions.ts"), "utf8");
  const consoleActions = fs.readFileSync(path.join(root, "src/app/(app)/console/actions.ts"), "utf8");
  assert.doesNotMatch(workspaceActions, /queueClaimNudge|type:\s*["']claim_followup/);
  assert.doesNotMatch(consoleActions, /queueClaimNudge|type:\s*["']claim_followup/);

  const cron = fs.readFileSync(path.join(root, "src/app/api/cron/route.ts"), "utf8");
  assert.match(cron, /job === "outreach"/);
  assert.match(cron, /job === "gmail-sync"/);
  assert.doesNotMatch(cron, /sendEmail|flushDue|runDigests|claim_transactional/);
  assert.match(cron, /Unknown cron job/);

  const transactionalCron = fs.readFileSync(path.join(root, "src/app/api/cron/transactional/route.ts"), "utf8");
  assert.match(transactionalCron, /previewAtInput && !dryRun/);
  assert.match(transactionalCron, /runWeeklyAssignmentDigest\(\{ dryRun, now: previewAt \?\? undefined \}\)/);
}

console.log("weekly assignment digest tests passed");
