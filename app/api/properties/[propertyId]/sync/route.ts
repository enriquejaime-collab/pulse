import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getPropertyStore } from "@/src/lib/persistence/property-store";
import type { RawRecordInput, StoredRawDataSets, SyncRunMode } from "@/src/lib/persistence/property-store-types";
import {
  buildPolymarketSummaryFromDataSets,
  fetchPolymarketSummaryDataSets,
  getTradeCanonicalKey,
  type PolymarketActivity,
  type PolymarketPosition,
  type PolymarketSummary,
  type PolymarketTrade
} from "@/src/lib/polymarket/summary";

const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const RECENT_RUNS_LIMIT = 10;

const countRecordsIngested = (summary: PolymarketSummary): number => {
  const records = summary.records;
  return records.trades + records.closedPositions + records.openPositions + records.activity;
};

const tryParseTimestampMs = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toIsoTimestamp = (value: unknown): string | null => {
  const ms = tryParseTimestampMs(value);
  if (ms === null) {
    return null;
  }
  return new Date(ms).toISOString();
};

const firstStringFromKeys = (row: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
};

const stableJsonStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const payloadHash = (row: Record<string, unknown>): string =>
  createHash("sha1").update(stableJsonStringify(row)).digest("hex");

const hashKeyParts = (prefix: string, parts: unknown[]): string => {
  const normalized = parts
    .map((part) => {
      if (part === null || part === undefined) {
        return "";
      }
      if (typeof part === "string") {
        return part.trim();
      }
      if (typeof part === "number" || typeof part === "boolean") {
        return String(part);
      }
      return stableJsonStringify(part);
    })
    .join("|");

  return `${prefix}:${createHash("sha1").update(normalized).digest("hex")}`;
};

const stableRecordId = (
  prefix: string,
  row: Record<string, unknown>,
  preferredKeys: string[],
  fallbackKeys: string[] = []
): string => {
  const preferred = firstStringFromKeys(row, preferredKeys);
  if (preferred) {
    return `${prefix}:${preferred}`;
  }

  const fallback = fallbackKeys
    .map((key) => {
      const value = row[key];
      if (value === null || value === undefined) {
        return "";
      }
      if (typeof value === "string") {
        return value.trim();
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      return "";
    })
    .filter(Boolean)
    .join(":");

  if (fallback) {
    return `${prefix}:${fallback}`;
  }

  return `${prefix}:hash:${payloadHash(row)}`;
};

const buildRawRecordInput = (dataSets: Awaited<ReturnType<typeof fetchPolymarketSummaryDataSets>>): RawRecordInput[] => {
  const records: RawRecordInput[] = [];

  for (const trade of dataSets.trades) {
    const row = trade as Record<string, unknown>;
    records.push({
      endpoint: "trades",
      // Must match the live fetch dedupe key exactly for reliable parity checks.
      recordId: `trade:${getTradeCanonicalKey(trade)}`,
      timestamp: toIsoTimestamp(trade.timestamp),
      payload: row
    });
  }

  for (const position of dataSets.closedPositions) {
    const row = position as Record<string, unknown>;
    records.push({
      endpoint: "closed_positions",
      recordId: `closed:hash:${payloadHash(row)}`,
      timestamp: toIsoTimestamp(
        row.timestamp ?? row.closedAt ?? row.closed_at ?? row.updatedAt ?? row.updated_at ?? row.endDate
      ),
      payload: row
    });
  }

  for (const position of dataSets.openPositions) {
    const row = position as Record<string, unknown>;
    records.push({
      endpoint: "positions",
      recordId: stableRecordId(
        "open",
        row,
        ["id", "positionId", "position_id", "tokenId", "token_id"],
        ["conditionId", "condition_id", "asset", "outcome", "outcomeIndex", "market", "marketSlug", "slug"]
      ),
      timestamp: toIsoTimestamp(row.timestamp ?? row.updatedAt ?? row.updated_at ?? row.endDate),
      payload: row
    });
  }

  for (const activity of dataSets.activity) {
    const row = activity as Record<string, unknown>;
    records.push({
      endpoint: "activity",
      recordId: hashKeyParts("activity", [
        row.id,
        row.activityId,
        row.activity_id,
        row.hash,
        row.txHash,
        row.transactionHash,
        row.type,
        row.timestamp,
        row.asset,
        row.outcome,
        row.market,
        row.conditionId
      ]),
      timestamp: toIsoTimestamp((activity as PolymarketActivity).timestamp ?? row.createdAt ?? row.created_at),
      payload: row
    });
  }

  return records;
};

const toSummaryDataSets = (raw: StoredRawDataSets) => ({
  trades: raw.trades as unknown as PolymarketTrade[],
  closedPositions: raw.closedPositions as unknown as PolymarketPosition[],
  openPositions: raw.openPositions as unknown as PolymarketPosition[],
  activity: raw.activity as unknown as PolymarketActivity[]
});

const resolveSyncMode = (
  forceFull: boolean,
  _lastSuccessAt: string | null | undefined
): SyncRunMode => {
  if (forceFull) {
    return "full";
  }
  return "incremental";
};

export async function POST(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await context.params;
  let wallet = "";
  const store = getPropertyStore();
  let runId: string | null = null;
  let priorConsecutiveFailures = 0;

  try {
    const payload = (await request.json()) as {
      wallet?: string;
      forceRefresh?: boolean;
      forceFull?: boolean;
    };

    wallet = (payload.wallet ?? "").trim().toLowerCase();
    if (!WALLET_ADDRESS_PATTERN.test(wallet)) {
      return NextResponse.json(
        { error: "Invalid wallet. Provide a 42-character EVM address (0x...)." },
        { status: 400 }
      );
    }

    const forceRefresh = Boolean(payload.forceRefresh);
    if (!forceRefresh) {
      const [snapshot, syncState, recentRuns] = await Promise.all([
        store.getLatestSnapshot(propertyId, wallet),
        store.getSyncState(propertyId, wallet),
        store.listSyncRuns(propertyId, wallet, RECENT_RUNS_LIMIT)
      ]);
      if (snapshot) {
        return NextResponse.json(
          {
            source: "cache",
            summary: snapshot.summary,
            snapshot,
            syncState,
            syncRuns: recentRuns
          },
          { status: 200 }
        );
      }
    }

    const existingSyncState = await store.getSyncState(propertyId, wallet);
    priorConsecutiveFailures = existingSyncState?.consecutiveFailures ?? 0;
    const mode = resolveSyncMode(Boolean(payload.forceFull), existingSyncState?.lastSuccessAt);

    const run = await store.createSyncRun({
      propertyId,
      wallet,
      mode,
      status: "syncing"
    });
    runId = run.id;

    const now = new Date().toISOString();
    await store.upsertSyncState({
      propertyId,
      wallet,
      status: "syncing",
      lastRunId: run.id,
      consecutiveFailures: priorConsecutiveFailures,
      lastSyncAt: now,
      lastError: null
    });

    const incrementalSinceMs =
      mode === "incremental" && existingSyncState?.lastSuccessAt
        ? Date.parse(existingSyncState.lastSuccessAt)
        : Number.NaN;

    const fetchedDataSets = await fetchPolymarketSummaryDataSets(wallet, {
      mode,
      sinceTimestampMs: Number.isFinite(incrementalSinceMs) ? incrementalSinceMs : null
    });

    if (mode === "full") {
      await store.clearRawData({
        propertyId,
        wallet
      });
    } else {
      // Open positions endpoint is current-state snapshot; keep only latest snapshot rows.
      await store.clearRawData({
        propertyId,
        wallet,
        endpoints: ["positions"]
      });
    }

    const rawRecords = buildRawRecordInput(fetchedDataSets);
    const upsertResults = await store.saveRawRecords({
      propertyId,
      wallet,
      records: rawRecords
    });

    const persistedRaw = await store.getRawDataSets(propertyId, wallet);
    const summary = buildPolymarketSummaryFromDataSets(wallet, toSummaryDataSets(persistedRaw));

    const recordsIngested = upsertResults.reduce((sum, row) => sum + row.processed, 0);

    const snapshot = await store.saveSnapshot({
      propertyId,
      wallet,
      summary,
      recordsIngested: countRecordsIngested(summary)
    });

    const [syncRun, syncState, syncRuns] = await Promise.all([
      store.finishSyncRun(run.id, {
        status: "success",
        recordsIngested,
        error: null,
        finishedAt: new Date().toISOString()
      }),
      store.upsertSyncState({
        propertyId,
        wallet,
        status: "success",
        lastRunId: run.id,
        consecutiveFailures: 0,
        lastSyncAt: now,
        lastSuccessAt: now,
        lastError: null,
        recordsIngested
      }),
      store.listSyncRuns(propertyId, wallet, RECENT_RUNS_LIMIT)
    ]);

    return NextResponse.json(
      {
        source: "live",
        mode,
        summary,
        snapshot,
        syncState,
        syncRun,
        syncRuns,
        ingestion: {
          recordsFetched: rawRecords.length,
          recordsUpserted: recordsIngested,
          upsertResults
        }
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync wallet.";
    if (WALLET_ADDRESS_PATTERN.test(wallet)) {
      const now = new Date().toISOString();
      if (runId) {
        try {
          await store.finishSyncRun(runId, {
            status: "error",
            recordsIngested: 0,
            error: message,
            finishedAt: now
          });
        } catch {
          // best effort only
        }
      }

      await store.upsertSyncState({
        propertyId,
        wallet,
        status: "error",
        lastRunId: runId,
        consecutiveFailures: priorConsecutiveFailures + 1,
        lastSyncAt: now,
        lastError: message,
        recordsIngested: 0
      });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
