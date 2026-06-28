# Secure Headless CSV Backfill — Milestones

Last updated: 2026-06-28

Living tracker for the secure headless-browser CSV backfill system: automated
3-year transaction history exports from bank/card portals into the
finance-tracker-codex warehouse (`dropbox/` → GCS landing → BigQuery → Dataform).

## Goal

Fill transaction history that Plaid cannot reach (Plaid caps at ~730 days) by
exporting CSVs from each institution's web portal through a hardened, isolated
headless browser, then ingesting them via the existing ETL path.

## Components

| Area | Path |
|---|---|
| Agent skill | `.cursor/skills/secure-finance-csv-backfill/SKILL.md` |
| Skill reference (checklist, chunks, portals) | `.cursor/skills/secure-finance-csv-backfill/reference.md` |
| Gap audit query | `sql/warehouse/10_csv_backfill_gap_audit.sql` |
| Browser automation scaffold | `scripts/backfill/` |
| Portal adapters | `scripts/backfill/portals/*.ts` |
| Credential contract | `.env.example` (`BACKFILL_*`) |

## Current Baseline

Verified locally on 2026-06-28:

- [x] `npm run typecheck`
- [x] `npm run backfill:export -- --list-portals`
- [x] `npm run backfill:export -- --portal apple_card --start 2025-01-01 --end 2026-03-13 --dry-run`
- [x] Playwright installed (`playwright@^1.55.0`)

Pending verification (requires live credentials + browser binary):

- [ ] `npm run backfill:install-browser`
- [ ] First authenticated headed run against a live portal
- [ ] `npm run etl:dropbox` round-trip on a downloaded file

## Milestone 1: Data Gap Analysis

Goal: know exactly which date ranges each source is missing for a 3-year window.

Status: complete.

- [x] Map data sources (CSV channel vs Plaid channel) in BigQuery `finance-tracker-cdx`.
- [x] Query earliest/latest `postedAt` per account across raw, staging, and mart.
- [x] Confirm Plaid 730-day ceiling (Chase oldest Plaid date = 2024-06-28).
- [x] Produce month-by-month and contiguous-gap audit.
  - Added `sql/warehouse/10_csv_backfill_gap_audit.sql` (re-runnable, parameterized
    by `target_start`).

## Milestone 2: Backfill Skill

Goal: an agent can run the backfill safely and consistently.

Status: complete.

- [x] Author `secure-finance-csv-backfill` skill with a mandatory security model
  (profile isolation, secrets handling, network/download guards, MFA handoff,
  cleanup).
- [x] Add per-source checklist with exact filenames, date chunks, and portal
  notes in `reference.md`.
- [x] Document ingestion + validation loop and failure handling.

## Milestone 3: Secure Browser Scaffold

Goal: reusable, hardened browser shell so adapters only implement selectors.

Status: complete.

- [x] Ephemeral Playwright profile under `/tmp/finance-csv-*`, destroyed in a
  `finally` block (`lib/browser-session.ts`).
- [x] Per-portal hostname allowlist + third-party tracker blocking.
- [x] Downloads constrained to `dropbox/`, auto-renamed to
  `<prefix><start>_<end>.csv` (`lib/downloads.ts`).
- [x] Credential loading from `BACKFILL_*` env with redacted logging
  (`lib/credentials.ts`, `lib/logging.ts`).
- [x] MFA pause for headed runs; optional session reuse at
  `~/.finance-tracker/sessions/<portal>.json` (mode 0600).
- [x] CLI entry point with `--dry-run`, `--headed`, `--use-session`,
  `--save-session`, `--list-portals` (`run-portal-export.ts`).
- [x] npm scripts `backfill:export` and `backfill:install-browser`.

## Milestone 4: Apple Card Adapter (end-to-end)

Goal: first fully-implemented portal.

Status: complete (pending live-selector verification).

- [x] Corrected portal to `card.apple.com` (date-range export lives here, not
  `wallet.apple.com`).
- [x] Apple ID sign-in with iframe-aware auth-scope resolution (idmsa widget can
  be inline or framed), with Continue/Sign-in fallbacks.
- [x] 2FA pause via `waitForMfa()` (Apple always requires it → use `--headed`).
- [x] Statements → Export Transactions → date range → CSV → Export, wrapped in
  the shell's download capture.
- [x] Enforced Apple's hard floor: range export start must be ≥ 2025-01-01;
  adapter rejects older starts with guidance to use per-statement export.
- [x] Updated `reference.md` Apple plan (automated chunks vs manual pre-2025
  statements) and gap-audit portal label.

Open follow-up:

- [ ] Verify export-modal date/format selectors against the live authenticated
  page (first run `--headed`).

## Milestone 5: Remaining Portal Adapters

Goal: implement the other five institutions end-to-end.

Status: pending (stubs in place; each opens login then throws not-implemented).

- [ ] Capital One 360 Checking (`scripts/backfill/portals/capital-one.ts`).
- [ ] Chase Card 1325 (`scripts/backfill/portals/chase.ts`).
- [ ] Discover (`scripts/backfill/portals/discover.ts`) — confirm card 7788 vs
  Plaid 1107 identity first.
- [ ] American Express (`scripts/backfill/portals/amex.ts`).
- [ ] Micro Center (`scripts/backfill/portals/micro-center.ts`) — confirm issuer
  portal (Wells Fargo?) before wiring selectors.

## Milestone 6: Apple Pre-2025 Statement Automation

Goal: cover Apple history older than 2025-01-01 (currently manual).

Status: pending.

- [ ] Add a `--statement-month` (or per-statement loop) mode to the Apple adapter
  that exports each closed monthly statement CSV.
- [ ] Decide naming/merge strategy so monthly files ingest cleanly and dedupe.

## Milestone 7: End-to-End Validation

Goal: prove the full export → ingest → mart loop on real data.

Status: pending.

- [ ] `npm run backfill:install-browser` on the operator machine.
- [ ] Authenticated headed run for at least one institution.
- [ ] `npm run etl:dropbox -- --dry-run` then `npm run etl:dropbox`.
- [ ] Confirm `raw_finance.import_batches` row counts and mapping profile.
- [ ] Re-run gap audit; confirm the targeted chunk closed.
- [ ] Confirm the date range expanded in the app overview.

## Milestone 8: Security & Ops Hardening

Goal: production-grade safety for credential-bearing automation.

Status: pending.

- [ ] Review network allowlists per portal against live traffic (avoid blocking
  required CDN/auth assets).
- [ ] Confirm no CSV, cookie, or profile artifact lands outside `dropbox/` or the
  0600 session store.
- [ ] Document credential rotation and session-expiry handling.
- [ ] Decide whether to run unattended (no MFA) via saved sessions, and the
  associated risk acceptance.

## Notes / Decisions

- Plaid cannot serve a 3-year window; manual CSV is required for pre-Plaid
  history on Chase and Capital One, and for all history on Apple Card, Amex, and
  Micro Center (no Plaid connection).
- Overlap between CSV and Plaid is safe: the warehouse dedupes on
  `(user_id, source_account_id, source_transaction_id)`.
- Chase has a legacy Plaid item with history back to 2024-06-28 that is present in
  raw but missing from the app mart; CSV backfill is the pragmatic fix until the
  orphaned item is reconciled.
- Two Discover cards exist (CSV mask 7788 vs Plaid mask 1107) — confirm identity
  before a full export.
