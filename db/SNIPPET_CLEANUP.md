# Supabase SQL-Editor snippet cleanup checklist

Your project has ~23 **shared** snippets in the Supabase SQL Editor. They can't
be edited/deleted through any API or MCP — only in the dashboard, by you. This
is the checklist to make them match the clean set in this folder.

## 1. Fix before anything else

- [ ] **Rotate `CRON_SECRET`.** The live token was pasted in plaintext inside
      shared snippets (and into a chat). Generate a new one, update it in Vercel,
      and re-run the three `cron.schedule(...)` jobs (`orr-flush`, `orr-digest`,
      `orr-outreach`, `orr-gmail-sync`) with the new value.
- [ ] **Fix the Phase 17 URL typo.** The gmail-sync snippet has
      `https://rtr.orrfellowship.orgL/api/cron` — delete the stray **`L`** so it
      reads `...orrfellowship.org/api/cron`. (Un-commenting and running it as-is
      would silently fail every gmail-sync tick.)

## 2. Delete exact duplicates

- [ ] Delete the **second** `Phase 15: gmail_connections` snippet (there are two
      identical copies).
- [ ] Delete the **second** `Phase 7: budgets` snippet (there are two identical
      copies).

## 3. Re-label the mis-numbered snippets

Your snippet titles drifted from the real phase order. Rename to match:

| Snippet content | Rename to |
|-----------------|-----------|
| "Phase 11: split info and deadline event types" | **Phase 12** |
| "Phase 11: misc data fixes (UIndy, budget pct)" | **Phase 11** (keep) |
| loose `budget_guidance add school_id` fragment | **Phase 13** |

## 4. Fold loose fragments into their phase

These ran as bare statements without a header — attach them to the right phase
snippet (or just delete the snippet, since the file here is authoritative):

- [ ] `alter events add address` + `Notre Dame rename` → part of **Phase 5**
- [ ] `alter school_goals drop cycle` → part of **Phase 6**
- [ ] `alter playbook_tasks add pending_review` + role UPDATE → **Phase 2**

## 5. Add the four foundational snippets (currently missing as snippets)

These ran early but aren't saved as tidy shared snippets. Re-save them from the
files in this folder so the snippet set is complete:

- [ ] `0001_core_schema.sql`
- [ ] `0002_row_level_security.sql`
- [ ] `0003_seed_data.sql`
- [ ] `0004_auth_profile_link.sql`

## 6. Standardize names

Rename every remaining snippet to `NN_short-name` matching the run-order table in
`README.md` (e.g. `05_phase5_event_address`, `19_phase15_gmail_connections`) so
they sort in execution order in the sidebar.

---

**End state:** ~21 snippets, one per migration, numbered in run order, no
duplicates, no plaintext secret, no broken URL — mirroring this folder exactly.
