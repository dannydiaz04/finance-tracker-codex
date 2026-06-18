# Dropbox — raw data drop folder

Drop raw bank/card CSV exports here. Files in this folder (except this README)
are gitignored and never committed.

## How to use

1. Export a CSV from your bank/card and drop it in this folder.
2. **Prefix the filename with its source** so it gets parsed correctly:

   | Prefix | Source |
   |---|---|
   | `chase-` | Chase |
   | `discover-` | Discover |
   | `american_express-` | Amex |
   | `apple_card-` | Apple Card |
   | `capital_one-` | Capital One |
   | `micro_center-` | Micro Center card |
   | `manual-` (or anything else) | generic CSV |

   Examples: `chase-activity.csv`, `discover-april.csv`, `apple_card-2026.csv`

3. Run the processor:

   ```bash
   npm run etl:dropbox          # upload to bucket -> process -> refresh marts
   npm run etl:dropbox -- --dry-run    # preview classification, change nothing
   ```

## What happens

Each file is uploaded to the GCS landing bucket under
`incoming/<source>/<YYYY>/<MM>/<DD>/`, processed by the ETL runner
(`incoming → processing → archive`/`rejected`, rows loaded into BigQuery
`raw_finance`), and then Dataform rebuilds the marts the app reads. After it
finishes, reload <http://localhost:3000/overview>.

Uploaded originals are moved to `dropbox/_uploaded/<date>/` so they aren't
re-processed.

## Generic / unknown CSVs

If a file isn't from a known source, name it `manual-...csv`. For best results
add a sidecar named `<file>.context.json` next to it:

```json
{
  "sourceAccountId": "my_account",
  "accountName": "My Account",
  "accountMask": "1234"
}
```
