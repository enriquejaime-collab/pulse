"use client";

import { useMemo, useState } from "react";
import { PageShell } from "@/app/components/page-shell";
import { parseCsvFile } from "@/src/lib/csv/parse-csv-file";
import type { CsvParseResult, ImportPlatform } from "@/src/lib/csv/types";

export default function ImportsPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState<ImportPlatform>("unknown");
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isParsing, setIsParsing] = useState(false);

  const previewRows = useMemo(() => parseResult?.rawRows.slice(0, 50) ?? [], [parseResult]);

  const formatFileSize = (sizeInBytes: number): string => {
    if (sizeInBytes < 1024) {
      return `${sizeInBytes} B`;
    }
    if (sizeInBytes < 1024 * 1024) {
      return `${(sizeInBytes / 1024).toFixed(1)} KB`;
    }
    return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const resetMessages = () => {
    setWarnings([]);
    setErrors([]);
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setParseResult(null);
    resetMessages();
  };

  const onParse = async () => {
    if (!selectedFile) {
      setParseResult(null);
      setWarnings([]);
      setErrors(["Select a CSV file before parsing."]);
      return;
    }

    setIsParsing(true);
    resetMessages();

    try {
      const result = await parseCsvFile(selectedFile);
      setParseResult(result);
      setWarnings(result.warnings.map((warning) => warning.message));
    } catch (error) {
      setParseResult(null);
      setErrors([error instanceof Error ? error.message : "Unexpected CSV parsing error."]);
    } finally {
      setIsParsing(false);
    }
  };

  return (
    <PageShell
      title="Imports"
      subtitle="Upload one CSV file, parse it locally, and preview rows before mapping or persistence."
    >
      <section className="glass-panel rounded-3xl p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-slate-900">Upload CSV</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-slate-700">
            <span className="font-medium">CSV File</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={onFileChange}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-700">
            <span className="font-medium">Platform (optional)</span>
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as ImportPlatform)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            >
              <option value="unknown">Unknown</option>
              <option value="broker">Broker</option>
              <option value="polymarket">Polymarket</option>
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={onParse}
          disabled={!selectedFile || isParsing}
          className="mt-5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isParsing ? "Parsing..." : "Parse"}
        </button>

        <div className="mt-5 rounded-xl border border-slate-200/90 bg-white/80 p-4 text-sm text-slate-700">
          <p className="font-medium text-slate-900">File metadata</p>
          {selectedFile ? (
            <dl className="mt-2 grid gap-1">
              <div className="flex flex-wrap gap-2">
                <dt className="font-medium">Filename:</dt>
                <dd>{selectedFile.name}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="font-medium">Size:</dt>
                <dd>{formatFileSize(selectedFile.size)}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="font-medium">Last Modified:</dt>
                <dd>{new Date(selectedFile.lastModified).toLocaleString()}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-slate-500">No file selected.</p>
          )}
        </div>
      </section>

      {(errors.length > 0 || warnings.length > 0) && (
        <section className="space-y-3">
          {errors.length > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-semibold">Errors</p>
              <ul className="mt-2 space-y-1">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">Warnings</p>
              <ul className="mt-2 space-y-1">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {parseResult && (
        <section className="glass-panel overflow-hidden rounded-3xl">
          <div className="border-b border-slate-200/80 px-6 py-4">
            <h3 className="text-lg font-semibold text-slate-900">Preview</h3>
            <p className="mt-1 text-sm text-slate-600">
              Showing first {Math.min(50, parseResult.meta.totalRows)} of {parseResult.meta.totalRows} rows
              for platform: <span className="font-medium capitalize">{platform}</span>
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100/80">
                  {parseResult.headers.map((header) => (
                    <th
                      key={header}
                      className="border-b border-slate-200 px-4 py-2 text-left font-semibold text-slate-800"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`} className="odd:bg-white even:bg-slate-50/60">
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${rowIndex}-${cellIndex}`}
                        className={`border-b border-slate-100 px-4 py-2 align-top ${
                          cell.trim().length === 0 ? "bg-amber-50/70 text-slate-400" : "text-slate-700"
                        }`}
                      >
                        {cell || " "}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </PageShell>
  );
}
