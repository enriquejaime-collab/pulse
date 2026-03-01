import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PolymarketSummary } from "@/src/lib/polymarket/summary";
import type {
  PropertyStore,
  PropertyWithWallets,
  StoredProperty,
  StoredWallet,
  StoredWalletSnapshot,
  StoredWalletSyncState,
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
  lastSyncAt: typeof row.last_sync_at === "string" ? row.last_sync_at : null,
  lastSuccessAt: typeof row.last_success_at === "string" ? row.last_success_at : null,
  lastError: typeof row.last_error === "string" ? row.last_error : null,
  recordsIngested: Number(row.records_ingested ?? 0),
  updatedAt: toIsoString(row.updated_at)
});

const ensureWallet = (wallet: string): string => wallet.trim().toLowerCase();

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

    return (await response.json()) as T;
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

  async upsertSyncState(input: {
    propertyId: string;
    wallet: string;
    status: WalletSyncStatus;
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
      `/wallet_sync_state?select=id,property_id,wallet,status,last_sync_at,last_success_at,last_error,records_ingested,updated_at&property_id=eq.${propertyId}&wallet=eq.${normalized}&limit=1`
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
    lastSyncAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    recordsIngested: number;
    updatedAt: string;
  }>;
}

const createEmptyLocalStore = (): LocalStoreDocument => ({
  properties: [],
  wallets: [],
  snapshots: [],
  syncStates: []
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
        syncStates: parsed.syncStates ?? []
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

  async upsertSyncState(input: {
    propertyId: string;
    wallet: string;
    status: WalletSyncStatus;
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
