import type { PolymarketSummary } from "@/src/lib/polymarket/summary";

export type WalletSyncStatus = "idle" | "syncing" | "success" | "error";
export type SyncRunMode = "full" | "incremental";
export type RawEndpoint = "trades" | "closed_positions" | "positions" | "activity";

export interface StoredProperty {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredWallet {
  id: string;
  propertyId: string;
  wallet: string;
  label: string | null;
  strategyTag: string | null;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  autoHealEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredWalletSnapshot {
  id: string;
  propertyId: string;
  wallet: string;
  source: "polymarket-data-api";
  summary: PolymarketSummary;
  recordsIngested: number;
  createdAt: string;
}

export interface StoredWalletSyncState {
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
  reliabilityStatus: "pass" | "pass_with_trade_drift" | "mismatch" | null;
  reliabilityCheckedAt: string | null;
  reliabilityTradeDelta: number | null;
  updatedAt: string;
}

export interface StoredSyncRun {
  id: string;
  propertyId: string;
  wallet: string;
  mode: SyncRunMode;
  status: WalletSyncStatus;
  startedAt: string;
  finishedAt: string | null;
  recordsIngested: number;
  error: string | null;
}

export interface RawRecordInput {
  endpoint: RawEndpoint;
  recordId: string;
  timestamp: string | null;
  payload: Record<string, unknown>;
}

export interface RawRecordUpsertResult {
  endpoint: RawEndpoint;
  processed: number;
}

export interface StoredRawDataSets {
  trades: Record<string, unknown>[];
  closedPositions: Record<string, unknown>[];
  openPositions: Record<string, unknown>[];
  activity: Record<string, unknown>[];
}

export interface PropertyWithWallets extends StoredProperty {
  wallets: StoredWallet[];
}

export interface PropertyStore {
  listProperties(): Promise<PropertyWithWallets[]>;
  createProperty(name: string, description?: string | null): Promise<StoredProperty>;
  updateProperty(propertyId: string, input: { name?: string; description?: string | null }): Promise<StoredProperty>;
  upsertWallet(input: {
    propertyId: string;
    wallet: string;
    label?: string | null;
    strategyTag?: string | null;
    syncEnabled?: boolean;
    syncIntervalMinutes?: number;
    autoHealEnabled?: boolean;
  }): Promise<StoredWallet>;
  updateWallet(input: {
    propertyId: string;
    wallet: string;
    label?: string | null;
    strategyTag?: string | null;
    syncEnabled?: boolean;
    syncIntervalMinutes?: number;
    autoHealEnabled?: boolean;
  }): Promise<StoredWallet>;
  deleteWallet(propertyId: string, wallet: string): Promise<void>;
  getLatestSnapshot(propertyId: string, wallet: string): Promise<StoredWalletSnapshot | null>;
  saveSnapshot(input: {
    propertyId: string;
    wallet: string;
    summary: PolymarketSummary;
    recordsIngested: number;
  }): Promise<StoredWalletSnapshot>;
  createSyncRun(input: {
    propertyId: string;
    wallet: string;
    mode: SyncRunMode;
    status?: WalletSyncStatus;
  }): Promise<StoredSyncRun>;
  finishSyncRun(
    runId: string,
    input: {
      status: WalletSyncStatus;
      recordsIngested?: number;
      error?: string | null;
      finishedAt?: string;
    }
  ): Promise<StoredSyncRun>;
  listSyncRuns(propertyId: string, wallet: string, limit?: number): Promise<StoredSyncRun[]>;
  listSyncStates(propertyId: string): Promise<StoredWalletSyncState[]>;
  saveRawRecords(input: {
    propertyId: string;
    wallet: string;
    records: RawRecordInput[];
  }): Promise<RawRecordUpsertResult[]>;
  getRawDataSets(propertyId: string, wallet: string): Promise<StoredRawDataSets>;
  clearRawData(input: {
    propertyId: string;
    wallet: string;
    endpoints?: RawEndpoint[];
  }): Promise<void>;
  upsertSyncState(input: {
    propertyId: string;
    wallet: string;
    status: WalletSyncStatus;
    lastRunId?: string | null;
    consecutiveFailures?: number;
    lastSyncAt?: string | null;
    lastSuccessAt?: string | null;
    lastError?: string | null;
    recordsIngested?: number;
    reliabilityStatus?: "pass" | "pass_with_trade_drift" | "mismatch" | null;
    reliabilityCheckedAt?: string | null;
    reliabilityTradeDelta?: number | null;
  }): Promise<StoredWalletSyncState>;
  getSyncState(propertyId: string, wallet: string): Promise<StoredWalletSyncState | null>;
}
