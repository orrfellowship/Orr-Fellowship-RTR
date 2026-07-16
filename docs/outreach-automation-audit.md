# Outreach automation audit — 2026-07-16

## Outcome

The partial campaign was caused primarily by the scheduled worker being redirected to login before it reached its own `CRON_SECRET` authorization. Production logged 1,490 requests to `/api/cron` returning HTTP 307 in the preceding 24 hours. The enqueue request's short post-response drain sent the first group, but the scheduled worker never resumed the remaining queue.

All 226 queued rows were deliberately changed to `canceled` during incident containment. Production currently has zero queued outreach sends. Nothing in this hardening change enqueues or sends a message.

## Production campaign reconciliation

| Campaign | Total | Sent | Canceled | Queued |
| --- | ---: | ---: | ---: | ---: |
| Fall 2026 Outreach, 2026-07-16 15:50 UTC | 149 | 48 | 101 | 0 |
| Fall 2026 Outreach, 2026-07-16 18:52 UTC | 125 | 0 | 125 | 0 |

Across all campaigns, 59 sends have a recorded successful Gmail message. The safe re-test population is 99 unique recipients: canceled in the original campaign and never recorded as sent in any campaign. The later 125-recipient attempt reduces to the same 99-person set after excluding every address ever recorded as sent.

Audit exports are intentionally outside the repository:

- `/private/tmp/orr-sent-outreach-messages-2026-07-16.csv` — all 59 recorded sends
- `/private/tmp/orr-unsent-retest-recipients-2026-07-16.csv` — 99 deduplicated, never-sent recipients

## Defects found and remediations

1. **Cron blocked by authentication proxy.** `/api/cron` now bypasses interactive Supabase session middleware and continues to enforce its route-level bearer secret.
2. **Overlapping workers could claim the same rows.** `claim_outreach_sends` now claims and leases rows atomically with `FOR UPDATE SKIP LOCKED`; only `service_role` can execute it. The migration is already applied in production.
3. **Fellows could enqueue but not poll status.** Active RTR users can poll campaigns they are permitted to read by RLS.
4. **Status query errors looked like completed campaigns.** Campaign and recipient read errors now return HTTP 500 instead of empty/successful results.
5. **Canceled rows could be shown as sent.** They now map to excluded, and the client no longer converts unknown pending rows to sent.
6. **OAuth returned fellows to an admin-only URL.** OAuth and disconnect redirects are role-aware, and the workspace displays connection results.
7. **Terminal-only campaigns never finalized.** Campaigns containing only invalid, DNC, or quota-excluded rows finalize during enqueue.
8. **Concurrent idempotent submissions could report a false failure.** A unique-key race now re-reads and replays the winning campaign.
9. **Database errors were widely ignored.** Queue state reads and writes now check and surface Supabase errors.
10. **A database error after Gmail acceptance was labeled as a Gmail failure.** Gmail sending and sent-state persistence are separated; persistence is retried three times and then fails the worker visibly without marking the row failed.
11. **Background-drain errors were silent.** Cron and post-response drains now emit structured logs with event names, summaries, duration, and request IDs, without recipient content or credentials.
12. **Reply polling starved campaigns larger than 60.** Poll cursors now rotate checks across all open threads instead of selecting the same newest 60 indefinitely.
13. **Bounce polling depended on an unreplied thread.** Every sender with a recent successful send is scanned, even when they have no open reply-check row.
14. **Bounces could look like replies or be reused.** Mailer-daemon messages are excluded from reply detection, sender addresses are compared exactly, and a unique Gmail bounce-message ID prevents one old bounce from marking several sends.
15. **Reply/bounce writes could race or fail silently.** State transitions are conditional, database errors are surfaced, and the Gmail metadata cron emits structured success/failure logs.

## Delivery semantics and residual risk

Atomic claiming prevents two active workers from sending the same row. Gmail and Postgres cannot participate in one transaction, however. A process crash after Gmail accepts a message and before the message ID is stored leaves delivery uncertain. The code retries the database write and logs a distinct `outreach_sent_persistence_failed` event. Before reprocessing such a row, an operator should reconcile it against the sender's Gmail Sent folder. This is the unavoidable boundary between at-least-once and at-most-once behavior with the current Gmail scopes and API.

## Release gates before a live re-test

1. Run `npm run check` successfully.
2. Review and deploy the application changes; do not deploy the unrelated `src/.DS_Store` modification. The reply-poll cursor/bounce-dedupe migration is already applied and backward-compatible.
3. Confirm `/api/cron?job=outreach` returns 200 with the configured bearer secret and returns 401 without it.
4. Observe at least three scheduled `outreach_cron_completed` events one minute apart with an empty queue.
5. Confirm production remains at zero queued rows.
6. Recompute the never-sent set immediately before testing; exclude any address with an existing `sent_at` from any campaign.

## Staged re-test plan

Do not re-use or revive canceled rows. Create a new campaign with a new idempotency key from the freshly recomputed safe set.

1. Send to two consenting internal recipients and confirm two database `sent` rows, two Gmail message IDs, receipt, and successful cron logs.
2. Send a 10-recipient tranche. Observe queue decline across more than one worker run and verify there are no 307, 401, or 500 responses.
3. Pause and reconcile database counts against Gmail Sent before continuing.
4. Send the remaining safe recipients only after the first two gates pass. Monitor queued, sent, failed, skipped, retries, and structured worker errors until the campaign is terminal.
5. Export final recipients and Gmail message IDs for the incident record.

No live re-test is authorized by this document; sending requires an explicit operator decision after deployment and verification.
