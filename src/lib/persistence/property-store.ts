import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PolymarketSummary } from "@/src/lib/polymarket/summary";
import type {
  PropertyStore,
  PropertyWithWallets,
  RawEndpoint,
  RawRecordInput,
  RawRecordUpsertResult,
  StoredRawDataSets,
  StoredProperty,
  StoredSyncRun,
  StoredWallet,
  StoredWalletSnapshot,
  StoredWalletSyncState,
  SyncRunMode,
  WalletSyncStatus
} from "@/src/lib/persistence/property-store-types";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const LOCAL_STORE_PATH = process.env.PULSE_LOCAL_STORE_PATH ?? path.join(process.cwd(), ".pulse-store.json");

const toIsoString = (value: unknown): string => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
};

const mapPropertyRow = (row: Record<string, unknown>): StoredProperty => ({
  id: String(row.id ?? ""),
  name: String(row.name ?? ""),
  description: typeof row.description === "string" ? row.description : null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});

const mapWalletRow = (row: Record<string, unknown>): StoredWallet => ({
  id: String(row.id ?? ""),
  propertyId: String(row.property_id ?? ""),
  wallet: String(row.wallet ?? "").toLowerCase(),
  label: typeof row.label === "string" ? row.label : null,
  strategyTag: typeof row.strategy_tag === "string" ? row.strategy_tag : null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});

const mapSnapshotRow = (row: Record<string, unknown>): StoredWalletSnapshot => ({
  id: String(row.id ?? ""),
  propertyId: String(row.property_id ?? ""),
  wallet: String(row.wallet ?? "").toLowerCase(),
  source: "polymarket-data-api",
  summary: (row.summary_json ?? {}) as PolymarketSummary,
  recordsIngested: Number(row.records_ingested ?? 0),
  createdAt: toIsoString(row.created_at)
});

const mapSyncStateRow = (row: Record<string, unknown>): StoredWalletSyncState => ({
  id: String(row.id ?? ""),
  propertyId: String(row.property_id ?? ""),
  wallet: String(row.wallet ?? "").toLowerCase(),
  status: String(row.status ?? "idle") as WalletSyncStatus,
  lastRunId: typeof row.last_run_id === "string" ? row.last_run_id : null,
  consecutiveFailures: Number(row.consecutive_failures ?? 0),
  lastSyncAt: typeof row.last_sync_at === "string" ? row.last_sync_at : null,
  lastSuccessAt: typeof row.last_success_at === "string" ? row.last_success_at : null,
  lastError: typeof row.last_error === "string" ? row.last_error : null,
  recordsIngested: Number(row.records_ingested ?? 0),
  updatedAt: toIsoString(row.updated_at)
});

const mapSyncRunRow = (row: Record<string, unknown>): StoredSyncRun => ({
  id: String(row.id ?? ""),
  propertyId: String(row.property_id ?? ""),
  wallet: String(row.wallet ?? "").toLowerCase(),
  mode: String(row.mode ?? "incremental") as SyncRunMode,
  status: String(row.status ?? "idle") as WalletSyncStatus,
  startedAt: toIsoString(row.started_at),
  finishedAt: typeof row.finished_at === "string" ? row.finished_at : null,
  recordsIngested: Number(row.records_ingested ?? 0),
  error: typeof row.error === "string" ? row.error : null
});

const ensureWallet = (wallet: string): string => wallet.trim().toLowerCase();
const RAW_TABLE_BY_ENDPOINT: Record<RawEndpoint, string> = {
  trades: "raw_trades",
  closed_positions: "raw_closed_positions",
  positions: "raw_positions",
  activity: "raw_activity"
};

const LOCAL_RAW_KEY_BY_ENDPOINT: Record<
  RawEndpoint,
  "rawTrades" | "rawClosedPositions" | "rawPositions" | "rawActivity"
> = {
  trades: "rawTrades",
  closed_positions: "rawClosedPositions",
  positions: "rawPositions",
  activity: "rawActivity"
};

const isSupabaseConfigured = (): boolean => SUPABASE_URL.length > 0 && SUPABASE_SERVICE_ROLE_KEY.length > 0;

class SupabaseRestClient {
  private readonly baseUrl: string;
  private readonly key: string;

  constructor(url: string, key: string) {
    this.baseUrl = `${url.replace(/\/$/, "")}/rest/v1`;
    this.key = key;
  }

  private async request<T>(pathnameAndQuery: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathnameAndQuery}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        ...init.headers
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Persistence API error (${response.status}) ${pathnameAndQuery}: ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const raw = await response.text();
    if (!raw) {
      return undefined as T;
    }
    return JSON.parse(raw) as T;
  }

  get<T>(pathnameAndQuery: string): Promise<T> {
    return this.request<T>(pathnameAndQuery, { method: "GET" });
  }

  post<T>(pathnameAndQuery: string, body: unknown, headers?: HeadersInit): Promise<T> {
    return this.request<T>(pathnameAndQuery, { method: "POST", body: JSON.stringify(body), headers });
  }

  patch<T>(pathnameAndQuery: string, body: unknown, headers?: HeadersInit): Promise<T> {
    return this.request<T>(pathnameAndQuery, { method: "PATCH", body: JSON.stringify(body), headers });
  }

  delete(pathnameAndQuery: string): Promise<void> {
    return this.request<void>(pathnameAndQuery, { method: "DELETE" });
  }
}

class SupabasePropertyStore implements PropertyStore {
  private readonly client: SupabaseRestClient;

  constructor(client: SupabaseRestClient) {
    this.client = client;
  }

  async listProperties(): Promise<PropertyWithWallets[]> {
    const propertiesRaw = await this.client.get<Record<string, unknown>[]>(
      "/properties?select=id,name,description,created_at,updated_at&order=created_at.desc"
    );
    const properties = propertiesRaw.map(mapPropertyRow);

    if (properties.length === 0) {
      return [];
    }

    const ids = properties.map((property) => property.id);
    const walletsRaw = await this.client.get<Record<string, unknown>[]>(
      `/property_wallets?select=id,property_id,wallet,label,strategy_tag,created_at,updated_at&property_id=in.(${ids.join(",")})&order=created_at.asc`
    );
    const wallets = walletsRaw.map(mapWalletRow);

    return properties.map((property) => ({
      ...property,
      wallets: wallets.filter((wallet) => wallet.propertyId === property.id)
    }));
  }

  async createProperty(name: string, description?: string | null): Promise<StoredProperty> {
    const created = await this.client.post<Record<string, unknown>[]>(
      "/properties",
      { name, description: description ?? null },
      { Prefer: "return=representation" }
    );
    return mapPropertyRow(created[0] ?? {});
  }

  async updateProperty(propertyId: string, input: { name?: string; description?: string | null }): Promise<StoredProperty> {
    const patch: Record<string, unknown> = {};
    if (typeof input.name === "string") {
      patch.name = input.name;
    }
    if (Object.prototype.hasOwnProperty.call(input, "description")) {
      patch.description = input.description ?? null;
    }

    const rows = await this.client.patch<Record<string, unknown>[]>(
      `/properties?id=eq.${propertyId}`,
      patch,
      { Prefer: "return=representation" }
    );
    return mapPropertyRow(rows[0] ?? {});
  }

  async upsertWallet(input: {
    propertyId: string;
    wallet: string;
    label?: string | null;
    strategyTag?: string | null;
  }): Promise<StoredWallet> {
    const rows = await this.client.post<Record<string, unknown>[]>(
      "/property_wallets?on_conflict=property_id,wallet",
      {
        property_id: input.propertyId,
        wallet: ensureWallet(input.wallet),
        label: input.label ?? null,
        strategy_tag: input.strategyTag ?? null
      },
      { Prefer: "resolution=merge-duplicates,return=representation" }
    );
    return mapWalletRow(rows[0] ?? {});
  }

  async deleteWallet(propertyId: string, wallet: string): Promise<void> {
    const normalized = ensureWallet(wallet);
    await this.client.delete(`/property_wallets?property_id=eq.${propertyId}&wallet=eq.${normalized}`);
  }

  async getLatestSnapshot(propertyId: string, wallet: string): Promise<StoredWalletSnapshot | null> {
    const normalized = ensureWallet(wallet);
    const rows = await this.client.get<Record<string, unknown>[]>(
      `/wallet_snapshots?select=id,property_id,wallet,summary_json,records_ingested,created_at&property_id=eq.${propertyId}&wallet=eq.${normalized}&order=created_at.desc&limit=1`
    );
    if (rows.length === 0) {
      return null;
    }
    return mapSnapshotRow(rows[0] ?? {});
  }

  async saveSnapshot(input: {
    propertyId: string;
    wallet: string;
    summary: PolymarketSummary;
    recordsIngested: number;
  }): Promise<StoredWalletSnapshot> {
    const rows = await this.client.post<Record<string, unknown>[]>(
      "/wallet_snapshots",
      {
        property_id: input.propertyId,
        wallet: ensureWallet(input.wallet),
        source: "polymarket-data-api",
        summary_json: input.summary,
        records_ingested: input.recordsIngested
      },
      { Prefer: "return=representation" }
    );
    return mapSnapshotRow(rows[0] ?? {});
  }

  async createSyncRun(input: {
    propertyId: string;
    wallet: string;
    mode: SyncRunMode;
    status?: WalletSyncStatus;
  }): Promise<StoredSyncRun> {
    const rows = await this.client.post<Record<string, unknown>[]>(
      "/wallet_sync_runs",
      {
        property_id: input.propertyId,
        wallet: ensureWallet(input.wallet),
        mode: input.mode,
        status: input.status ?? "syncing",
        started_at: new Date().toISOString()
      },
      { Prefer: "return=representation" }
    );
    return mapSyncRunRow(rows[0] ?? {});
  }

  async finishSyncRun(
    runId: string,
    input: {
      status: WalletSyncStatus;
      recordsIngested?: number;
      error?: string | null;
      finishedAt?: string;
    }
  ): Promise<StoredSyncRun> {
    const rows = await this.client.patch<Record<string, unknown>[]>(
      `/wallet_sync_runs?id=eq.${runId}`,
      {
        status: input.status,
        records_ingested: input.recordsIngested ?? 0,
        error: input.error ?? null,
        finished_at: input.finishedAt ?? new Date().toISOString()
      },
      { Prefer: "return=representation" }
    );
    return mapSyncRunRow(rows[0] ?? {});
  }

  async listSyncRuns(propertyId: string, wallet: string, limit = 20): Promise<StoredSyncRun[]> {
    const normalized = ensureWallet(wallet);
    const rows = await this.client.get<Record<string, unknown>[]>(
      `/wallet_sync_runs?select=id,property_id,wallet,mode,status,started_at,finished_at,records_ingested,error&property_id=eq.${propertyId}&wallet=eq.${normalized}&order=started_at.desc&limit=${limit}`
    );
    return rows.map(mapSyncRunRow);
  }

  async listSyncStates(propertyId: string): Promise<StoredWalletSyncState[]> {
    const rows = await this.client.get<Record<string, unknown>[]>(
      `/wallet_sync_state?select=id,property_id,wallet,status,last_run_id,consecutive_failures,last_sync_at,last_success_at,last_error,records_ingested,updated_at&property_id=eq.${propertyId}&order=updated_at.desc`
    );
    return rows.map(mapSyncStateRow);
  }

  async saveRawRecords(input: {
    propertyId: string;
    wallet: string;
    records: RawRecordInput[];
  }): Promise<RawRecordUpsertResult[]> {
    const normalizedWallet = ensureWallet(input.wallet);
    const grouped = new Map<RawEndpoint, RawRecordInput[]>();
    for (const record of input.records) {
      if (!grouped.has(record.endpoint)) {
        grouped.set(record.endpoint, []);
      }
      grouped.get(record.endpoint)?.push(record);
    }

    const results: RawRecordUpsertResult[] = [];
    for (const [endpoint, records] of grouped.entries()) {
      if (records.length === 0) {
        continue;
      }
      // Supabase upsert fails when a single payload contains duplicate conflict keys.
      // Keep the latest occurrence per record_id for this endpoint batch.
      const dedupedByRecordId = new Map<string, RawRecordInput>();
      for (const record of records) {
        dedupedByRecordId.set(record.recordId, record);
      }
      const dedupedRecords = Array.from(dedupedByRecordId.values());

      const table = RAW_TABLE_BY_ENDPOINT[endpoint];
      const payload = dedupedRecords.map((record) => ({
        property_id: input.propertyId,
        wallet: normalizedWallet,
        record_id: record.recordId,
        event_timestamp: record.timestamp,
        payload_json: record.payload
      }));
      await this.client.post<Record<string, unknown>[]>(
        `/${table}?on_conflict=property_id,wallet,record_id`,
        payload,
        { Prefer: "resolution=merge-duplicates,return=minimal" }
      );
      results.push({ endpoint, processed: dedupedRecords.length });
    }

    return results;
  }

  async getRawDataSets(propertyId: string, wallet: string): Promise<StoredRawDataSets> {
    const normalized = ensureWallet(wallet);
    const fetchAllPayloadRows = async (table: string): Promise<Record<string, unknown>[]> => {
      const pageSize = 1000;
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const page = await this.client.get<Record<string, unknown>[]>(
          `/${table}?select=payload_json&property_id=eq.${propertyId}&wallet=eq.${normalized}&order=event_timestamp.desc&limit=${pageSize}&offset=${offset}`
        );
        rows.push(...page);
        if (page.length < pageSize) {
          break;
        }
      }
      return rows;
    };

    const [tradesRows, closedRows, openRows, activityRows] = await Promise.all([
      fetchAllPayloadRows("raw_trades"),
      fetchAllPayloadRows("raw_closed_positions"),
      fetchAllPayloadRows("raw_positions"),
      fetchAllPayloadRows("raw_activity")
    ]);

    const extractPayload = (row: Record<string, unknown>): Record<string, unknown> =>
      (row.payload_json as Record<string, unknown>) ?? {};

    return {
      trades: tradesRows.map(extractPayload),
      closedPositions: closedRows.map(extractPayload),
      openPositions: openRows.map(extractPayload),
      activity: activityRows.map(extractPayload)
    };
  }

  async clearRawData(input: {
    propertyId: string;
    wallet: string;
    endpoints?: RawEndpoint[];
  }): Promise<void> {
    const normalized = ensureWallet(input.wallet);
    const endpoints = input.endpoints ?? ["trades", "closed_positions", "positions", "activity"];
    for (const endpoint of endpoints) {
      const table = RAW_TABLE_BY_ENDPOINT[endpoint];
      await this.client.delete(`/${table}?property_id=eq.${input.propertyId}&wallet=eq.${normalized}`);
    }
  }

  async upsertSyncState(input: {
    propertyId: string;
    wallet: string;
    status: WalletSyncStatus;
    lastRunId?: string | null;
    consecutiveFailures?: number;
    lastSyncAt?: string | null;
    lastSuccessAt?: string | null;
    lastError?: string | null;
    recordsIngested?: number;
  }): Promise<StoredWalletSyncState> {
    const rows = await this.client.post<Record<string, unknown>[]>(
      "/wallet_sync_state?on_conflict=property_id,wallet",
      {
        property_id: input.propertyId,
        wallet: ensureWallet(input.wallet),
        status: input.status,
        last_run_id: input.lastRunId ?? null,
        consecutive_failures: input.consecutiveFailures ?? 0,
        last_sync_at: input.lastSyncAt ?? null,
        last_success_at: input.lastSuccessAt ?? null,
        last_error: input.lastError ?? null,
        records_ingested: input.recordsIngested ?? 0
      },
      { Prefer: "resolution=merge-duplicates,return=representation" }
    );
    return mapSyncStateRow(rows[0] ?? {});
  }

  async getSyncState(propertyId: string, wallet: string): Promise<StoredWalletSyncState | null> {
    const normalized = ensureWallet(wallet);
    const rows = await this.client.get<Record<string, unknown>[]>(
      `/wallet_sync_state?select=id,property_id,wallet,status,last_run_id,consecutive_failures,last_sync_at,last_success_at,last_error,records_ingested,updated_at&property_id=eq.${propertyId}&wallet=eq.${normalized}&limit=1`
    );
    if (rows.length === 0) {
      return null;
    }
    return mapSyncStateRow(rows[0] ?? {});
  }
}

interface LocalStoreDocument {
  properties: Array<{
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  wallets: Array<{
    id: string;
    propertyId: string;
    wallet: string;
    label: string | null;
    strategyTag: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  snapshots: Array<{
    id: string;
    propertyId: string;
    wallet: string;
    source: "polymarket-data-api";
    summary: PolymarketSummary;
    recordsIngested: number;
    createdAt: string;
  }>;
  syncStates: Array<{
    id: string;
    propertyId: string;
    wallet: string;
    status: WalletSyncStatus;
    lastRunId: string | null;
    consecutiveFailures: number;
    lastSyncAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    recordsIngested: number;
    updatedAt: string;
  }>;
  syncRuns: Array<{
    id: string;
    propertyId: string;
    wallet: string;
    mode: SyncRunMode;
    status: WalletSyncStatus;
    startedAt: string;
    finishedAt: string | null;
    recordsIngested: number;
    error: string | null;
  }>;
  rawTrades: Array<{
    propertyId: string;
    wallet: string;
    recordId: string;
    timestamp: string | null;
    payload: Record<string, unknown>;
  }>;
  rawClosedPositions: Array<{
    propertyId: string;
    wallet: string;
    recordId: string;
    timestamp: string | null;
    payload: Record<string, unknown>;
  }>;
  rawPositions: Array<{
    propertyId: string;
    wallet: string;
    recordId: string;
    timestamp: string | null;
    payload: Record<string, unknown>;
  }>;
  rawActivity: Array<{
    propertyId: string;
    wallet: string;
    recordId: string;
    timestamp: string | null;
    payload: Record<string, unknown>;
  }>;
}

const createEmptyLocalStore = (): LocalStoreDocument => ({
  properties: [],
  wallets: [],
  snapshots: [],
  syncStates: [],
  syncRuns: [],
  rawTrades: [],
  rawClosedPositions: [],
  rawPositions: [],
  rawActivity: []
});

class LocalFilePropertyStore implements PropertyStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async readStore(): Promise<LocalStoreDocument> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<LocalStoreDocument>;
      return {
        properties: parsed.properties ?? [],
        wallets: parsed.wallets ?? [],
        snapshots: parsed.snapshots ?? [],
        syncStates: (parsed.syncStates ?? []).map((state) => ({
          id: String(state.id ?? randomUUID()),
          propertyId: String(state.propertyId ?? ""),
          wallet: ensureWallet(String(state.wallet ?? "")),
          status: String(state.status ?? "idle") as WalletSyncStatus,
          lastRunId: typeof state.lastRunId === "string" ? state.lastRunId : null,
          consecutiveFailures: Number(state.consecutiveFailures ?? 0),
          lastSyncAt: typeof state.lastSyncAt === "string" ? state.lastSyncAt : null,
          lastSuccessAt: typeof state.lastSuccessAt === "string" ? state.lastSuccessAt : null,
          lastError: typeof state.lastError === "string" ? state.lastError : null,
          recordsIngested: Number(state.recordsIngested ?? 0),
          updatedAt: toIsoString(state.updatedAt)
        })),
        syncRuns: (parsed.syncRuns ?? []).map((run) => ({
          id: String(run.id ?? randomUUID()),
          propertyId: String(run.propertyId ?? ""),
          wallet: ensureWallet(String(run.wallet ?? "")),
          mode: String(run.mode ?? "incremental") as SyncRunMode,
          status: String(run.status ?? "idle") as WalletSyncStatus,
          startedAt: toIsoString(run.startedAt),
          finishedAt: typeof run.finishedAt === "string" ? run.finishedAt : null,
          recordsIngested: Number(run.recordsIngested ?? 0),
          error: typeof run.error === "string" ? run.error : null
        })),
        rawTrades: parsed.rawTrades ?? [],
        rawClosedPositions: parsed.rawClosedPositions ?? [],
        rawPositions: parsed.rawPositions ?? [],
        rawActivity: parsed.rawActivity ?? []
      };
    } catch {
      return createEmptyLocalStore();
    }
  }

  private async writeStore(doc: LocalStoreDocument): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(doc, null, 2), "utf8");
  }

  async listProperties(): Promise<PropertyWithWallets[]> {
    const doc = await this.readStore();
    return doc.properties
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((property) => ({
        ...property,
        wallets: doc.wallets.filter((wallet) => wallet.propertyId === property.id)
      }));
  }

  async createProperty(name: string, description?: string | null): Promise<StoredProperty> {
    const doc = await this.readStore();
    const now = new Date().toISOString();
    const property: StoredProperty = {
      id: randomUUID(),
      name,
      description: description ?? null,
      createdAt: now,
      updatedAt: now
    };
    doc.properties.unshift(property);
    await this.writeStore(doc);
    return property;
  }

  async updateProperty(propertyId: string, input: { name?: string; description?: string | null }): Promise<StoredProperty> {
    const doc = await this.readStore();
    const property = doc.properties.find((row) => row.id === propertyId);
    if (!property) {
      throw new Error("Property not found.");
    }
    if (typeof input.name === "string" && input.name.trim()) {
      property.name = input.name.trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, "description")) {
      property.description = input.description ?? null;
    }
    property.updatedAt = new Date().toISOString();
    await this.writeStore(doc);
    return property;
  }

  async upsertWallet(input: {
    propertyId: string;
    wallet: string;
    label?: string | null;
    strategyTag?: string | null;
  }): Promise<StoredWallet> {
    const doc = await this.readStore();
    const normalizedWallet = ensureWallet(input.wallet);
    const existing = doc.wallets.find(
      (wallet) => wallet.propertyId === input.propertyId && wallet.wallet === normalizedWallet
    );
    const now = new Date().toISOString();

    if (existing) {
      existing.label = input.label ?? existing.label ?? null;
      existing.strategyTag = input.strategyTag ?? existing.strategyTag ?? null;
      existing.updatedAt = now;
      await this.writeStore(doc);
      return existing;
    }

    const wallet: StoredWallet = {
      id: randomUUID(),
      propertyId: input.propertyId,
      wallet: normalizedWallet,
      label: input.label ?? null,
      strategyTag: input.strategyTag ?? null,
      createdAt: now,
      updatedAt: now
    };
    doc.wallets.push(wallet);
    await this.writeStore(doc);
    return wallet;
  }

  async deleteWallet(propertyId: string, wallet: string): Promise<void> {
    const doc = await this.readStore();
    const normalizedWallet = ensureWallet(wallet);
    doc.wallets = doc.wallets.filter((row) => !(row.propertyId === propertyId && row.wallet === normalizedWallet));
    await this.writeStore(doc);
  }

  async getLatestSnapshot(propertyId: string, wallet: string): Promise<StoredWalletSnapshot | null> {
    const doc = await this.readStore();
    const normalizedWallet = ensureWallet(wallet);
    const row = doc.snapshots
      .filter((snapshot) => snapshot.propertyId === propertyId && snapshot.wallet === normalizedWallet)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    return row ?? null;
  }

  async saveSnapshot(input: {
    propertyId: string;
    wallet: string;
    summary: PolymarketSummary;
    recordsIngested: number;
  }): Promise<StoredWalletSnapshot> {
    const doc = await this.readStore();
    const snapshot: StoredWalletSnapshot = {
      id: randomUUID(),
      propertyId: input.propertyId,
      wallet: ensureWallet(input.wallet),
      source: "polymarket-data-api",
      summary: input.summary,
      recordsIngested: input.recordsIngested,
      createdAt: new Date().toISOString()
    };
    doc.snapshots.push(snapshot);
    await this.writeStore(doc);
    return snapshot;
  }

  async createSyncRun(input: {
    propertyId: string;
    wallet: string;
    mode: SyncRunMode;
    status?: WalletSyncStatus;
  }): Promise<StoredSyncRun> {
    const doc = await this.readStore();
    const run: StoredSyncRun = {
      id: randomUUID(),
      propertyId: input.propertyId,
      wallet: ensureWallet(input.wallet),
      mode: input.mode,
      status: input.status ?? "syncing",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      recordsIngested: 0,
      error: null
    };
    doc.syncRuns.unshift(run);
    await this.writeStore(doc);
    return run;
  }

  async finishSyncRun(
    runId: string,
    input: {
      status: WalletSyncStatus;
      recordsIngested?: number;
      error?: string | null;
      finishedAt?: string;
    }
  ): Promise<StoredSyncRun> {
    const doc = await this.readStore();
    const run = doc.syncRuns.find((row) => row.id === runId);
    if (!run) {
      throw new Error("Sync run not found.");
    }
    run.status = input.status;
    run.recordsIngested = input.recordsIngested ?? run.recordsIngested;
    run.error = input.error ?? null;
    run.finishedAt = input.finishedAt ?? new Date().toISOString();
    await this.writeStore(doc);
    return run;
  }

  async listSyncRuns(propertyId: string, wallet: string, limit = 20): Promise<StoredSyncRun[]> {
    const doc = await this.readStore();
    const normalizedWallet = ensureWallet(wallet);
    return doc.syncRuns
      .filter((run) => run.propertyId === propertyId && run.wallet === normalizedWallet)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, Math.max(limit, 0));
  }

  async listSyncStates(propertyId: string): Promise<StoredWalletSyncState[]> {
    const doc = await this.readStore();
    return doc.syncStates
      .filter((state) => state.propertyId === propertyId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async saveRawRecords(input: {
    propertyId: string;
    wallet: string;
    records: RawRecordInput[];
  }): Promise<RawRecordUpsertResult[]> {
    const doc = await this.readStore();
    const normalizedWallet = ensureWallet(input.wallet);
    const resultsByEndpoint = new Map<RawEndpoint, number>();

    for (const record of input.records) {
      const key = LOCAL_RAW_KEY_BY_ENDPOINT[record.endpoint];
      const collection = doc[key];
      const existingIndex = collection.findIndex(
        (row) =>
          row.propertyId === input.propertyId && row.wallet === normalizedWallet && row.recordId === record.recordId
      );
      const nextRow = {
        propertyId: input.propertyId,
        wallet: normalizedWallet,
        recordId: record.recordId,
        timestamp: record.timestamp,
        payload: record.payload
      };

      if (existingIndex >= 0) {
        collection[existingIndex] = nextRow;
      } else {
        collection.push(nextRow);
      }
      resultsByEndpoint.set(record.endpoint, (resultsByEndpoint.get(record.endpoint) ?? 0) + 1);
    }

    await this.writeStore(doc);
    return Array.from(resultsByEndpoint.entries()).map(([endpoint, processed]) => ({ endpoint, processed }));
  }

  async getRawDataSets(propertyId: string, wallet: string): Promise<StoredRawDataSets> {
    const doc = await this.readStore();
    const normalizedWallet = ensureWallet(wallet);

    const byTimestampDesc = <T extends { timestamp: string | null }>(rows: T[]): T[] =>
      rows
        .slice()
        .sort((a, b) => Date.parse(b.timestamp ?? "") - Date.parse(a.timestamp ?? ""));

    const selectPayload = (
      rows: Array<{
        propertyId: string;
        wallet: string;
        payload: Record<string, unknown>;
      }>
    ): Record<string, unknown>[] =>
      rows
        .filter((row) => row.propertyId === propertyId && row.wallet === normalizedWallet)
        .map((row) => row.payload);

    return {
      trades: selectPayload(byTimestampDesc(doc.rawTrades)),
      closedPositions: selectPayload(byTimestampDesc(doc.rawClosedPositions)),
      openPositions: selectPayload(byTimestampDesc(doc.rawPositions)),
      activity: selectPayload(byTimestampDesc(doc.rawActivity))
    };
  }

  async clearRawData(input: {
    propertyId: string;
    wallet: string;
    endpoints?: RawEndpoint[];
  }): Promise<void> {
    const doc = await this.readStore();
    const normalizedWallet = ensureWallet(input.wallet);
    const endpoints = input.endpoints ?? ["trades", "closed_positions", "positions", "activity"];

    for (const endpoint of endpoints) {
      const key = LOCAL_RAW_KEY_BY_ENDPOINT[endpoint];
      doc[key] = doc[key].filter(
        (row) => !(row.propertyId === input.propertyId && row.wallet === normalizedWallet)
      );
    }

    await this.writeStore(doc);
  }

  async upsertSyncState(input: {
    propertyId: string;
    wallet: string;
    status: WalletSyncStatus;
    lastRunId?: string | null;
    consecutiveFailures?: number;
    lastSyncAt?: string | null;
    lastSuccessAt?: string | null;
    lastError?: string | null;
    recordsIngested?: number;
  }): Promise<StoredWalletSyncState> {
    const doc = await this.readStore();
    const normalizedWallet = ensureWallet(input.wallet);
    const now = new Date().toISOString();
    const existing = doc.syncStates.find(
      (state) => state.propertyId === input.propertyId && state.wallet === normalizedWallet
    );
    if (existing) {
      existing.status = input.status;
      if (Object.prototype.hasOwnProperty.call(input, "lastRunId")) {
        existing.lastRunId = input.lastRunId ?? null;
      }
      if (typeof input.consecutiveFailures === "number") {
        existing.consecutiveFailures = input.consecutiveFailures;
      }
      existing.lastSyncAt = input.lastSyncAt ?? existing.lastSyncAt;
      existing.lastSuccessAt = input.lastSuccessAt ?? existing.lastSuccessAt;
      existing.lastError = input.lastError ?? null;
      existing.recordsIngested = input.recordsIngested ?? existing.recordsIngested;
      existing.updatedAt = now;
      await this.writeStore(doc);
      return existing;
    }

    const state: StoredWalletSyncState = {
      id: randomUUID(),
      propertyId: input.propertyId,
      wallet: normalizedWallet,
      status: input.status,
      lastRunId: input.lastRunId ?? null,
      consecutiveFailures: input.consecutiveFailures ?? 0,
      lastSyncAt: input.lastSyncAt ?? null,
      lastSuccessAt: input.lastSuccessAt ?? null,
      lastError: input.lastError ?? null,
      recordsIngested: input.recordsIngested ?? 0,
      updatedAt: now
    };
    doc.syncStates.push(state);
    await this.writeStore(doc);
    return state;
  }

  async getSyncState(propertyId: string, wallet: string): Promise<StoredWalletSyncState | null> {
    const doc = await this.readStore();
    const normalizedWallet = ensureWallet(wallet);
    return doc.syncStates.find((state) => state.propertyId === propertyId && state.wallet === normalizedWallet) ?? null;
  }
}

let storeSingleton: PropertyStore | null = null;

export const createPropertyStore = (): PropertyStore => {
  if (isSupabaseConfigured()) {
    return new SupabasePropertyStore(new SupabaseRestClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY));
  }
  return new LocalFilePropertyStore(LOCAL_STORE_PATH);
};

export const getPropertyStore = (): PropertyStore => {
  if (!storeSingleton) {
    storeSingleton = createPropertyStore();
  }
  return storeSingleton;
};
