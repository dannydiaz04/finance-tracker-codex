# Warehouse Source Mappings

This document captures per-source field mappings for the landing-zone ingestion runner.
It is a working companion to `WAREHOUSE_ETL_LIVING_SPEC.md` and should be updated as we
work through each source file.

## Purpose

Use this document to:

- Record the source columns for each feed.
- Map source fields into the canonical raw-event payload used by the runner.
- Capture unresolved questions before a mapping is promoted into production.
- Keep the mapping config and ETL insertion point explicit.

## Mapping Storage Strategy

Per-source mappings should not live as hardcoded `if/else` branches inside the run job.
They should live as versioned YAML mapping profiles that the runner loads at runtime.

Recommended location:

- `source-mappings/<source>.<feed>.<format>.vN.yaml`

Why:

- The runner logic stays generic.
- Mapping changes can be versioned independently of parser logic.
- Replays can record the exact mapping version used for a given file.
- New sources can be added without editing the core runner flow each time.

## Account Identity Convention

Use one consistent convention for account identity across all profiles.

Rules:

- `sourceAccountId` is the stable machine identifier used in raw events.
- `sourceAccountId` should be lowercase snake_case.
- `sourceAccountId` should follow the pattern `<institution>_<product_or_account>[_<mask>]`.
- `accountName` is the human-readable display label used by downstream models and the app.
- `accountName` should be Title Case and follow the pattern `<Institution> <Product> [mask]`.
- Feed names such as `transactions`, `activity`, or `all_available` are routing identifiers and should not become `sourceAccountId` values unless they truly identify the account.
- When a file includes an account number or mask, use that to keep `sourceAccountId` stable and distinct.
- When a file does not identify the account, the runner should inject runtime values for `sourceAccountId` and `accountName` using the same convention.

Standardized identities for the current six profiles:

| Feed | `sourceAccountId` | `accountName` |
| --- | --- | --- |
| Capital One 360 Checking (...5980) | `capital_one_360_checking_5980` | `Capital One 360 Checking` |
| Apple Card Transactions | `apple_card` | `Apple Card` |
| Chase Card Activity (...1325) | `chase_card_1325` | `Chase Card 1325` |
| American Express Activity | `american_express_card` | `American Express Card` |
| Micro Center Credit Card Export | `micro_center_card` | `Micro Center Card` |
| Discover All Available Export | `discover_card` | `Discover Card` |

## Where Mappings Fit In The ETL Process

The intended runner flow is:

1. `storageScanner` lists files in `incoming/...`.
2. `fileClaimer` moves a single file into `processing/...`.
3. `formatDetector` verifies the file structure and routes it to the correct adapter.
4. `mappingResolver` loads the matching YAML profile based on source system, feed, format, and filename pattern.
5. `canonicalMapper` maps each raw row into the canonical payload shape.
6. `normalizer` derives normalized text, direction, keywords, and classification hints.
7. `rawLoader` writes `raw_finance.import_batches` and `raw_finance.transaction_events`.
8. `archiveManager` moves the file to `archive/...` or `rejected/...`.

## Current Code Touchpoints

The current repo path already has the right places to insert this mapping layer:

- `lib/import/csv.ts`
  - Parse the file.
  - Load the mapping profile instead of relying only on header alias inference.
  - Pass the resolved field map into normalization.
- `lib/import/mapping.ts`
  - Evolve from alias-only CSV header inference into explicit source-profile resolution.
- `lib/import/normalize.ts`
  - Continue deriving canonical fields such as normalized merchant, normalized description, keywords, direction, and transaction class.
- Future standalone runner
  - Resolve the mapping after `formatDetector` and before row normalization.

## Canonical Payload Target

Each adapter should emit the canonical raw-event payload that downstream SQL already expects
inside `raw_finance.transaction_events.payload`.

Current target payload keys:

- `sourceTransactionId`
- `sourceAccountId`
- `accountName`
- `postedAt`
- `authorizedAt`
- `descriptionRaw`
- `descriptionNorm`
- `merchantRaw`
- `merchantNorm`
- `signedAmount`
- `direction`
- `transactionClass`
- `institutionCategory`
- `pending`
- `keywordArray`
- `rawPayloadJson`

Additional canonical fields that should be mapped whenever the source provides them:

- `accountType`
- `accountSubtype`
- `accountMask`
- `currencyCode`
- `runningBalance`
- `availableBalance`
- `originalDescription`
- `memo`
- `transactionType`
- `transactionSubtype`
- `paymentChannel`
- `paymentMethod`
- `referenceNumber`
- `checkNumber`
- `merchantId`
- `merchantCategory`
- `merchantCategoryCode`
- `counterpartyName`
- `counterpartyAccountId`
- `merchantCity`
- `merchantState`
- `merchantPostalCode`
- `merchantCountry`
- `statementId`
- `statementDate`

## Feed 1: Capital One 360 Checking (...5980)

### Source Summary

- Source system: `capital_one`
- Feed: `360_checking_5980`
- File example: `2026-04-09_360Checking...5980`
- Format: `csv`
- Confirmed by user:
  - This is the Capital One 360 Checking account feed.
  - The export contains confirmed transactions only.

### Source Headers

- `Account Number`
- `Transaction Description`
- `Transaction Date`
- `Transaction Type`
- `Transaction Amount`
- `Balance`

### Mapping Status

Status: ready for first pass

### Source To Canonical Mapping

| Source field | Canonical target | Mapping rule |
| --- | --- | --- |
| `Account Number` | `sourceAccountId` | Derive as `capital_one_360_checking_<Account Number>` |
| `Account Number` | `accountMask` | Derive last 4 digits |
| `Transaction Description` | `descriptionRaw` | Direct map |
| `Transaction Description` | `merchantRaw` | Direct map for now because merchant is not split separately |
| `Transaction Date` | `postedAt` | Parse using `M/D/YY` |
| `Transaction Type` + `Transaction Amount` | `signedAmount` | `Credit` = positive, `Debit` = negative |
| `Balance` | `runningBalance` | Direct map as post-transaction running balance |
| full source row | `rawPayloadJson` | Preserve entire row as lineage |

### Defaults And Derived Fields

Defaults:

- `accountName`: `Capital One 360 Checking`
- `authorizedAt`: `null`
- `currencyCode`: `USD`
- `institutionCategory`: `null`
- `pending`: `false`

Derived fields:

- `sourceTransactionId`
  - Generate deterministically from `Account Number`, `Transaction Date`, `Transaction Description`, `Transaction Type`, `Transaction Amount`, and `Balance`
- `direction`
  - Derive from signed amount
- `transactionClass`
  - Derive from the classification and normalization layer
- `merchantNorm`
  - Derive from normalized merchant text
- `descriptionNorm`
  - Derive from normalized description text
- `keywordArray`
  - Derive from normalized text

Pending handling:

- This export is confirmed-only.
- Set `pending: false` for every row.

### Proposed Mapping Config

Proposed config file:

- `source-mappings/capital_one.360_checking_5980.csv.v1.yaml`

```yaml
id: capital_one.360_checking_5980.csv.v1
source_system: capital_one
feed: 360_checking_5980
format: csv

file_match:
  filename_contains:
    - "360Checking"
    - "5980"

field_map:
  sourceAccountId:
    source: "Account Number"
    transform:
      template: "capital_one_360_checking_{Account Number}"

  accountMask:
    source: "Account Number"
    transform:
      take_last: 4

  accountName:
    default: "Capital One 360 Checking"

  postedAt:
    source: "Transaction Date"
    transform:
      parse_as: "M/D/YY"

  descriptionRaw:
    source: "Transaction Description"

  merchantRaw:
    source: "Transaction Description"

  signedAmount:
    source: "Transaction Amount"
    transform:
      sign_from:
        field: "Transaction Type"
        positive_values: ["Credit"]
        negative_values: ["Debit"]

  runningBalance:
    source: "Balance"

defaults:
  authorizedAt: null
  currencyCode: "USD"
  institutionCategory: null
  pending: false

derived:
  sourceTransactionId:
    strategy: hash
    fields:
      - "Account Number"
      - "Transaction Date"
      - "Transaction Description"
      - "Transaction Type"
      - "Transaction Amount"
      - "Balance"

  direction:
    strategy: from_signed_amount

  transactionClass:
    strategy: classifier

  merchantNorm:
    strategy: normalize_text

  descriptionNorm:
    strategy: normalize_text

  keywordArray:
    strategy: extract_keywords

  rawPayloadJson:
    strategy: preserve_entire_row
```

### Implementation Notes

When wiring this into the runner:

1. Match the claimed file against `source-mappings/capital_one.360_checking_5980.csv.v1.yaml`.
2. Parse the CSV headers and rows.
3. Apply the mapping profile to emit the canonical row shape.
4. Run normalization to derive `direction`, `transactionClass`, `merchantNorm`, `descriptionNorm`, and `keywordArray`.
5. Write the canonical payload into `raw_finance.transaction_events.payload`.
6. Record the mapping profile ID and version in import metadata so future replays can be reproduced exactly.

Current implementation note:

- The current app upload flow uses `inferCsvColumnMapping()` in `lib/import/mapping.ts`.
- The future runner should resolve this explicit YAML profile first, and only fall back to alias inference when no source-specific profile exists.

### Open Questions

- Does the file ever include a stable native transaction identifier that is not currently visible in the provided columns?
- Is `Balance` always the post-transaction running balance for both posted and pending entries?

## Feed 2: Apple Card Transactions

### Source Summary

- Source system: `apple_card`
- Feed: `transactions`
- File example: `Apple Card Transactions Jan 01`
- Format: `csv`
- Confirmed by user:
  - `Transaction Date` appears to be the purchase or authorization date.
  - `Clearing Date` appears to be the posting or settlement date.
  - A blank `Clearing Date` always means pending.
  - `Amount (USD)` appears to use statement-style card signs, so purchases must be converted to negative warehouse outflows.

### Source Headers

- `Transaction Date`
- `Clearing Date`
- `Description`
- `Merchant`
- `Category`
- `Type`
- `Amount (USD)`
- `Purchased By`

### Mapping Status

Status: ready for first pass

### Source To Canonical Mapping

| Source field | Canonical target | Mapping rule |
| --- | --- | --- |
| file context | `sourceAccountId` | Default to `apple_card` because the file has no account identifier column |
| file context | `accountName` | Default to `Apple Card` |
| file context | `accountType` | Default to `credit` |
| file context | `accountSubtype` | Default to `credit_card` |
| `Transaction Date` | `authorizedAt` | Parse using `M/D/YY` and coerce to a date-based timestamp |
| `Clearing Date` | `postedAt` | Parse using `M/D/YY`; if blank, fall back to `Transaction Date` |
| `Description` | `descriptionRaw` | Direct map |
| `Merchant` | `merchantRaw` | Direct map |
| `Category` | `institutionCategory` | Direct map |
| `Type` | `transactionType` | Direct map |
| `Amount (USD)` + `Type` | `signedAmount` | `Purchase` = negative absolute value, `Payment` = positive absolute value |
| `Purchased By` | `rawPayloadJson` | Preserve for lineage and future cardholder-level modeling |
| full source row | `rawPayloadJson` | Preserve entire row as lineage |

### Defaults And Derived Fields

Defaults:

- `sourceAccountId`: `apple_card`
- `accountName`: `Apple Card`
- `accountType`: `credit`
- `accountSubtype`: `credit_card`
- `currencyCode`: `USD`

Derived fields:

- `sourceTransactionId`
  - Generate deterministically from `sourceAccountId`, `Transaction Date`, `Description`, `Merchant`, `Type`, `Amount (USD)`, and `Purchased By`
  - Do not include `Clearing Date` in the hash so the ID stays stable when a pending row later clears
- `pending`
  - Set to `true` when `Clearing Date` is blank, otherwise `false`
- `direction`
  - Derive from signed amount
- `transactionClass`
  - Derive from the classification and normalization layer
- `merchantNorm`
  - Derive from normalized merchant text
- `descriptionNorm`
  - Derive from normalized description text
- `keywordArray`
  - Derive from normalized text

Special handling:

- For posted rows, use `Clearing Date` as `postedAt`
- For pending rows, fall back to `Transaction Date` as `postedAt` so the warehouse does not receive a null posting date
- Preserve `Purchased By` in the raw payload because it is useful lineage even though there is no first-class canonical field for it yet

### Proposed Mapping Config

Proposed config file:

- `source-mappings/apple_card.transactions.csv.v1.yaml`

```yaml
id: apple_card.transactions.csv.v1
source_system: apple_card
feed: transactions
format: csv

file_match:
  filename_contains:
    - "Apple Card Transactions"

field_map:
  sourceAccountId:
    default: "apple_card"

  accountName:
    default: "Apple Card"

  accountType:
    default: "credit"

  accountSubtype:
    default: "credit_card"

  authorizedAt:
    source: "Transaction Date"
    transform:
      parse_as: "M/D/YY"
      coerce_to: "timestamp"

  postedAt:
    source: "Clearing Date"
    fallback_source: "Transaction Date"
    transform:
      parse_as: "M/D/YY"

  descriptionRaw:
    source: "Description"

  merchantRaw:
    source: "Merchant"

  institutionCategory:
    source: "Category"

  transactionType:
    source: "Type"

  signedAmount:
    source: "Amount (USD)"
    transform:
      absolute_value: true
      sign_from:
        field: "Type"
        negative_values:
          - "Purchase"
        positive_values:
          - "Payment"
        fallback: use_source_sign

  pending:
    transform:
      true_when_blank: "Clearing Date"

defaults:
  currencyCode: "USD"

derived:
  sourceTransactionId:
    strategy: hash
    fields:
      - "sourceAccountId"
      - "Transaction Date"
      - "Description"
      - "Merchant"
      - "Type"
      - "Amount (USD)"
      - "Purchased By"

  direction:
    strategy: from_signed_amount

  transactionClass:
    strategy: classifier

  merchantNorm:
    strategy: normalize_text

  descriptionNorm:
    strategy: normalize_text

  keywordArray:
    strategy: extract_keywords

  rawPayloadJson:
    strategy: preserve_entire_row
```

### Implementation Notes

When wiring this into the runner:

1. Match the claimed file against `source-mappings/apple_card.transactions.csv.v1.yaml`.
2. Parse the CSV headers and rows.
3. Resolve `postedAt` from `Clearing Date`, with fallback to `Transaction Date`.
4. Resolve `pending` from whether `Clearing Date` is blank.
5. Convert card-statement signs into warehouse signs so purchases become negative outflows and payments become positive inflows.
6. Write the canonical payload into `raw_finance.transaction_events.payload`.

Classification note:

- Capturing both `institutionCategory` and `transactionType` is important for Apple Card because payment rows may not be recognizable from description text alone.

### Open Questions

- Does Apple Card ever include a stable native transaction identifier in any export variant?
- Besides `Purchase` and `Payment`, what additional `Type` values can appear and how should they affect sign handling?

## Feed 3: Chase Card Activity (...1325)

### Source Summary

- Source system: `chase`
- Feed: `card_1325`
- File example: `Chase1325_Activity20240409_2026`
- Format: `csv`
- Confirmed by user:
  - This appears to be a Chase credit card activity export.
  - `Transaction Date` appears to be the authorization or original activity date.
  - `Post Date` appears to be the settlement or posting date.
  - A blank `Post Date` means pending is `true`.
  - `Amount` already appears to follow warehouse sign conventions in the sample rows:
    - `Payment` and `Refund` are positive
    - `Sale` and `Fee` are negative

### Source Headers

- `Transaction Date`
- `Post Date`
- `Description`
- `Category`
- `Type`
- `Amount`
- `Memo`

### Mapping Status

Status: ready for first pass

### Source To Canonical Mapping

| Source field | Canonical target | Mapping rule |
| --- | --- | --- |
| file context | `sourceAccountId` | Default to `chase_card_1325` because the file has no account identifier column |
| file context | `accountName` | Default to `Chase Card 1325` until the exact product name is known |
| file context | `accountType` | Default to `credit` |
| file context | `accountSubtype` | Default to `credit_card` |
| file context | `accountMask` | Default to `1325` |
| `Transaction Date` | `authorizedAt` | Parse using `M/D/YY` and coerce to a date-based timestamp |
| `Post Date` | `postedAt` | Parse using `M/D/YY`; if blank, fall back to `Transaction Date` |
| `Description` | `descriptionRaw` | Direct map |
| `Description` | `merchantRaw` | Direct map for now because merchant is not split separately |
| `Category` | `institutionCategory` | Direct map |
| `Type` | `transactionType` | Direct map |
| `Memo` | `memo` | Direct map |
| `Amount` | `signedAmount` | Direct parse using the source sign |
| full source row | `rawPayloadJson` | Preserve entire row as lineage |

### Defaults And Derived Fields

Defaults:

- `sourceAccountId`: `chase_card_1325`
- `accountName`: `Chase Card 1325`
- `accountType`: `credit`
- `accountSubtype`: `credit_card`
- `accountMask`: `1325`
- `currencyCode`: `USD`

Derived fields:

- `sourceTransactionId`
  - Generate deterministically from `sourceAccountId`, `Transaction Date`, `Description`, `Type`, `Amount`, and `Memo`
  - Do not include `Post Date` in the hash so the ID stays stable if a pending row later posts
- `pending`
  - Set to `true` when `Post Date` is blank, otherwise `false`
- `direction`
  - Derive from signed amount
- `transactionClass`
  - Derive from the classification and normalization layer
- `merchantNorm`
  - Derive from normalized merchant text
- `descriptionNorm`
  - Derive from normalized description text
- `keywordArray`
  - Derive from normalized text

Special handling:

- Use the source sign as-is for `Amount`
- Preserve both `Category` and `Type` because fee, refund, payment, and expense semantics depend on them
- Preserve `Memo` because it may contain merchant detail or additional reconciliation context

### Proposed Mapping Config

Proposed config file:

- `source-mappings/chase.card_1325.csv.v1.yaml`

```yaml
id: chase.card_1325.csv.v1
source_system: chase
feed: card_1325
format: csv

file_match:
  filename_contains:
    - "Chase1325"
    - "Activity"

field_map:
  sourceAccountId:
    default: "chase_card_1325"

  accountName:
    default: "Chase Card 1325"

  accountType:
    default: "credit"

  accountSubtype:
    default: "credit_card"

  accountMask:
    default: "1325"

  authorizedAt:
    source: "Transaction Date"
    transform:
      parse_as: "M/D/YY"
      coerce_to: "timestamp"

  postedAt:
    source: "Post Date"
    fallback_source: "Transaction Date"
    transform:
      parse_as: "M/D/YY"

  descriptionRaw:
    source: "Description"

  merchantRaw:
    source: "Description"

  institutionCategory:
    source: "Category"

  transactionType:
    source: "Type"

  memo:
    source: "Memo"

  signedAmount:
    source: "Amount"
    transform:
      use_source_sign: true

  pending:
    transform:
      true_when_blank: "Post Date"

defaults:
  currencyCode: "USD"

derived:
  sourceTransactionId:
    strategy: hash
    fields:
      - "sourceAccountId"
      - "Transaction Date"
      - "Description"
      - "Type"
      - "Amount"
      - "Memo"

  direction:
    strategy: from_signed_amount

  transactionClass:
    strategy: classifier

  merchantNorm:
    strategy: normalize_text

  descriptionNorm:
    strategy: normalize_text

  keywordArray:
    strategy: extract_keywords

  rawPayloadJson:
    strategy: preserve_entire_row
```

### Implementation Notes

When wiring this into the runner:

1. Match the claimed file against `source-mappings/chase.card_1325.csv.v1.yaml`.
2. Parse the CSV headers and rows.
3. Resolve `postedAt` from `Post Date`, with fallback to `Transaction Date`.
4. Resolve `pending` from whether `Post Date` is blank.
5. Preserve the source sign on `Amount` instead of inverting it.
6. Write the canonical payload into `raw_finance.transaction_events.payload`.

Classification note:

- Capturing both `institutionCategory` and `transactionType` is important because Chase uses `Type` values like `Payment`, `Refund`, `Fee`, and `Sale`, while `Category` provides a different signal such as `Travel`, `Shopping`, or `Fees & Adjustments`.

### Open Questions

- Does this export ever include a stable native transaction identifier in any variant?
- What is the exact Chase card product name for account `...1325` if we want a cleaner `accountName` than `Chase Card 1325`?

## Feed 4: American Express Activity

### Source Summary

- Source system: `american_express`
- Feed: `activity`
- File example: `activity`
- Format: `csv`
- Confirmed by user:
  - The leading date header is `Date`.
  - The export appears to be a credit card activity feed.
  - The source amount convention is the inverse of the warehouse convention in the sample rows:
    - purchases, fees, and interest charges are positive in the file
    - payments and reversals are negative in the file
    - for warehouse ingestion, those signs should be inverted

### Source Headers

- `Date`
- `Description`
- `Amount`
- `Extended Details`
- `Appears On Your Statement As`
- `Address`
- `City/State`
- `Zip Code`
- `Country`
- `Reference`
- `Category`

### Mapping Status

Status: ready for first pass

### Source To Canonical Mapping

| Source field | Canonical target | Mapping rule |
| --- | --- | --- |
| runtime feed context | `sourceAccountId` | Inject from feed config or bucket path because the file does not identify the specific card account |
| runtime feed context | `accountName` | Inject from feed config; fallback to `American Express Card` |
| runtime feed context | `accountType` | Default to `credit` |
| runtime feed context | `accountSubtype` | Default to `credit_card` |
| `Date` | `postedAt` | Parse using `M/D/YY` |
| `Description` | `merchantRaw` | Direct map from merchant-style shorthand |
| `Appears On Your Statement As` | `descriptionRaw` | Direct map from full statement descriptor |
| `Appears On Your Statement As` | `originalDescription` | Direct map |
| `Extended Details` | `memo` | Direct map |
| `Category` | `institutionCategory` | Direct map |
| `Reference` | `referenceNumber` | Direct map after trimming wrapping quotes if present |
| `Amount` | `signedAmount` | Invert the source sign so charges become negative and payments become positive |
| `Zip Code` | `merchantPostalCode` | Direct map when populated |
| `Country` | `merchantCountry` | Direct map when populated |
| full source row | `rawPayloadJson` | Preserve entire row as lineage |

### Defaults And Derived Fields

Defaults:

- `sourceAccountId`: inject from runtime feed context when available
- `accountName`: inject from runtime feed context when available
- `accountType`: `credit`
- `accountSubtype`: `credit_card`
- `currencyCode`: `USD`
- `authorizedAt`: `null`
- `pending`: `false`

Derived fields:

- `sourceTransactionId`
  - Prefer `Reference` when present because it looks like a stable transaction identifier
  - Fallback to a hash of `Date`, `Description`, `Appears On Your Statement As`, `Amount`, and `Extended Details`
- `direction`
  - Derive from normalized signed amount
- `transactionClass`
  - Derive from the classification and normalization layer
- `merchantNorm`
  - Derive from normalized merchant text
- `descriptionNorm`
  - Derive from normalized description text
- `keywordArray`
  - Derive from normalized text

Special handling:

- Invert the source sign on every row
- Preserve `Reference` because it is more likely to be stable across replays than text-based hashes
- Preserve `Address` and `City/State` in `rawPayloadJson` for now rather than forcing a brittle parse into `merchantCity` and `merchantState`

### Proposed Mapping Config

Proposed config file:

- `source-mappings/american_express.activity.csv.v1.yaml`

```yaml
id: american_express.activity.csv.v1
source_system: american_express
feed: activity
format: csv

file_match:
  filename_contains:
    - "activity"
  required_headers:
    - "Description"
    - "Amount"
    - "Extended Details"
    - "Appears On Your Statement As"
    - "Reference"
    - "Category"

field_map:
  sourceAccountId:
    from_runtime_context: "sourceAccountId"
    fallback_default: "american_express_card"

  accountName:
    from_runtime_context: "accountName"
    fallback_default: "American Express Card"

  accountType:
    default: "credit"

  accountSubtype:
    default: "credit_card"

  postedAt:
    source: "Date"
    transform:
      parse_as: "M/D/YY"
    note: "Header name inferred from screenshot and must be confirmed."

  merchantRaw:
    source: "Description"

  descriptionRaw:
    source: "Appears On Your Statement As"

  originalDescription:
    source: "Appears On Your Statement As"

  memo:
    source: "Extended Details"

  institutionCategory:
    source: "Category"

  referenceNumber:
    source: "Reference"
    transform:
      trim_wrapping_quotes: true

  signedAmount:
    source: "Amount"
    transform:
      invert_source_sign: true

  merchantPostalCode:
    source: "Zip Code"

  merchantCountry:
    source: "Country"

defaults:
  authorizedAt: null
  pending: false
  currencyCode: "USD"

derived:
  sourceTransactionId:
    strategy: prefer_field
    field: "Reference"
    fallback:
      strategy: hash
      fields:
        - "Date"
        - "Description"
        - "Appears On Your Statement As"
        - "Amount"
        - "Extended Details"

  direction:
    strategy: from_signed_amount

  transactionClass:
    strategy: classifier

  merchantNorm:
    strategy: normalize_text

  descriptionNorm:
    strategy: normalize_text

  keywordArray:
    strategy: extract_keywords

  rawPayloadJson:
    strategy: preserve_entire_row
```

### Implementation Notes

When wiring this into the runner:

1. Match the file using header signature first, because the filename `activity` is too generic on its own.
2. Inject `sourceAccountId` and `accountName` from feed configuration or bucket path context.
3. Invert the source sign on `Amount` so purchases and fees become negative warehouse outflows and payments become positive inflows.
4. Use `Reference` as the primary transaction identifier when populated.

Classification note:

- Capturing both `institutionCategory` and the full statement descriptor is important here because Amex rows like `AUTOPAY PAYMENT`, `LATE FEE`, `INTEREST CHARGE`, and merchant purchases all need different downstream treatment.

### Open Questions

- Does this export ever include pending rows, or is it confirmed-only activity?
- Can we identify the specific Amex card account from file context so `sourceAccountId` and `accountName` are stable across replays?

## Feed 5: Micro Center Credit Card Export

### Source Summary

- Source system: `micro_center`
- Feed: `credit_card_1`
- File example: `CreditCard1`
- Format: `csv`
- Confirmed by user:
  - The file appears to be headerless.
  - The visible row structure is position-based rather than name-based.
  - The first visible column date is effectively both transaction date and post date.
  - The second visible column is an amount that already appears to match warehouse sign conventions:
    - charges and fees are negative
    - payments are positive
  - The `*` marker column can be ignored.
  - The export does not include pending rows.
  - The last visible populated column is a description field with values like `ONLINE ACH`, `LATE FEE`, `INTEREST CHARGE`, and `MICRO CENTER`.

### Observed Column Positions

Because this export does not expose headers, the mapping should be position-based.

- column 1: date
- column 2: amount
- column 3: ignorable marker
- column 4: empty in sample rows
- column 5: empty in sample rows
- column 6: description

### Mapping Status

Status: ready for first pass

### Source To Canonical Mapping

| Source position | Canonical target | Mapping rule |
| --- | --- | --- |
| runtime feed context | `sourceAccountId` | Inject from feed config or default to `micro_center_card` |
| runtime feed context | `accountName` | Inject from feed config or default to `Micro Center Card` |
| runtime feed context | `accountType` | Default to `credit` |
| runtime feed context | `accountSubtype` | Default to `credit_card` |
| column 1 | `postedAt` | Parse using `M/D/YY` |
| column 1 | `authorizedAt` | Parse using `M/D/YY` and coerce to a date-based timestamp |
| column 6 | `descriptionRaw` | Direct map |
| column 6 | `merchantRaw` | Direct map |
| column 2 | `signedAmount` | Direct parse using the source sign |
| entire row by position | `rawPayloadJson` | Preserve complete row as lineage |

### Defaults And Derived Fields

Defaults:

- `sourceAccountId`: inject from runtime feed context when available
- `accountName`: inject from runtime feed context when available
- `accountType`: `credit`
- `accountSubtype`: `credit_card`
- `pending`: `false`
- `currencyCode`: `USD`

Derived fields:

- `sourceTransactionId`
  - Generate deterministically from `sourceAccountId`, column 1 date, column 2 amount, and column 6 description
- `direction`
  - Derive from signed amount
- `transactionClass`
  - Derive from the classification and normalization layer
- `merchantNorm`
  - Derive from normalized merchant text
- `descriptionNorm`
  - Derive from normalized description text
- `keywordArray`
  - Derive from normalized text

Special handling:

- Treat the file as headerless so the first row is data, not column names
- Keep the source sign as-is because the sample rows already match warehouse sign conventions
- Ignore the `*` marker column for mapping purposes

### Proposed Mapping Config

Proposed config file:

- `source-mappings/micro_center.credit_card_1.csv.v1.yaml`

```yaml
id: micro_center.credit_card_1.csv.v1
source_system: micro_center
feed: credit_card_1
format: csv

file_match:
  filename_contains:
    - "CreditCard1"
  header_row: absent
  expected_nonempty_columns:
    "1": date
    "2": amount
    "3": marker
    "6": description

field_map:
  sourceAccountId:
    from_runtime_context: "sourceAccountId"
    fallback_default: "micro_center_card"

  accountName:
    from_runtime_context: "accountName"
    fallback_default: "Micro Center Card"

  accountType:
    default: "credit"

  accountSubtype:
    default: "credit_card"

  postedAt:
    source_index: 1
    source_label: "column_1_date"
    transform:
      parse_as: "M/D/YY"

  authorizedAt:
    source_index: 1
    source_label: "column_1_date"
    transform:
      parse_as: "M/D/YY"
      coerce_to: "timestamp"

  descriptionRaw:
    source_index: 6
    source_label: "column_6_description"

  merchantRaw:
    source_index: 6
    source_label: "column_6_description"

  signedAmount:
    source_index: 2
    source_label: "column_2_amount"
    transform:
      use_source_sign: true

defaults:
  pending: false
  currencyCode: "USD"

derived:
  sourceTransactionId:
    strategy: hash
    fields:
      - "sourceAccountId"
      - "column_1_date"
      - "column_2_amount"
      - "column_6_description"

  direction:
    strategy: from_signed_amount

  transactionClass:
    strategy: classifier

  merchantNorm:
    strategy: normalize_text

  descriptionNorm:
    strategy: normalize_text

  keywordArray:
    strategy: extract_keywords

  rawPayloadJson:
    strategy: preserve_entire_row
```

### Implementation Notes

When wiring this into the runner:

1. Treat this feed as headerless and skip header inference entirely.
2. Match the file using both filename and observed column-position shape.
3. Inject `sourceAccountId` and `accountName` from feed configuration if possible, because the filename is generic.
4. Preserve the source sign on `Amount`.
5. Ignore the marker column for semantic mapping.

Classification note:

- This feed contains rows like `ONLINE ACH`, `LATE FEE`, `INTEREST CHARGE`, and merchant purchases, so preserving the free-text description is essential for later movement classification.

### Open Questions

- Can we identify the specific Micro Center card account from file context so `sourceAccountId` and `accountName` are stable across replays?

## Feed 6: Discover All Available Export

### Source Summary

- Source system: `discover`
- Feed: `all_available`
- File example: `Discover-AllAvailable-20260409`
- Format: `csv`
- Confirmed by user and sample rows:
  - This appears to be a Discover credit card activity export.
  - `Trans. Date` appears to be the original transaction date.
  - `Post Date` appears to be the settlement or posting date.
  - A blank `Post Date` always means pending is `true`.
  - The source amount convention is the inverse of the warehouse convention in the sample rows:
    - purchases, fees, and interest charges are positive in the file
    - payments or credits are negative in the file
    - for warehouse ingestion, those signs should be inverted

### Source Headers

- `Trans. Date`
- `Post Date`
- `Description`
- `Amount`
- `Category`

### Mapping Status

Status: ready for first pass

### Source To Canonical Mapping

| Source field | Canonical target | Mapping rule |
| --- | --- | --- |
| runtime feed context | `sourceAccountId` | Inject from feed config or default to `discover_card` |
| runtime feed context | `accountName` | Inject from feed config or default to `Discover Card` |
| runtime feed context | `accountType` | Default to `credit` |
| runtime feed context | `accountSubtype` | Default to `credit_card` |
| `Trans. Date` | `authorizedAt` | Parse using `M/D/YY` and coerce to a date-based timestamp |
| `Post Date` | `postedAt` | Parse using `M/D/YY`; if blank, fall back to `Trans. Date` |
| `Description` | `descriptionRaw` | Direct map |
| `Description` | `merchantRaw` | Direct map for now because merchant is not split separately |
| `Category` | `institutionCategory` | Direct map |
| `Amount` | `signedAmount` | Invert the source sign so charges become negative and payments become positive |
| full source row | `rawPayloadJson` | Preserve entire row as lineage |

### Defaults And Derived Fields

Defaults:

- `sourceAccountId`: inject from runtime feed context when available
- `accountName`: inject from runtime feed context when available
- `accountType`: `credit`
- `accountSubtype`: `credit_card`
- `currencyCode`: `USD`

Derived fields:

- `sourceTransactionId`
  - Generate deterministically from `sourceAccountId`, `Trans. Date`, `Description`, `Amount`, and `Category`
  - Do not include `Post Date` in the hash so the ID stays stable if a pending row later posts
- `pending`
  - Set to `true` when `Post Date` is blank, otherwise `false`
- `direction`
  - Derive from normalized signed amount
- `transactionClass`
  - Derive from the classification and normalization layer
- `merchantNorm`
  - Derive from normalized merchant text
- `descriptionNorm`
  - Derive from normalized description text
- `keywordArray`
  - Derive from normalized text

Special handling:

- Invert the source sign on every row
- Preserve `Category` because it distinguishes rows like `Merchandise`, `Supermarkets`, `Restaurants`, `Interest`, `Fees`, and `Payments and Credits`

### Proposed Mapping Config

Proposed config file:

- `source-mappings/discover.all_available.csv.v1.yaml`

```yaml
id: discover.all_available.csv.v1
source_system: discover
feed: all_available
format: csv

file_match:
  filename_contains:
    - "Discover"
    - "AllAvailable"
  required_headers:
    - "Trans. Date"
    - "Post Date"
    - "Description"
    - "Amount"
    - "Category"

field_map:
  sourceAccountId:
    from_runtime_context: "sourceAccountId"
    fallback_default: "discover_card"

  accountName:
    from_runtime_context: "accountName"
    fallback_default: "Discover Card"

  accountType:
    default: "credit"

  accountSubtype:
    default: "credit_card"

  authorizedAt:
    source: "Trans. Date"
    transform:
      parse_as: "M/D/YY"
      coerce_to: "timestamp"

  postedAt:
    source: "Post Date"
    fallback_source: "Trans. Date"
    transform:
      parse_as: "M/D/YY"

  descriptionRaw:
    source: "Description"

  merchantRaw:
    source: "Description"

  institutionCategory:
    source: "Category"

  signedAmount:
    source: "Amount"
    transform:
      invert_source_sign: true

  pending:
    transform:
      true_when_blank: "Post Date"

defaults:
  currencyCode: "USD"

derived:
  sourceTransactionId:
    strategy: hash
    fields:
      - "sourceAccountId"
      - "Trans. Date"
      - "Description"
      - "Amount"
      - "Category"

  direction:
    strategy: from_signed_amount

  transactionClass:
    strategy: classifier

  merchantNorm:
    strategy: normalize_text

  descriptionNorm:
    strategy: normalize_text

  keywordArray:
    strategy: extract_keywords

  rawPayloadJson:
    strategy: preserve_entire_row
```

### Implementation Notes

When wiring this into the runner:

1. Match the file using both filename and header signature.
2. Inject `sourceAccountId` and `accountName` from feed configuration if possible, because the filename does not identify the specific card account.
3. Resolve `postedAt` from `Post Date`, with fallback to `Trans. Date`.
4. Invert the source sign on `Amount` so purchases, fees, and interest become negative warehouse outflows and payments become positive inflows.
5. Resolve `pending` from whether `Post Date` is blank.

Classification note:

- Preserving both `Description` and `Category` is important because Discover rows like `LATE FEE`, `INTEREST CHARGE`, merchant purchases, and payments each need different downstream treatment.

### Open Questions

- Can we identify the specific Discover card account from file context so `sourceAccountId` and `accountName` are stable across replays?
- Does this export include a stable native transaction identifier in any variant?

## Future Sources

Add future source mappings below as they are reviewed.
