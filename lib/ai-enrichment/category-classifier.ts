import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  getBigQueryProjectId,
  insertBigQueryRows,
  runBigQueryQuery,
} from "../bigquery/client.ts";

export const CATEGORY_CLASSIFIER_PROMPT_VERSION = "category-classifier.v1";
export const CATEGORY_CLASSIFIER_RULES_VERSION = "category-guidelines.v1";
export const DEFAULT_CATEGORY_MODEL = "gpt-5.2";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_LIMIT = 50;
const DEFAULT_AUTO_ACCEPT_THRESHOLD = 0.9;

type OpenAIResponsePayload = {
  id?: string;
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string | { value?: string };
    }>;
  }>;
  error?: {
    message?: string;
  };
};

export type CategoryTaxonomyItem = {
  categoryId: string;
  label: string;
  categoryL1: string;
  categoryL2: string;
};

export type AiEnrichmentQueueRow = {
  transactionId: string;
  accountId: string;
  accountName: string;
  postedAt: string;
  signedAmount: number;
  merchantRaw: string;
  merchantNorm: string;
  descriptionRaw: string;
  descriptionNorm: string;
  institutionCategory: string | null;
  derivedCategoryId: string;
  categoryLabel: string;
  transactionClass: string;
  classificationSource: string;
  confidenceScore: number;
  keywordArray: string[];
  enrichmentReason: string;
};

export type CategoryCandidate = {
  categoryId: string;
  confidence: number;
};

export type CategoryClassifierSuggestion = {
  transactionId: string;
  categoryId: string;
  confidence: number;
  normalizedMerchant?: string | null;
  secondaryCandidates?: CategoryCandidate[];
  signals?: string[];
  reason?: string;
};

export type CategoryClassifierBatchResponse = {
  responseId: string | null;
  results: CategoryClassifierSuggestion[];
};

export type CategoryClassifierDecision = {
  transaction: AiEnrichmentQueueRow;
  suggestion: CategoryClassifierSuggestion;
  category: CategoryTaxonomyItem | null;
  inputHash: string;
  inputJson: Record<string, unknown>;
  modelOutputJson: Record<string, unknown>;
  modelConfidenceScore: number;
  confidenceScore: number;
  confidenceLevel: "high" | "medium" | "low";
  confidenceNotes: string[];
  status: "accepted" | "needs_review" | "rejected";
  reviewRequired: boolean;
};

export type AiEnrichmentInsertRow = {
  run_id: string;
  transaction_id: string;
  input_hash: string;
  prompt_version: string;
  rules_version: string;
  taxonomy_version: string;
  model_provider: string;
  model: string;
  model_response_id: string | null;
  suggested_category_id: string;
  suggested_category_label: string | null;
  normalized_merchant: string | null;
  model_confidence_score: number;
  confidence_score: number;
  confidence_level: string;
  review_required: boolean;
  status: string;
  reason: string;
  confidence_notes: string[];
  signals: string[];
  secondary_candidates_json: string;
  input_json: string;
  model_output_json: string;
  created_at: string;
};

export type RunAiCategoryEnrichmentOptions = {
  limit?: number;
  batchSize?: number;
  includeExisting?: boolean;
  model?: string;
  openAiApiKey?: string;
  autoAcceptThreshold?: number;
};

export type AiCategoryEnrichmentSummary = {
  runId: string;
  model: string;
  promptVersion: string;
  rulesVersion: string;
  taxonomyVersion: string;
  candidateCount: number;
  enrichedCount: number;
  insertedCount: number;
  acceptedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
};

function normalizeString(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value && typeof value === "object" && "value" in value) {
    return normalizeString((value as { value: unknown }).value);
  }

  if (value === null || typeof value === "undefined") {
    return "";
  }

  return String(value).trim();
}

function normalizeNullableString(value: unknown) {
  const normalized = normalizeString(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (value && typeof value === "object" && "value" in value) {
    return normalizeNumber((value as { value: unknown }).value);
  }

  const parsed = Number(normalizeString(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeKeywordArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeString).filter(Boolean);
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function roundConfidence(value: number) {
  return Math.round(clamp(value) * 100) / 100;
}

function stableJson(value: unknown) {
  return JSON.stringify(value, (_key, nestedValue) => {
    if (
      nestedValue &&
      typeof nestedValue === "object" &&
      !Array.isArray(nestedValue)
    ) {
      return Object.fromEntries(
        Object.entries(nestedValue).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
    }

    return nestedValue;
  });
}

function hashValue(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function getConfidenceLevel(confidenceScore: number) {
  if (confidenceScore >= 0.9) {
    return "high";
  }

  if (confidenceScore >= 0.7) {
    return "medium";
  }

  return "low";
}

function getModelName(optionModel?: string) {
  return (
    optionModel?.trim() ||
    process.env.OPENAI_CATEGORIZATION_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    DEFAULT_CATEGORY_MODEL
  );
}

function getOpenAiApiKey(optionApiKey?: string) {
  return optionApiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || null;
}

function toPromptTransaction(row: AiEnrichmentQueueRow) {
  return {
    transactionId: row.transactionId,
    accountName: row.accountName,
    postedAt: row.postedAt,
    signedAmount: row.signedAmount,
    merchantRaw: row.merchantRaw,
    merchantNorm: row.merchantNorm,
    descriptionRaw: row.descriptionRaw,
    descriptionNorm: row.descriptionNorm,
    institutionCategory: row.institutionCategory,
    currentCategoryId: row.derivedCategoryId,
    currentCategoryLabel: row.categoryLabel,
    transactionClass: row.transactionClass,
    classificationSource: row.classificationSource,
    currentConfidenceScore: row.confidenceScore,
    keywordArray: row.keywordArray,
    enrichmentReason: row.enrichmentReason,
  };
}

function buildInputJson(
  transaction: AiEnrichmentQueueRow,
  taxonomyVersion: string,
) {
  return {
    promptVersion: CATEGORY_CLASSIFIER_PROMPT_VERSION,
    rulesVersion: CATEGORY_CLASSIFIER_RULES_VERSION,
    taxonomyVersion,
    transaction: toPromptTransaction(transaction),
  };
}

export function getTaxonomyVersion(categories: CategoryTaxonomyItem[]) {
  return hashValue(
    categories.map((category) => ({
      categoryId: category.categoryId,
      label: category.label,
      categoryL1: category.categoryL1,
      categoryL2: category.categoryL2,
    })),
  ).slice(0, 16);
}

export function buildCategoryClassifierInstructions() {
  return [
    "You are an ETL batch classifier for personal finance transactions.",
    "Classify each transaction using merchant and description patterns, not UI behavior.",
    "Use only categoryId values from the provided taxonomy. Do not invent categories.",
    "Prefer stable merchant and description evidence over the bank-provided institution category when they disagree.",
    "Treat institution category as a weak hint, not as ground truth.",
    "Do not classify a transaction as salary unless it is clearly payroll, paycheck, direct deposit, or employer income.",
    "Do not classify refunds as income just because the signed amount is positive.",
    "If the category is ambiguous, choose uncategorized with confidence below 0.70.",
    "Return one result for every input transaction.",
    "Return only JSON with this shape: {\"results\":[{\"transactionId\":\"...\",\"categoryId\":\"...\",\"confidence\":0.0,\"normalizedMerchant\":\"...\",\"secondaryCandidates\":[{\"categoryId\":\"...\",\"confidence\":0.0}],\"signals\":[\"...\"],\"reason\":\"...\"}]}",
  ].join("\n");
}

export function buildCategoryClassifierInput(
  transactions: AiEnrichmentQueueRow[],
  categories: CategoryTaxonomyItem[],
) {
  return JSON.stringify(
    {
      taxonomy: categories.map((category) => ({
        categoryId: category.categoryId,
        label: category.label,
        group: category.categoryL1,
        subcategory: category.categoryL2,
      })),
      transactions: transactions.map(toPromptTransaction),
    },
    null,
    2,
  );
}

function extractOutputText(payload: OpenAIResponsePayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const content = payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((part) => {
      if (typeof part.text === "string") {
        return part.text;
      }

      if (part.text && typeof part.text.value === "string") {
        return part.text.value;
      }

      return "";
    })
    .join("\n")
    .trim();

  return content || null;
}

function stripJsonFence(value: string) {
  const trimmed = value.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function parseJsonObjectFromText(value: string) {
  const unfenced = stripJsonFence(value);

  try {
    return JSON.parse(unfenced);
  } catch {
    const objectStart = unfenced.indexOf("{");
    const objectEnd = unfenced.lastIndexOf("}");

    if (objectStart !== -1 && objectEnd > objectStart) {
      return JSON.parse(unfenced.slice(objectStart, objectEnd + 1));
    }

    const arrayStart = unfenced.indexOf("[");
    const arrayEnd = unfenced.lastIndexOf("]");

    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      return JSON.parse(unfenced.slice(arrayStart, arrayEnd + 1));
    }

    throw new Error("Classifier response did not contain valid JSON.");
  }
}

function normalizeCandidate(value: unknown): CategoryCandidate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const categoryId = normalizeString(candidate.categoryId);

  if (!categoryId) {
    return null;
  }

  return {
    categoryId,
    confidence: roundConfidence(normalizeNumber(candidate.confidence)),
  };
}

function normalizeSuggestion(value: unknown): CategoryClassifierSuggestion | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const transactionId = normalizeString(candidate.transactionId);
  const categoryId = normalizeString(candidate.categoryId);

  if (!transactionId || !categoryId) {
    return null;
  }

  return {
    transactionId,
    categoryId,
    confidence: roundConfidence(normalizeNumber(candidate.confidence)),
    normalizedMerchant: normalizeNullableString(candidate.normalizedMerchant),
    secondaryCandidates: Array.isArray(candidate.secondaryCandidates)
      ? candidate.secondaryCandidates
          .map(normalizeCandidate)
          .filter((item): item is CategoryCandidate => Boolean(item))
      : [],
    signals: Array.isArray(candidate.signals)
      ? candidate.signals.map(normalizeString).filter(Boolean).slice(0, 8)
      : [],
    reason: normalizeString(candidate.reason),
  };
}

export function parseCategoryClassifierResponse(
  responseText: string,
): CategoryClassifierSuggestion[] {
  const parsed = parseJsonObjectFromText(responseText) as {
    results?: unknown[];
  } | unknown[];
  const results: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.results)
      ? parsed.results
      : null;

  if (!results) {
    throw new Error("Classifier JSON must include a results array.");
  }

  const suggestions = results
    .map(normalizeSuggestion)
    .filter((item): item is CategoryClassifierSuggestion => Boolean(item));

  if (suggestions.length === 0) {
    throw new Error("Classifier JSON did not include usable suggestions.");
  }

  return suggestions;
}

export async function callOpenAiCategoryClassifier({
  transactions,
  categories,
  apiKey,
  model,
}: {
  transactions: AiEnrichmentQueueRow[];
  categories: CategoryTaxonomyItem[];
  apiKey: string;
  model: string;
}): Promise<CategoryClassifierBatchResponse> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: buildCategoryClassifierInstructions(),
      input: buildCategoryClassifierInput(transactions, categories),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const payload = (await response.json()) as OpenAIResponsePayload;

  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? "OpenAI category classifier request failed.",
    );
  }

  const outputText = extractOutputText(payload);

  if (!outputText) {
    throw new Error("OpenAI category classifier returned no text output.");
  }

  return {
    responseId: payload.id ?? null,
    results: parseCategoryClassifierResponse(outputText),
  };
}

function findInstitutionHintCategoryId(institutionCategory: string | null) {
  const normalized = institutionCategory?.toLowerCase() ?? "";

  if (!normalized) {
    return null;
  }

  if (normalized.includes("travel")) {
    return "travel";
  }

  if (normalized.includes("grocery") || normalized.includes("groceries")) {
    return "groceries";
  }

  if (normalized.includes("dining") || normalized.includes("restaurant")) {
    return "dining";
  }

  return null;
}

function findTransactionClassCategoryId(transactionClass: string) {
  switch (transactionClass) {
    case "income":
      return "salary";
    case "fee":
      return "fees";
    case "transfer":
    case "credit_payment":
      return "transfers";
    default:
      return null;
  }
}

export function scoreCategorySuggestion({
  transaction,
  suggestion,
  categories,
  taxonomyVersion,
  autoAcceptThreshold = DEFAULT_AUTO_ACCEPT_THRESHOLD,
}: {
  transaction: AiEnrichmentQueueRow;
  suggestion: CategoryClassifierSuggestion;
  categories: CategoryTaxonomyItem[];
  taxonomyVersion: string;
  autoAcceptThreshold?: number;
}): CategoryClassifierDecision {
  const category = categories.find(
    (candidate) => candidate.categoryId === suggestion.categoryId,
  ) ?? null;
  const inputJson = buildInputJson(transaction, taxonomyVersion);
  const inputHash = hashValue(inputJson);
  const modelConfidenceScore = roundConfidence(suggestion.confidence);
  const confidenceNotes: string[] = [];

  if (!category) {
    return {
      transaction,
      suggestion,
      category,
      inputHash,
      inputJson,
      modelOutputJson: { ...suggestion },
      modelConfidenceScore,
      confidenceScore: 0,
      confidenceLevel: "low",
      confidenceNotes: ["Model returned a category outside the allowed taxonomy."],
      status: "rejected",
      reviewRequired: true,
    };
  }

  let confidenceScore = modelConfidenceScore;
  const classCategoryId = findTransactionClassCategoryId(
    transaction.transactionClass,
  );
  const institutionCategoryId = findInstitutionHintCategoryId(
    transaction.institutionCategory,
  );
  const strongestSecondaryConfidence = Math.max(
    0,
    ...(suggestion.secondaryCandidates ?? [])
      .filter((candidate) => candidate.categoryId !== suggestion.categoryId)
      .map((candidate) => candidate.confidence),
  );
  const margin = modelConfidenceScore - strongestSecondaryConfidence;

  if (classCategoryId && classCategoryId === suggestion.categoryId) {
    confidenceScore += 0.05;
    confidenceNotes.push("Suggestion agrees with transaction class.");
  } else if (classCategoryId && suggestion.categoryId !== "uncategorized") {
    confidenceScore -= 0.25;
    confidenceNotes.push("Suggestion conflicts with transaction class.");
  }

  if (institutionCategoryId && institutionCategoryId === suggestion.categoryId) {
    confidenceScore += 0.05;
    confidenceNotes.push("Suggestion agrees with institution category hint.");
  } else if (institutionCategoryId && suggestion.categoryId !== "uncategorized") {
    confidenceScore -= 0.05;
    confidenceNotes.push("Suggestion differs from institution category hint.");
  }

  if (strongestSecondaryConfidence > 0 && margin < 0.15) {
    confidenceScore -= 0.1;
    confidenceNotes.push("Top category is close to a secondary candidate.");
  }

  if (!suggestion.signals || suggestion.signals.length === 0) {
    confidenceScore -= 0.05;
    confidenceNotes.push("Model did not provide supporting signals.");
  }

  if (suggestion.categoryId === "uncategorized") {
    confidenceScore = Math.min(confidenceScore, 0.65);
    confidenceNotes.push("Uncategorized suggestions require review.");
  }

  const finalConfidenceScore = roundConfidence(confidenceScore);
  const status =
    finalConfidenceScore >= autoAcceptThreshold &&
    suggestion.categoryId !== "uncategorized"
      ? "accepted"
      : "needs_review";

  return {
    transaction,
    suggestion,
    category,
    inputHash,
    inputJson,
    modelOutputJson: { ...suggestion },
    modelConfidenceScore,
    confidenceScore: finalConfidenceScore,
    confidenceLevel: getConfidenceLevel(finalConfidenceScore),
    confidenceNotes:
      confidenceNotes.length > 0
        ? confidenceNotes
        : ["Model confidence accepted without additional adjustments."],
    status,
    reviewRequired: status !== "accepted",
  };
}

function buildMissingSuggestion(transaction: AiEnrichmentQueueRow) {
  return {
    transactionId: transaction.transactionId,
    categoryId: "uncategorized",
    confidence: 0.35,
    normalizedMerchant: transaction.merchantNorm || transaction.merchantRaw,
    secondaryCandidates: [],
    signals: [],
    reason: "Model did not return a suggestion for this transaction.",
  } satisfies CategoryClassifierSuggestion;
}

export function buildAiEnrichmentInsertRows({
  runId,
  responseId,
  model,
  taxonomyVersion,
  transactions,
  categories,
  suggestions,
  autoAcceptThreshold = DEFAULT_AUTO_ACCEPT_THRESHOLD,
  createdAt = new Date(),
}: {
  runId: string;
  responseId: string | null;
  model: string;
  taxonomyVersion: string;
  transactions: AiEnrichmentQueueRow[];
  categories: CategoryTaxonomyItem[];
  suggestions: CategoryClassifierSuggestion[];
  autoAcceptThreshold?: number;
  createdAt?: Date;
}): AiEnrichmentInsertRow[] {
  const suggestionsByTransactionId = new Map(
    suggestions.map((suggestion) => [suggestion.transactionId, suggestion]),
  );
  const createdAtIso = createdAt.toISOString();

  return transactions.map((transaction) => {
    const suggestion =
      suggestionsByTransactionId.get(transaction.transactionId) ??
      buildMissingSuggestion(transaction);
    const decision = scoreCategorySuggestion({
      transaction,
      suggestion,
      categories,
      taxonomyVersion,
      autoAcceptThreshold,
    });

    return {
      run_id: runId,
      transaction_id: transaction.transactionId,
      input_hash: decision.inputHash,
      prompt_version: CATEGORY_CLASSIFIER_PROMPT_VERSION,
      rules_version: CATEGORY_CLASSIFIER_RULES_VERSION,
      taxonomy_version: taxonomyVersion,
      model_provider: "openai",
      model,
      model_response_id: responseId,
      suggested_category_id: suggestion.categoryId,
      suggested_category_label: decision.category?.label ?? null,
      normalized_merchant:
        normalizeNullableString(suggestion.normalizedMerchant) ??
        normalizeNullableString(transaction.merchantNorm),
      model_confidence_score: decision.modelConfidenceScore,
      confidence_score: decision.confidenceScore,
      confidence_level: decision.confidenceLevel,
      review_required: decision.reviewRequired,
      status: decision.status,
      reason: suggestion.reason || "No model reason provided.",
      confidence_notes: decision.confidenceNotes,
      signals: suggestion.signals ?? [],
      secondary_candidates_json: JSON.stringify(
        suggestion.secondaryCandidates ?? [],
      ),
      input_json: JSON.stringify(decision.inputJson),
      model_output_json: JSON.stringify(decision.modelOutputJson),
      created_at: createdAtIso,
    };
  });
}

function normalizeQueueRow(row: Record<string, unknown>): AiEnrichmentQueueRow {
  return {
    transactionId: normalizeString(row.transactionId),
    accountId: normalizeString(row.accountId),
    accountName: normalizeString(row.accountName),
    postedAt: normalizeString(row.postedAt),
    signedAmount: normalizeNumber(row.signedAmount),
    merchantRaw: normalizeString(row.merchantRaw),
    merchantNorm: normalizeString(row.merchantNorm),
    descriptionRaw: normalizeString(row.descriptionRaw),
    descriptionNorm: normalizeString(row.descriptionNorm),
    institutionCategory: normalizeNullableString(row.institutionCategory),
    derivedCategoryId: normalizeString(row.derivedCategoryId),
    categoryLabel: normalizeString(row.categoryLabel),
    transactionClass: normalizeString(row.transactionClass),
    classificationSource: normalizeString(row.classificationSource),
    confidenceScore: normalizeNumber(row.confidenceScore),
    keywordArray: normalizeKeywordArray(row.keywordArray),
    enrichmentReason: normalizeString(row.enrichmentReason),
  };
}

async function loadCategoryTaxonomy() {
  const projectId = getBigQueryProjectId();

  if (!projectId) {
    throw new Error("BIGQUERY_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required.");
  }

  const rows = await runBigQueryQuery<Record<string, unknown>>(
    `
      SELECT
        category_id AS categoryId,
        label,
        category_l1 AS categoryL1,
        category_l2 AS categoryL2
      FROM \`${projectId}.core_finance.dim_category\`
      ORDER BY category_id
    `,
  );

  return (rows ?? []).map((row) => ({
    categoryId: normalizeString(row.categoryId),
    label: normalizeString(row.label),
    categoryL1: normalizeString(row.categoryL1),
    categoryL2: normalizeString(row.categoryL2),
  }));
}

async function loadAiEnrichmentQueue({
  limit,
  includeExisting,
}: {
  limit: number;
  includeExisting: boolean;
}) {
  const projectId = getBigQueryProjectId();

  if (!projectId) {
    throw new Error("BIGQUERY_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required.");
  }

  const rows = await runBigQueryQuery<Record<string, unknown>>(
    `
      SELECT
        q.transaction_id AS transactionId,
        q.account_id AS accountId,
        q.account_name AS accountName,
        q.posted_at AS postedAt,
        q.signed_amount AS signedAmount,
        q.merchant_raw AS merchantRaw,
        q.merchant_norm AS merchantNorm,
        q.description_raw AS descriptionRaw,
        q.description_norm AS descriptionNorm,
        q.institution_category AS institutionCategory,
        q.derived_category_id AS derivedCategoryId,
        q.category_label AS categoryLabel,
        q.transaction_class AS transactionClass,
        q.classification_source AS classificationSource,
        q.confidence_score AS confidenceScore,
        q.keyword_array AS keywordArray,
        q.enrichment_reason AS enrichmentReason
      FROM \`${projectId}.ops_finance.ai_enrichment_queue\` AS q
      WHERE @includeExisting
         OR NOT EXISTS (
          SELECT 1
          FROM \`${projectId}.ops_finance.ai_enrichment_results\` AS results
          WHERE results.transaction_id = q.transaction_id
            AND results.status IN ("accepted", "needs_review")
        )
      ORDER BY q.confidence_score ASC, q.posted_at DESC
      LIMIT @limit
    `,
    {
      includeExisting,
      limit,
    },
  );

  return (rows ?? []).map(normalizeQueueRow);
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

export async function runAiCategoryEnrichment(
  options: RunAiCategoryEnrichmentOptions = {},
): Promise<AiCategoryEnrichmentSummary> {
  const model = getModelName(options.model);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const runId = `ai-cat-${new Date().toISOString()}-${randomUUID()}`;
  const categories = await loadCategoryTaxonomy();

  if (categories.length === 0) {
    throw new Error("No category taxonomy rows found in core_finance.dim_category.");
  }

  const taxonomyVersion = getTaxonomyVersion(categories);
  const candidates = await loadAiEnrichmentQueue({
    limit,
    includeExisting: Boolean(options.includeExisting),
  });
  let insertedCount = 0;
  let acceptedCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;

  if (candidates.length === 0) {
    return {
      runId,
      model,
      promptVersion: CATEGORY_CLASSIFIER_PROMPT_VERSION,
      rulesVersion: CATEGORY_CLASSIFIER_RULES_VERSION,
      taxonomyVersion,
      candidateCount: 0,
      enrichedCount: 0,
      insertedCount: 0,
      acceptedCount: 0,
      needsReviewCount: 0,
      rejectedCount: 0,
    };
  }

  const apiKey = getOpenAiApiKey(options.openAiApiKey);

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to run AI categorization.");
  }

  for (const batch of chunkArray(candidates, Math.max(1, batchSize))) {
    const response = await callOpenAiCategoryClassifier({
      transactions: batch,
      categories,
      apiKey,
      model,
    });
    const rows = buildAiEnrichmentInsertRows({
      runId,
      responseId: response.responseId,
      model,
      taxonomyVersion,
      transactions: batch,
      categories,
      suggestions: response.results,
      autoAcceptThreshold: options.autoAcceptThreshold,
    });

    await insertBigQueryRows("ops_finance", "ai_enrichment_results", rows);

    insertedCount += rows.length;
    acceptedCount += rows.filter((row) => row.status === "accepted").length;
    needsReviewCount += rows.filter((row) => row.status === "needs_review").length;
    rejectedCount += rows.filter((row) => row.status === "rejected").length;
  }

  return {
    runId,
    model,
    promptVersion: CATEGORY_CLASSIFIER_PROMPT_VERSION,
    rulesVersion: CATEGORY_CLASSIFIER_RULES_VERSION,
    taxonomyVersion,
    candidateCount: candidates.length,
    enrichedCount: candidates.length,
    insertedCount,
    acceptedCount,
    needsReviewCount,
    rejectedCount,
  };
}
