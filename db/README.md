# Orr RTR — Database migrations

This folder is the **canonical, version-controlled source of truth** for the
Supabase schema. The Supabase SQL Editor's "shared snippets" are convenience
copies only — treat *these files* as authoritative, because browser-stored
snippets can be lost or drift out of sync.

Every file is written to run in the **Supabase SQL editor**. The `phase*` files
are idempotent (safe to re-run). The `000*` base migrations are run **once** on
a fresh database, in order, before any phase.

## Run order (fresh database)

| # | File | What it does |
|---|------|--------------|
| 1 | `0001_core_schema.sql` | Enums, all core tables, `updated_at` trigger |
| 2 | `0002_row_level_security.sql` | RLS helper fns + policies + point-person guard |
| 3 | `0003_seed_data.sql` | Tiered Orr school list + singleton settings rows |
| 4 | `0004_auth_profile_link.sql` | Auto-create a profile on Supabase Auth signup |
| 5 | `phase1.sql` | Resources, multi-assignee tasks, per-assignee completion |
| 6 | `phase2.sql` | `playbook_tasks.pending_review` (+ one-time role bootstrap) |
| 7 | `phase3.sql` | Notifications, calendar events, RSVPs |
| 8 | `phase4.sql` | Tag a person on a warm intro |
| 9 | `phase5.sql` | Event address column + Notre Dame → "Notre Dame & Saint Marys" |
| 10 | `phase6.sql` | Drop unused `school_goals.cycle` |
| 11 | `phase7.sql` | Budgets (allocations + expenses) |
| 12 | `phase8.sql` | Per-school notes on calendar events |
| 13 | `phase9.sql` | Budget rework: receipts bucket + allocation guidance |
| 14 | `phase10.sql` | Track who added each candidate (`created_by`) |
| 15 | `phase11.sql` | Misc data fixes: UIndy → bonus; `budget_guidance.pct` → dollars |
| 16 | `phase12.sql` | Split calendar event types into info / deadline |
| 17 | `phase13.sql` | School-scoped budget guidance (`school_id`) |
| 18 | `phase14.sql` | "Direct Placement Potential" candidate flag |
| 19 | `phase15.sql` | Per-user Gmail OAuth connection (`gmail_connections`) |
| 20 | `phase16.sql` | Outreach campaigns (durable send queue) |
| 21 | `phase17.sql` | Reply & bounce tracking scheduler |
| 22 | `phase18.sql` | Safe weekly transactional assignment digests |
| 23 | `phase19.sql` | Aggregate RPCs: stage counts + duplicate-group count |
| 24 | `phase20.sql` | School matching: aliases, trigram matcher, review queue |
| 25 | `phase21.sql` | Backfill matcher over existing candidates; tier-wide group RLS |
| 26 | `phase22.sql` | Fix: pin `search_path` on auth helpers so claim/reassign works |
| 27 | `phase23.sql` | Outreach templates (admin-curated) + email attachments |
| 28 | `phase24.sql` | Block direct self-edits to protected profile fields |

> Files sort lexically as `0001…`, then `phase1, phase10, phase11 … phase2, phase3…`.
> **This table is the true order — don't rely on the filename sort.**

## Secrets & schedulers

The scheduler blocks in `phase16` / `phase17` (and the flush/digest scheduler in
`phase3`) call `/api/cron` with a bearer token. In this repo those are **left
commented out** and use the placeholders `YOUR_SITE_URL` and `YOUR_CRON_SECRET`.

**Never commit the real `CRON_SECRET`.** When scheduling live, paste the real
values only into the Supabase editor at run time — not into these files.

## Syncing back to Supabase's shared snippets

Because these files are authoritative, when tidying the SQL-editor snippets:
replace each messy/duplicate snippet with the matching file here, name it
`NN_filename` (matching the table above), and delete duplicates. See
`SNIPPET_CLEANUP.md` for the exact checklist.
