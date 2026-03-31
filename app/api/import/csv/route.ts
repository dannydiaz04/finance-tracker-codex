import { NextRequest, NextResponse } from "next/server";

import { parseCsvImport, persistCsvImport } from "@/lib/import/csv";

export async function GET() {
  return NextResponse.json({
    acceptedContentTypes: ["application/json", "multipart/form-data", "text/csv"],
    requiredColumns: ["date", "description", "amount"],
    optionalColumns: [
      "merchant",
      "account_name",
      "account_id",
      "institution_category",
      "pending",
    ],
  });
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    let csv = "";
    let fileName = "manual-upload.csv";
    let persist = false;

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        csv?: string;
        fileName?: string;
        persist?: boolean;
      };

      csv = body.csv ?? "";
      fileName = body.fileName ?? fileName;
      persist = body.persist ?? false;
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
    } else {
      csv = await request.text();
    }

    if (!csv.trim()) {
      return NextResponse.json(
        { error: "CSV payload was empty." },
        { status: 400 },
      );
    }

    const parsedImport = parseCsvImport(csv, fileName);
    const persistenceResult = persist
      ? await persistCsvImport(parsedImport)
      : {
          persisted: false,
          reason: "Preview mode only.",
        };

    return NextResponse.json({
      importBatch: parsedImport.importBatch,
      rowCount: parsedImport.normalizedRows.length,
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
