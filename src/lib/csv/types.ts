export type ImportPlatform = "unknown" | "broker" | "polymarket";

export interface CsvWarning {
  code: "non_csv_file" | "duplicate_headers" | "empty_rows_removed";
  message: string;
}

export interface CsvParseMeta {
  fileName: string;
  fileSize: number;
  lastModified: string;
  totalRows: number;
  removedEmptyRows: number;
}

export interface CsvParseResult {
  headers: string[];
  rows: Array<Record<string, string>>;
  rawRows: string[][];
  meta: CsvParseMeta;
  warnings: CsvWarning[];
}
