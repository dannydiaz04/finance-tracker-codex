---
name: secure-finance-csv-backfill
description: >-
  Downloads bank and card transaction CSV exports via a hardened headless browser,
  names files for finance-tracker-codex dropbox ingestion, and ingests them into
  BigQuery. Use when backfilling 3-year transaction history, exporting CSVs from
  bank portals, running Playwright/Puppeteer for finance data, or filling gaps
  identified by sql/warehouse/10_csv_backfill_gap_audit.sql.
---

# Secure Finance CSV Backfill

Automate manual CSV exports from financial institution portals and load them into this repo's warehouse. **Security is non-negotiable** — these flows handle live credentials and PII.

## Before every run

1. Read [reference.md](reference.md) for the current per-source checklist, filename conventions, and date chunks.
2. Re-run the gap audit (adjust `target_start` if needed):

```bash
bq query --use_legacy_sql=false < sql/warehouse/10_csv_backfill_gap_audit.sql
```

3. Confirm which accounts still need **CSV** (not Plaid). Skip Plaid-covered ranges unless the user wants CSV as source of truth.

## Security model (mandatory)

### Isolation

- Run browser automation in a **dedicated ephemeral profile** — never the user's daily Chrome profile.
- Use **Playwright** with a fresh `launchPersistentContext` dir under `/tmp/finance-csv-session-<uuid>`; delete the dir in a `finally` block.
- **Headless by default.** Use headed mode only when MFA/CAPTCHA requires human interaction; destroy the profile immediately after.
- **Single-origin navigation**: only visit the portal URL for the account being exported. Block all other origins.

### Secrets

- Credentials come from **environment variables** in `.env.local` (gitignored) — never from chat, never hardcoded, never logged.
- Optional backfill vars (see `.env.example` § CSV backfill browser automation):

```
BACKFILL_CAPITALONE_USER=
BACKFILL_CAPITALONE_PASS=
BACKFILL_CHASE_USER=
BACKFILL_CHASE_PASS=
BACKFILL_DISCOVER_USER=
BACKFILL_DISCOVER_PASS=
BACKFILL_AMEX_USER=
BACKFILL_AMEX_PASS=
BACKFILL_APPLE_ID=
BACKFILL_APPLE_PASS=
```

- **Never** `console.log`, screenshot, or LLM-prompt body text that may contain credentials, OTP codes, account numbers, or full transaction rows.
- **Never** commit downloaded CSVs, browser profiles, cookies, or session storage to git.

### Network and downloads

- Set `acceptDownloads: true` with `downloadsPath` pointing **only** to `<repo>/dropbox/`.
- After download, **rename immediately** using the prefix rules in [reference.md](reference.md).
- Do not upload files anywhere except the local `dropbox/` folder and the repo's GCS landing bucket via `npm run etl:dropbox`.
- Disable browser extensions. Do not install password-manager extensions in the automation profile.

### MFA and session handoff

- If MFA is required, **pause automation** and prompt the user to complete MFA in a headed window.
- Do not attempt to bypass CAPTCHA, SMS interception, or 2FA.
- Optionally reuse a **pre-authenticated storage state** file at `~/.finance-tracker/sessions/<portal>.json` (mode 0600, never committed). Refresh only when expired.

### Post-run cleanup

- Delete ephemeral browser profile dir.
- Verify no CSV landed outside `dropbox/`.
- Run ETL and confirm row counts match expectations before starting the next institution.

## Workflow

Copy this checklist and track progress:

```
Backfill progress:
- [ ] Gap audit reviewed
- [ ] Ephemeral browser profile created
- [ ] Portal export completed
- [ ] File renamed with correct prefix
- [ ] npm run etl:dropbox -- --dry-run passed
- [ ] npm run etl:dropbox completed
- [ ] Browser profile destroyed
```

### Step 1 — Plan exports

Use [reference.md](reference.md) chunk table. Export **oldest gap first**. Overlap of a few days with existing data is OK (warehouse dedupes on `source_transaction_id`).

### Step 2 — Export via browser

Use the repo scaffold (Playwright + ephemeral profile):

```bash
# One-time browser install
npm run backfill:install-browser

# Dry-run: validate portal, dates, credentials
npm run backfill:export -- --portal apple_card --start 2023-06-28 --end 2024-06-27 --dry-run

# Headed run when MFA is expected
npm run backfill:export -- --portal apple_card --start 2023-06-28 --end 2024-06-27 --headed --save-session
```

Implementation lives in `scripts/backfill/`:
- `run-portal-export.ts` — CLI entry point
- `lib/browser-session.ts` — ephemeral profile, network guards, download handling, cleanup
- `portals/*.ts` — per-institution adapters (fill in selectors here)

List configured portals:

```bash
npm run backfill:export -- --list-portals
```

### Step 3 — Rename downloaded file

Immediately rename to: `<prefix><start-date>_<end-date>.csv`

Examples:
- `apple_card-2023-06-28_2024-06-27.csv`
- `capital_one-2025-06-28_2026-03-15.csv`

Mapping profile IDs and `sourceAccountId` values are in [reference.md](reference.md).

### Step 4 — Ingest

```bash
npm run etl:dropbox -- --dry-run   # verify mapping + row count
npm run etl:dropbox                # upload → BigQuery → Dataform marts
```

Re-run gap audit to confirm the chunk closed.

## Validation

After each file:

1. Check `raw_finance.import_batches` for expected `row_count` and `mapping_profile_id`.
2. Spot-check min/max `postedAt` in raw events for that `source_account_id`.
3. Reload `http://localhost:3000/overview` and confirm the date range expanded.

## Failure handling

| Symptom | Action |
|---|---|
| Wrong mapping profile | Fix filename prefix or add sidecar `.context.json` (see `dropbox/README.md`) |
| 0 rows parsed | Open CSV — confirm headers match `source-mappings/*.yaml` |
| Duplicate rows in UI | Expected for overlapping CSV/Plaid; dedup should keep one |
| MFA loop | Switch to headed mode, user completes MFA, save storage state |
| Portal UI changed | Update selectors in reference.md, do not guess blindly |

## What not to automate

- Do not store or transmit credentials to external services.
- Do not run parallel sessions against the same institution (triggers lockouts).
- Do not export more than one institution per browser profile.
- Do not skip gap audit — date ranges drift as Plaid syncs.

## Additional resources

- Per-source checklist, chunks, and portal notes: [reference.md](reference.md)
- Browser automation scaffold: [scripts/backfill/](../../scripts/backfill/)
- Gap audit SQL: [sql/warehouse/10_csv_backfill_gap_audit.sql](../../sql/warehouse/10_csv_backfill_gap_audit.sql)
- Dropbox ingestion: [dropbox/README.md](../../dropbox/README.md)
- Source mappings: [source-mappings/](../../source-mappings/)
