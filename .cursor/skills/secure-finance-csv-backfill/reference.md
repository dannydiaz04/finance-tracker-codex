# CSV Backfill Reference — finance-tracker-codex

Last audited: **2026-06-28** against BigQuery project `finance-tracker-cdx`.

**3-year target window:** `2023-06-28` → today (`2026-06-28` at audit time).

Re-run gap audit anytime:

```bash
bq query --use_legacy_sql=false < sql/warehouse/10_csv_backfill_gap_audit.sql
```

---

## Coverage snapshot (what we already have)

| Account | Source | Earliest | Latest | Real data? |
|---|---|---|---|---|
| Apple Card | CSV | 2026-03-14 | 2026-05-04 | Yes (346 rows) |
| Capital One 360 Checking (...5980) | CSV | 2026-03-16 | 2026-05-04 | Yes (152 rows) |
| Capital One 360 Checking (...5980) | Plaid | 2026-03-24 | 2026-06-27 | Yes |
| Chase Card (...1325) | Plaid legacy item | **2024-06-28** | 2026-06-26 | Yes (~1,668 txns; **not in app mart**) |
| Chase Card (...1325) | Plaid active item | 2026-04-01 | 2026-06-26 | Yes (shown in app) |
| Chase Card (...1325) | CSV | 2026-04-01 | 2026-04-01 | Fixture only |
| Discover (...7788) | CSV | 2026-04-08 | 2026-04-26 | Yes (11 rows) |
| Discover it chrome (...1107) | Plaid | 2026-04-08 | 2026-06-25 | Yes (active in app) |
| American Express (...2001) | CSV | 2026-04-01 | 2026-04-01 | Fixture only |
| Micro Center (...4242) | CSV | 2026-04-01 | 2026-04-01 | Fixture only |

**Plaid ceiling:** max ~730 days. Chase oldest Plaid date (2024-06-28) confirms the boundary.

---

## Month-by-month heat map (CSV accounts only)

Legend: `█` = has transactions, `·` = missing

### Apple Card (`apple_card`)
```
2023-06 ─ 2026-02  ·································  (all missing)
2026-03            ████████  (105 txns)
2026-04            ██████████ (210 txns)
2026-05            ███       (31 txns)
2026-06            ·
```

### Capital One 360 Checking — CSV (`capital_one_360_checking_5980`)
```
2023-06 ─ 2026-02  ·································  (all missing)
2026-03            ████      (partial — from 2026-03-16)
2026-04            ██████
2026-05            ████      (through 2026-05-04)
2026-06            ·         (Plaid covers from 2026-03-24)
```

### Chase Card 1325 — Plaid legacy (best history, not in app mart)
```
2023-06 ─ 2024-05  ··································  (missing — needs CSV)
2024-06            ████████  (from 2024-06-28)
2024-07 ─ 2026-06  mostly covered (small day-level gaps — statement timing)
```

---

## Per-source export checklist

Work top-to-bottom. Check off each chunk after `npm run etl:dropbox` and gap audit confirms closure.

### 1. Apple Card — CSV only (no Plaid) — automated by `--portal apple_card`

> **Hard constraint:** Apple's date-range export only allows a start date **on or after 2025-01-01**. Anything older must be exported **per closed monthly statement** (manual, one month at a time). The adapter refuses pre-2025 start dates.

**Automated range export** (`npm run backfill:export -- --portal apple_card ...`):

| # | Portal dates (inclusive) | Save as filename | Mapping profile |
|---|---|---|---|
| A | 2025-01-01 → 2026-03-13 | `apple_card-2025-01-01_2026-03-13.csv` | `apple_card.transactions.csv.v1` |
| B | 2026-05-05 → 2026-06-28 | `apple_card-2026-05-05_2026-06-28.csv` | same |

- [ ] Chunk A
- [ ] Chunk B

**Manual per-statement export** (pre-2025, cannot be automated via date range):

| # | Coverage | How |
|---|---|---|
| M | 2023-06-28 → 2024-12-31 | card.apple.com → Statements → each monthly statement → Export Transactions → CSV |

- [ ] Manual pre-2025 statements

**Portal:** https://card.apple.com → sidebar **Statements** → **Export Transactions** → pick start/end date → choose **CSV** → Export  
**Notes:** Export uses "Clearing Date" as `postedAt`. Save with `apple_card-` prefix (or keep Apple's `Apple Card Transactions ...` name — both match the mapping). 2FA is always required, so run with `--headed`.

---

### 2. Capital One 360 Checking (...5980)

| # | Portal dates | Save as filename | Mapping profile |
|---|---|---|---|
| 1 | 2023-06-28 → 2024-06-27 | `capital_one-2023-06-28_2024-06-27.csv` | `capital_one.360_checking_5980.csv.v1` |
| 2 | 2024-06-28 → 2025-06-27 | `capital_one-2024-06-28_2025-06-27.csv` | same |
| 3 | 2025-06-28 → 2026-03-15 | `capital_one-2025-06-28_2026-03-15.csv` | same |

- [ ] Chunk 1
- [ ] Chunk 2
- [ ] Chunk 3

**Portal:** https://www.capitalone.com → 360 Checking → Download transactions  
**Notes:** Plaid covers 2026-03-24 onward. CSV chunk 3 ends 2026-03-15 to avoid overlap. Existing file: `2026-05-04_360Checking...5980.csv` (152 rows, Mar 16 – May 4).

---

### 3. Chase Card (...1325)

| # | Portal dates | Save as filename | Mapping profile |
|---|---|---|---|
| 1 | 2023-06-28 → 2024-06-27 | `chase-2023-06-28_2024-06-27.csv` | `chase.card_1325.csv.v1` |

- [ ] Chunk 1

**Portal:** https://www.chase.com → Credit Card → Download activity  
**Notes:** Plaid legacy item has 2024-06-28 → 2026-06-26 in raw but **not in app mart**. Consider also exporting 2024-06-28 → 2026-03-31 via CSV if you want Chase history reliably in the UI without fixing the orphaned Plaid item.

Optional supplemental chunk:

| # | Portal dates | Save as filename |
|---|---|---|
| 2 | 2024-06-28 → 2026-03-31 | `chase-2024-06-28_2026-03-31.csv` |

- [ ] Chunk 2 (optional)

---

### 4. Discover Card (...7788) — CSV account

| # | Portal dates | Save as filename | Mapping profile |
|---|---|---|---|
| 1 | 2023-06-28 → 2024-06-27 | `discover-2023-06-28_2024-06-27.csv` | `discover.all_available.csv.v1` |
| 2 | 2024-06-28 → 2025-06-27 | `discover-2024-06-28_2025-06-27.csv` | same |
| 3 | 2025-06-28 → 2026-06-28 | `discover-2025-06-28_2026-06-28.csv` | same |

- [ ] Chunk 1
- [ ] Chunk 2
- [ ] Chunk 3

**Portal:** https://www.discover.com → All Available Activity → Download  
**Notes:** Mask **7788** in seed metadata. Plaid connects a **different** card (mask **1107**). Confirm whether 7788 is still active before exporting all 3 years.

---

### 5. Discover it chrome (...1107) — Plaid account (CSV optional)

Only needed if you want CSV as source of truth instead of Plaid.

| # | Portal dates | Save as filename |
|---|---|---|
| 1 | 2023-06-28 → 2026-04-07 | Split into yearly `discover-` files (same card, mask 1107) |

- [ ] Full backfill (optional)

---

### 6. American Express (...2001) — CSV only

| # | Portal dates | Save as filename | Mapping profile |
|---|---|---|---|
| 1 | 2023-06-28 → 2024-06-27 | `american_express-2023-06-28_2024-06-27.csv` | `american_express.activity.csv.v1` |
| 2 | 2024-06-28 → 2025-06-27 | `american_express-2024-06-28_2025-06-27.csv` | same |
| 3 | 2025-06-28 → 2026-06-28 | `american_express-2025-06-28_2026-06-28.csv` | same |

- [ ] Chunk 1
- [ ] Chunk 2
- [ ] Chunk 3

**Portal:** https://www.americanexpress.com → Statements & Activity → Download CSV  
**Notes:** No real data yet (3 fixture rows on 2026-04-01).

---

### 7. Micro Center Card (...4242) — CSV only

| # | Portal dates | Save as filename | Mapping profile |
|---|---|---|---|
| 1 | 2023-06-28 → 2024-06-27 | `micro_center-2023-06-28_2024-06-27.csv` | `micro_center.credit_card_1.csv.v1` |
| 2 | 2024-06-28 → 2025-06-27 | `micro_center-2024-06-28_2025-06-27.csv` | same |
| 3 | 2025-06-28 → 2026-06-28 | `micro_center-2025-06-28_2026-06-28.csv` | same |

- [ ] Chunk 1
- [ ] Chunk 2
- [ ] Chunk 3

**Portal:** Issuer portal (Wells Fargo services some Micro Center cards — mask **5465** appears via Plaid separately)  
**Notes:** Confirm which portal serves card ...4242 before automating.

---

## Identity reference

| Institution | `sourceAccountId` | Dropbox prefix | YAML profile |
|---|---|---|---|
| Apple Card | `apple_card` | `apple_card-` | `apple_card.transactions.csv.v1` |
| Capital One 360 Checking | `capital_one_360_checking_5980` | `capital_one-` | `capital_one.360_checking_5980.csv.v1` |
| Chase Card 1325 | `chase_card_1325` | `chase-` | `chase.card_1325.csv.v1` |
| Discover Card | `discover_card` | `discover-` | `discover.all_available.csv.v1` |
| American Express | `american_express_card` | `american_express-` | `american_express.activity.csv.v1` |
| Micro Center | `micro_center_card` | `micro_center-` | `micro_center.credit_card_1.csv.v1` |

---

## Portal automation hints (verify selectors live)

These are starting points — **always verify in headed mode first**.

| Portal | Login URL | Export path (typical) |
|---|---|---|
| Apple Card | `https://card.apple.com` | Statements → Export Transactions → date range (start ≥ 2025-01-01) → CSV |
| Capital One | `https://www.capitalone.com` | Account → Transactions → Download |
| Chase | `https://www.chase.com` | Credit card → Activity → Download (.csv) |
| Discover | `https://portal.discover.com` | Activity & Payments → All Available → Download |
| Amex | `https://www.americanexpress.com` | Account → Statements & Activity → Download |
| Micro Center | Issuer-specific | Card account → Statements/Transactions → Download |

---

## Browser automation scaffold

```bash
npm run backfill:install-browser
npm run backfill:export -- --list-portals
npm run backfill:export -- --portal apple_card --start 2023-06-28 --end 2024-06-27 --dry-run
npm run backfill:export -- --portal apple_card --start 2023-06-28 --end 2024-06-27 --headed --save-session
```

Portal selectors are implemented in `scripts/backfill/portals/*.ts`. The shell handles ephemeral profiles, download renaming, session storage, and cleanup.

---

```bash
# Preview classification without writing
npm run etl:dropbox -- --dry-run

# Full pipeline: GCS landing → BigQuery raw → Dataform marts
npm run etl:dropbox
```

After ingestion, confirm closure:

```bash
bq query --use_legacy_sql=false < sql/warehouse/10_csv_backfill_gap_audit.sql
```

---

## Priority order (recommended)

1. **Apple Card** — largest CSV-only gap, no Plaid fallback
2. **Capital One 360** — 3 chunks fill ~2.7 years Plaid cannot cover
3. **Chase 1325** — 1 chunk (2023-06-28 → 2024-06-27) for pre-Plaid year
4. **Amex** — full 3-year export, no real data yet
5. **Discover 7788** — confirm card is still active first
6. **Micro Center** — confirm portal first
