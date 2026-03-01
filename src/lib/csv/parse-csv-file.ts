import Papa from "papaparse";
import type { CsvParseResult, CsvWarning } from "@/src/lib/csv/types";

function normalizeHeader(rawHeader: string, index: number): string {
  const trimmed = rawHeader.trim();
  return trimmed.length > 0 ? trimmed : `column_${index + 1}`;
}

function dedupeHeaders(headers: string[]): { headers: string[]; hadDuplicates: boolean } {
  const seen = new Map<string, number>();
  let hadDuplicates = false;

  const deduped = headers.map((header) => {
    const currentCount = seen.get(header) ?? 0;
    seen.set(header, currentCount + 1);

    if (currentCount === 0) {
      return header;
    }

    hadDuplicates = true;
    return `${header}_${currentCount + 1}`;
  });

  return { headers: deduped, hadDuplicates };
}

function isCsvLikeFile(file: File): boolean {
  const nameLooksCsv = file.name.toLowerCase().endsWith(".csv");
  const typeLooksCsv =
    file.type === "" ||
    file.type.includes("csv") ||
    file.type.includes("comma-separated-values") ||
    file.type.includes("excel");

  return nameLooksCsv || typeLooksCsv;
}

function parseRows(data: unknown[]): string[][] {
  return data.map((row) => {
    if (!Array.isArray(row)) {
      return [];
    }

    return row.map((value) => (value == null ? "" : String(value)));
  });
}

export async function parseCsvFile(file: File): Promise<CsvParseResult> {
  const warnings: CsvWarning[] = [];

  if (!isCsvLikeFile(file)) {
    warnings.push({
      code: "non_csv_file",
      message:
        "File does not look like a CSV by extension or MIME type, but parsing was attempted anyway."
    });
  }

  const parsed = await new Promise<Papa.ParseResult<unknown>>((resolve, reject) => {
    Papa.parse(file, {
      skipEmptyLines: false,
      complete: resolve,
      error: reject
    });
  });

  if (parsed.errors.length > 0) {
    const errorText = parsed.errors
      .slice(0, 3)
      .map((error) => `Row ${error.row ?? "unknown"}: ${error.message}`)
      .join(" | ");
    throw new Error(`Unable to parse CSV. ${errorText}`);
  }

  const parsedRows = parseRows(parsed.data);
  if (parsedRows.length === 0) {
    throw new Error("CSV appears to be empty.");
  }

  const sourceHeaders = parsedRows[0] ?? [];
  if (sourceHeaders.length === 0) {
    throw new Error("CSV is missing a header row.");
  }

  const normalizedHeaders = sourceHeaders.map((header, index) => normalizeHeader(header, index));
  const dedupeResult = dedupeHeaders(normalizedHeaders);
  const headers = dedupeResult.headers;

  if (dedupeResult.hadDuplicates) {
    warnings.push({
      code: "duplicate_headers",
      message: "Duplicate header names were found and auto-fixed with numeric suffixes."
    });
  }

  const dataRows = parsedRows.slice(1);
  const nonEmptyRows = dataRows.filter((row) =>
    row.some((value) => (value ?? "").toString().trim().length > 0)
  );
  const removedEmptyRows = dataRows.length - nonEmptyRows.length;

  if (removedEmptyRows > 0) {
    warnings.push({
      code: "empty_rows_removed",
      message: `${removedEmptyRows} empty row(s) were removed from preview.`
    });
  }

  if (nonEmptyRows.length === 0) {
    throw new Error("CSV has headers but no data rows.");
  }

  const rawRows = nonEmptyRows.map((row) => headers.map((_, index) => row[index] ?? ""));
  const rows = rawRows.map((row) =>
    headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = row[index] ?? "";
      return record;
    }, {})
  );

  return {
    headers,
    rows,
    rawRows,
    meta: {
      fileName: file.name,
      fileSize: file.size,
      lastModified: new Date(file.lastModified).toISOString(),
      totalRows: rows.length,
      removedEmptyRows
    },
    warnings
  };
}
