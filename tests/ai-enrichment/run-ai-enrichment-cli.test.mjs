import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAiEnrichmentCli } from "../../scripts/run-ai-enrichment.ts";

function withCleanEnv(keys, runTest) {
  const previousValues = new Map(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) {
    delete process.env[key];
  }

  return Promise.resolve()
    .then(runTest)
    .finally(() => {
      for (const key of keys) {
        const previousValue = previousValues.get(key);

        if (typeof previousValue === "undefined") {
          delete process.env[key];
        } else {
          process.env[key] = previousValue;
        }
      }
    });
}

function createEmptySummary(overrides = {}) {
  return {
    runId: "ai-cat-test",
    model: "env-file-model",
    modelProvider: "fake",
    promptVersion: "prompt-test",
    rulesVersion: "rules-test",
    taxonomyVersion: "taxonomy-test",
    candidateCount: 0,
    skippedUnchangedCount: 0,
    enrichedCount: 0,
    insertedCount: 0,
    acceptedCount: 0,
    needsReviewCount: 0,
    rejectedCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    tokensUsed: 0,
    stoppedForBudget: false,
    ...overrides,
  };
}

test("AI enrichment CLI loads .env.local before invoking the runner", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "finance-tracker-ai-cli-"));
  writeFileSync(
    join(projectDir, ".env.local"),
    [
      "OPENAI_CATEGORIZATION_MODEL=env-file-model",
      "OPENAI_API_KEY=env-file-key",
      "",
    ].join("\n"),
  );

  const logs = [];
  let receivedOptions = null;

  await withCleanEnv(
    [
      "__NEXT_PROCESSED_ENV",
      "NODE_ENV",
      "OPENAI_API_KEY",
      "OPENAI_CATEGORIZATION_MODEL",
      "OPENAI_MODEL",
    ],
    async () => {
      process.env.NODE_ENV = "development";

      await runAiEnrichmentCli({
        argv: ["--limit", "3", "--batch-size", "2", "--json"],
        cwd: projectDir,
        logger: {
          log: (message) => logs.push(String(message)),
        },
        runEnrichment: async (options) => {
          receivedOptions = options;

          return createEmptySummary({
            model: process.env.OPENAI_CATEGORIZATION_MODEL,
          });
        },
      });
    },
  );

  assert.equal(process.env.OPENAI_CATEGORIZATION_MODEL, undefined);
  assert.equal(process.env.OPENAI_API_KEY, undefined);
  assert.deepEqual(receivedOptions, {
    limit: 3,
    batchSize: 2,
    model: undefined,
    includeExisting: undefined,
    autoAcceptThreshold: undefined,
    tokenBudget: undefined,
    userId: undefined,
  });

  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0]).model, "env-file-model");
});
