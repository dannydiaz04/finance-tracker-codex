import { parseArgs } from "node:util";

import {
  getBigQueryProjectId,
  runBigQueryQuery,
} from "../lib/bigquery/client.ts";

// Read-only accuracy harness for the AI category classifier. Scores the latest
// suggestion per transaction against the user's manual_overrides (the human
// ground truth), grouped by prompt / rules / taxonomy / model version so prompt
// and model changes are measurable over time. Selects no secret columns and
// writes nothing.

type EvalRow = {
  promptVersion: unknown;
  rulesVersion: unknown;
  taxonomyVersion: unknown;
  model: unknown;
  modelProvider: unknown;
  scoredRows: unknown;
  evaluated: unknown;
  correct: unknown;
  accepted: unknown;
  acceptedEvaluated: unknown;
  acceptedCorrect: unknown;
};

function printHelp() {
  console.log(`Usage: npm run eval:ai-categories -- [options]

Scores ai_enrichment_results against manual_overrides (ground truth).

Options:
  --user-id <id>   Only score rows for this user. Defaults to all users
  --json           Print the raw metric rows as JSON
  --help           Show this help text

Metrics per (prompt/rules/taxonomy/model) version:
  precision        correct / evaluated (suggestions that have a human override)
  auto-accept rate accepted / scored rows
  accept precision correct / evaluated, among auto-accepted suggestions
`);
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toLabel(value: unknown) {
  const text = typeof value === "string" ? value.trim() : String(value ?? "");
  return text.length > 0 ? text : "(none)";
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return "n/a";
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "user-id": { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const projectId = getBigQueryProjectId();

  if (!projectId) {
    throw new Error("BIGQUERY_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required.");
  }

  const userId = values["user-id"]?.trim() ?? "";
  const rows = await runBigQueryQuery<EvalRow>(
    `
      WITH overrides AS (
        SELECT transaction_id, truth_category_id
        FROM (
          SELECT
            transaction_id,
            category_id AS truth_category_id,
            ROW_NUMBER() OVER (
              PARTITION BY transaction_id
              ORDER BY updated_at DESC
            ) AS override_rank
          FROM \`${projectId}.ops_finance.manual_overrides\`
          WHERE (@userId = '' OR user_id = @userId)
        )
        WHERE override_rank = 1
      ),
      latest_results AS (
        SELECT
          prompt_version,
          rules_version,
          taxonomy_version,
          model,
          model_provider,
          transaction_id,
          suggested_category_id,
          status,
          ROW_NUMBER() OVER (
            PARTITION BY
              prompt_version, rules_version, taxonomy_version, transaction_id
            ORDER BY created_at DESC
          ) AS result_rank
        FROM \`${projectId}.ops_finance.ai_enrichment_results\`
        WHERE (@userId = '' OR user_id = @userId)
      )
      SELECT
        lr.prompt_version AS promptVersion,
        lr.rules_version AS rulesVersion,
        lr.taxonomy_version AS taxonomyVersion,
        lr.model AS model,
        lr.model_provider AS modelProvider,
        COUNT(*) AS scoredRows,
        COUNTIF(o.truth_category_id IS NOT NULL) AS evaluated,
        COUNTIF(
          o.truth_category_id IS NOT NULL
          AND lr.suggested_category_id = o.truth_category_id
        ) AS correct,
        COUNTIF(lr.status = 'accepted') AS accepted,
        COUNTIF(
          lr.status = 'accepted' AND o.truth_category_id IS NOT NULL
        ) AS acceptedEvaluated,
        COUNTIF(
          lr.status = 'accepted'
          AND o.truth_category_id IS NOT NULL
          AND lr.suggested_category_id = o.truth_category_id
        ) AS acceptedCorrect
      FROM latest_results AS lr
      LEFT JOIN overrides AS o
        ON o.transaction_id = lr.transaction_id
      WHERE lr.result_rank = 1
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY scoredRows DESC
    `,
    { userId },
  );

  if (rows === null) {
    throw new Error(
      "BigQuery is not configured (missing credentials); cannot evaluate.",
    );
  }

  if (values.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log("No AI enrichment results found for the requested scope.");
    return;
  }

  console.log(
    `AI category accuracy vs. manual overrides${
      userId ? ` for user ${userId}` : " (all users)"
    }:\n`,
  );

  for (const row of rows) {
    const scoredRows = toNumber(row.scoredRows);
    const evaluated = toNumber(row.evaluated);
    const correct = toNumber(row.correct);
    const accepted = toNumber(row.accepted);
    const acceptedEvaluated = toNumber(row.acceptedEvaluated);
    const acceptedCorrect = toNumber(row.acceptedCorrect);

    console.log(
      `· ${toLabel(row.promptVersion)} / ${toLabel(row.rulesVersion)} / tax:${toLabel(
        row.taxonomyVersion,
      )} · ${toLabel(row.modelProvider)}/${toLabel(row.model)}`,
    );
    console.log(
      `    rows=${scoredRows}  evaluated=${evaluated}  precision=${ratio(
        correct,
        evaluated,
      )}  auto-accept=${ratio(accepted, scoredRows)}  accept-precision=${ratio(
        acceptedCorrect,
        acceptedEvaluated,
      )}`,
    );
  }

  console.log(
    "\nNote: precision is measured only on transactions that have a manual override.",
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "AI category evaluation failed.",
  );
  process.exitCode = 1;
});
