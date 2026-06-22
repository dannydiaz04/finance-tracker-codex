import { parseArgs } from "node:util";

import { runAiCategoryEnrichment } from "../lib/ai-enrichment/category-classifier.ts";

function printHelp() {
  console.log(`Usage: npm run etl:ai-enrich -- [options]

Options:
  --limit <count>             Maximum queue rows to enrich. Defaults to 50
  --batch-size <count>        Transactions per OpenAI request. Defaults to 20
  --model <name>              Overrides OPENAI_CATEGORIZATION_MODEL / OPENAI_MODEL
  --auto-accept-threshold <n> Minimum final confidence for canonical AI acceptance. Defaults to 0.90
  --include-existing          Reprocess transactions with accepted or needs_review AI results
  --token-budget <count>      Stop dispatching batches once this many model tokens are spent
  --user-id <id>              Only enrich rows for this user. Defaults to all users
  --json                      Print the full run summary as JSON
  --help                      Show this help text

Environment:
  OPENAI_API_KEY              Required when asking OpenAI to categorize
  OPENAI_CATEGORIZATION_MODEL Optional model override for ETL categorization
  OPENAI_MODEL                Shared fallback model if OPENAI_CATEGORIZATION_MODEL is unset
`);
}

function parsePositiveInteger(value: string | undefined, optionName: string) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer.`);
  }

  return parsed;
}

function parseThreshold(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new Error("--auto-accept-threshold must be greater than 0 and at most 1.");
  }

  return parsed;
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: {
        type: "string",
      },
      "batch-size": {
        type: "string",
      },
      model: {
        type: "string",
      },
      "auto-accept-threshold": {
        type: "string",
      },
      "include-existing": {
        type: "boolean",
      },
      "token-budget": {
        type: "string",
      },
      "user-id": {
        type: "string",
      },
      json: {
        type: "boolean",
      },
      help: {
        type: "boolean",
      },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const summary = await runAiCategoryEnrichment({
    limit: parsePositiveInteger(values.limit, "--limit"),
    batchSize: parsePositiveInteger(values["batch-size"], "--batch-size"),
    model: values.model,
    includeExisting: values["include-existing"],
    autoAcceptThreshold: parseThreshold(values["auto-accept-threshold"]),
    tokenBudget: parsePositiveInteger(values["token-budget"], "--token-budget"),
    userId: values["user-id"]?.trim() || undefined,
  });

  if (values.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(
    `AI enrichment run ${summary.runId} processed ${summary.enrichedCount} candidate transaction(s) with ${summary.modelProvider}/${summary.model}.`,
  );
  console.log(
    `Inserted ${summary.insertedCount} result row(s): ${summary.acceptedCount} accepted, ${summary.needsReviewCount} needs review, ${summary.rejectedCount} rejected.`,
  );
  console.log(
    `Skipped ${summary.skippedUnchangedCount} unchanged row(s); spent ${summary.tokensUsed} token(s) (${summary.inputTokens} in / ${summary.outputTokens} out)${
      summary.stoppedForBudget ? " — stopped early on token budget" : ""
    }.`,
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "AI enrichment runner failed.",
  );
  process.exitCode = 1;
});
