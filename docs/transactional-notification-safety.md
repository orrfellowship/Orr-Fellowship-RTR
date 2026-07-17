# Transactional notification containment and Phase 18 runbook

Status: **contained; replacement sending remains disabled**.

This runbook covers only Resend transactional email and its in-app events. Gmail
campaign delivery remains on `outreach_campaigns`, `outreach_sends`,
`claim_outreach_sends`, `/api/cron?job=outreach`, and the `src/lib/gmail/`
modules. Phase 18 neither references nor modifies those objects.

## Production containment evidence (July 17, 2026)

Before containment, `notifications` contained:

- 911 active unsent rows (`emailed_at is null and superseded = false`), all
  `claim_followup` assignment notices.
- 721 of those rows targeted `william.messmer@orrfellowship.org`.
- 87 other unsent rows were already superseded.
- 405 sent, active rows and 5 sent, superseded rows.
- The active backlog ranged from June 15 through July 13, 2026.

Recipient counts for the 911 active rows were: Will Messmer 721, Lily Renke 46,
Chris Combs 30, Norah Aalsma 30, Matthew Fritton 20, Kayla Malmquist 17, Mark
Stolte 16, Max Rosa 10, Dylan Haslett 9, Quin Sholar 4, Audrey Grimm 4, and one
each for Andres Peralta, Avery Toole, Brooklyn Cornelius, and Emiliano
Quintanilla.

Containment set `superseded = true` on exactly those 911 active unsent
`claim_followup` rows. Verification immediately afterward showed:

- Active unsent transactional queue: **0**.
- Preserved sent rows: **410**.
- Preserved unsent/superseded audit rows: **998**.
- Gmail baseline before and after: **6 outreach campaigns, 286 outreach sends**.

Preservation of all 998 superseded unsent rows was explicitly confirmed as the
audit-evidence policy. The rows were not deleted because the legacy schema has no attempted/failed
status or attempt table. A never-attempted row and a failed Resend attempt both
have `emailed_at is null`; deleting either group without another source of truth
would violate the requirement to preserve failed historical evidence. The 911
were therefore made non-sendable while retaining all incident evidence.

## Root cause and removed paths

The former `/api/cron` defaulted to `flush`, selected up to 200 due rows without
a claim or lease, called Resend, and updated `emailed_at` afterward without
checking persistence success. Failures stayed eligible forever. Concurrent runs
could select the same rows, and provider acceptance followed by a failed local
update caused another provider call. The assignment actions queued a
`claim_followup` even when an UPDATE saved the same owner, while deduplication
was a read followed by an unconstrained insert. Fixing cron authentication made
the accumulated rows reachable at the next five-minute invocation.

Phase 18 makes `flush`, `digest`, `test`, and the default cron branch return 404.
It removes `queueClaimNudge` and captures effective owner changes with a
database trigger and monotonic `assignment_version` instead.

## Phase 18 design

- `assignment_change_events` snapshots candidate and school context. The unique
  `(candidate_id, assignment_version)` plus stable event key is the database
  idempotency boundary. X → Y → X remains three legitimate versions.
- Reassignments away are marked `superseded`; only the owner at the weekly
  cutoff can receive the candidate.
- `transactional_digest_jobs` stores immutable recipient/period payload data,
  attempt state, claim token, lease, provider ID, and stable Resend key.
- `claim_transactional_digest_jobs` atomically uses `FOR UPDATE SKIP LOCKED`.
  Expired claims recover; accepted/uncertain sends can only be reclaimed inside
  a 23-hour safety window, shorter than Resend's 24-hour idempotency retention.
- `transactional_send_reservations` uses an Eastern local day and a transaction
  advisory lock per recipient/day before enforcing the limit of 10.
- Three attempts is an absolute maximum. Exhaustion or provider-accepted/local-
  finalize inconsistency hard-pauses assignment/generic sends and creates
  deduplicated Super Admin in-app plus capped/idempotent email alert jobs. Alert
  failures never create more alerts.
- Initial breaker thresholds: 25 jobs/run, 25 recipients/run, 200 assignment
  events/recipient, and 50 pending jobs. Threshold violations hard-pause before
  sending.
- Digest output lists at most 50 candidate names and school/university context,
  then links to the recipient's own RTR workspace for the complete set.
- New digest jobs are created only in Monday's 08:00
  `America/New_York` hour. The first code-permitted cutoff is July 20, 2026 at
  08:00 EDT (`2026-07-20T12:00:00Z`). A five-minute poll schedule supports
  short retries and operational alerts without using a fixed UTC digest time.

## Apply and verify (do not enable yet)

1. Confirm the legacy active queue is still zero and snapshot notification and
   Gmail table counts.
2. Apply [`db/phase18.sql`](../db/phase18.sql). It unschedules only `orr-flush`
   and `orr-digest`; it does not create the replacement schedule.
3. Verify `transactional_worker_control` is `enabled = false` and
   `hard_paused = true`.
4. Deploy the application with `TRANSACTIONAL_SENDING_ENABLED=false` and
   `TRANSACTIONAL_MAX_JOBS_PER_RUN=25`.
5. Confirm authenticated calls to `/api/cron?job=flush`, `?job=digest`, and
   `?job=test` return 404. Confirm `?job=outreach` and `?job=gmail-sync` retain
   their existing Gmail behavior.
6. Invoke an authenticated production preview before enablement with
   `/api/cron/transactional?dryRun=true&previewAt=2026-07-20T12:00:00.000Z`.
   `previewAt` is accepted only for a dry run and must resolve to Monday's 08:00
   `America/New_York` hour. Review only recipient IDs and
   event/shown/hidden counts; no queue mutation or provider call is made.
7. Exercise a controlled development recipient through success, retry,
   exhaustion, cap, lease recovery, and accepted/finalize-failure paths. Confirm
   provider IDs and attempt records. The isolated PostgreSQL coverage is run by
   `npm run test:transactional:integration`; it applies the migration to a
   disposable PostgreSQL 17 container and never calls Resend or production.

## Explicit enablement after review

Do not perform these steps until every verification above is approved.

1. Set `TRANSACTIONAL_SENDING_ENABLED=true` in the production deployment.
2. Schedule the protected route with Supabase `pg_cron`:

   ```sql
   select cron.schedule('orr-weekly-assignment-digest', '*/5 * * * *', $$
     select net.http_post(
       url := 'https://YOUR_SITE_URL/api/cron/transactional',
       headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
     );
   $$);
   ```

3. Explicitly unpause the database worker:

   ```sql
   update public.transactional_worker_control
   set enabled = true, hard_paused = false, pause_reason = null,
       paused_at = null, updated_at = now()
   where worker_name = 'weekly-assignment-digest';
   ```

4. Watch the structured run summary and stop immediately on a breaker, cap,
   persistence inconsistency, unexpected recipient count, or provider failure.
