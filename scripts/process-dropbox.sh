#!/usr/bin/env bash
#
# process-dropbox.sh
#
# Takes raw bank/card CSV exports dropped into ./dropbox, classifies each by its
# filename prefix, uploads it to the GCS landing bucket under the dated
# incoming/<source>/<YYYY>/<MM>/<DD>/ contract, then runs the ETL runner and a
# Dataform refresh so the app shows the latest numbers.
#
# Usage:
#   scripts/process-dropbox.sh                 # upload + process + dataform refresh
#   scripts/process-dropbox.sh --no-dataform   # upload + process only
#   scripts/process-dropbox.sh --dry-run       # show what would happen, change nothing
#
# Naming contract: prefix each file with its source, e.g.
#   chase-activity.csv, discover-export.csv, american_express-2026.csv,
#   apple_card-april.csv, capital_one-checking.csv, micro_center-card.csv
# Anything unrecognized is treated as "manual" (generic CSV header inference).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DROPBOX_DIR="${REPO_ROOT}/dropbox"
BUCKET="${WAREHOUSE_LANDING_BUCKET:-finance-tracker-cdx-etl-landing}"
MAX_FILES="${ETL_MAX_FILES:-50}"

RUN_DATAFORM=1
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-dataform) RUN_DATAFORM=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Known source systems (longest names first so e.g. apple_card wins over apple).
KNOWN_SOURCES=(american_express apple_card capital_one micro_center chase discover manual)

classify() {
  # Lowercased basename -> source system based on filename prefix.
  local name
  name="$(basename "$1" | tr '[:upper:]' '[:lower:]')"
  for src in "${KNOWN_SOURCES[@]}"; do
    if [[ "$name" == "$src"-* || "$name" == "$src"_* || "$name" == "$src".* ]]; then
      echo "$src"
      return 0
    fi
  done
  echo "manual"
}

YYYY="$(date +%Y)"
MM="$(date +%m)"
DD="$(date +%d)"

shopt -s nullglob nocaseglob
csv_files=("${DROPBOX_DIR}"/*.csv)
shopt -u nocaseglob

if [[ ${#csv_files[@]} -eq 0 ]]; then
  echo "No .csv files found in ${DROPBOX_DIR}. Drop files there and re-run."
  exit 0
fi

echo "Found ${#csv_files[@]} file(s) in dropbox. Bucket: gs://${BUCKET}"
echo "Dated path: incoming/<source>/${YYYY}/${MM}/${DD}/"
echo

uploaded=0
for f in "${csv_files[@]}"; do
  base="$(basename "$f")"
  src="$(classify "$f")"
  dest="gs://${BUCKET}/incoming/${src}/${YYYY}/${MM}/${DD}/${base}"

  echo "• ${base}  ->  ${src}"
  echo "    ${dest}"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    [[ -f "${f}.context.json" ]] && echo "    (+ sidecar ${base}.context.json)"
    continue
  fi

  gcloud storage cp "$f" "$dest" >/dev/null
  if [[ -f "${f}.context.json" ]]; then
    gcloud storage cp "${f}.context.json" "${dest}.context.json" >/dev/null
    echo "    uploaded sidecar context.json"
  fi

  # Move the local original out of the active drop area so it isn't re-uploaded.
  mkdir -p "${DROPBOX_DIR}/_uploaded/${YYYY}-${MM}-${DD}"
  mv "$f" "${DROPBOX_DIR}/_uploaded/${YYYY}-${MM}-${DD}/"
  [[ -f "${f}.context.json" ]] && mv "${f}.context.json" "${DROPBOX_DIR}/_uploaded/${YYYY}-${MM}-${DD}/"
  uploaded=$((uploaded + 1))
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "Dry run complete. No files were uploaded or processed."
  exit 0
fi

echo
echo "Uploaded ${uploaded} file(s). Running ETL runner against the bucket..."
cd "$REPO_ROOT"
npm run etl:runner -- --gcs-bucket "$BUCKET" --max-files "$MAX_FILES"

if [[ "$RUN_DATAFORM" -eq 1 ]]; then
  echo
  echo "Refreshing Dataform marts so the app shows the latest numbers..."
  npx dataform run dataform
fi

echo
echo "Done. Reload the app at http://localhost:3000/overview to see the latest numbers."
