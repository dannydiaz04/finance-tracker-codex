import { NextRequest, NextResponse } from "next/server";

import { parseCsvImport, persistCsvImport } from "@/lib/import/csv";
import type { CsvImportRuntimeAccountContext } from "@/lib/import/mapping";

function normalizeTextInput(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildRuntimeAccountContext(input: {
  runtimeAccountContext?: Partial<CsvImportRuntimeAccountContext>;
  sourceAccountId?: unknown;
  accountName?: unknown;
  accountMask?: unknown;
}) {
  const nestedContext = input.runtimeAccountContext ?? {};
  const sourceAccountId =
    normalizeTextInput(input.sourceAccountId) ||
    normalizeTextInput(nestedContext.sourceAccountId);
  const accountName =
    normalizeTextInput(input.accountName) ||
    normalizeTextInput(nestedContext.accountName);
  const accountMask =
    normalizeTextInput(input.accountMask) ||
    normalizeTextInput(nestedContext.accountMask);

  return {
    ...(sourceAccountId ? { sourceAccountId } : {}),
    ...(accountName ? { accountName } : {}),
    ...(accountMask ? { accountMask } : {}),
  } satisfies Partial<CsvImportRuntimeAccountContext>;
}

export async function GET() {
  return NextResponse.json({
    acceptedContentTypes: ["application/json", "multipart/form-data", "text/csv"],
    mappingResolutionModes: [
      "filename",
      "header-signature",
      "column-shape",
      "fallback-header-inference",
    ],
    runtimeAccountContext: {
      requiredKeysWhenSourceNeedsInjection: ["sourceAccountId", "accountName"],
      optionalKeys: ["accountMask"],
    },
    fallbackHeaderInference: {
      requiredColumns: ["date", "description", "amount"],
      optionalColumns: [
        "merchant",
        "account_name",
        "account_id",
        "institution_category",
        "pending",
      ],
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    let csv = "";
    let fileName = "manual-upload.csv";
    let persist = false;
    let runtimeAccountContext: Partial<CsvImportRuntimeAccountContext> = {};

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        csv?: string;
        fileName?: string;
        persist?: boolean;
        runtimeAccountContext?: Partial<CsvImportRuntimeAccountContext>;
        sourceAccountId?: string;
        accountName?: string;
        accountMask?: string;
      };

      csv = body.csv ?? "";
      fileName = body.fileName ?? fileName;
      persist = body.persist ?? false;
      runtimeAccountContext = buildRuntimeAccountContext(body);
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      persist = formData.get("persist") === "true";

      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "Form data must include a `file` field." },
          { status: 400 },
        );
      }

      csv = await file.text();
      fileName = file.name;
      runtimeAccountContext = buildRuntimeAccountContext({
        sourceAccountId: formData.get("sourceAccountId"),
        accountName: formData.get("accountName"),
        accountMask: formData.get("accountMask"),
      });
    } else {
      csv = await request.text();
    }

    if (!csv.trim()) {
      return NextResponse.json(
        { error: "CSV payload was empty." },
        { status: 400 },
      );
    }

    const parsedImport = parseCsvImport(csv, {
      fileName,
      runtimeAccountContext,
    });
    const persistenceResult = persist
      ? await persistCsvImport(parsedImport)
      : {
          persisted: false,
          reason: "Preview mode only.",
        };

    return NextResponse.json({
      importBatch: parsedImport.importBatch,
      rowCount: parsedImport.normalizedRows.length,
      mappingResolution: parsedImport.mappingResolution,
      preview: parsedImport.normalizedRows.slice(0, 10),
      persistenceResult,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to parse CSV import.",
      },
      { status: 400 },
    );
  }
}
