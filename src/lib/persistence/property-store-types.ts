import type { PolymarketSummary } from "@/src/lib/polymarket/summary";

export type WalletSyncStatus = "idle" | "syncing" | "success" | "error";

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
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  recordsIngested: number;
  updatedAt: string;
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
  }): Promise<StoredWallet>;
  deleteWallet(propertyId: string, wallet: string): Promise<void>;
  getLatestSnapshot(propertyId: string, wallet: string): Promise<StoredWalletSnapshot | null>;
  saveSnapshot(input: {
    propertyId: string;
    wallet: string;
    summary: PolymarketSummary;
    recordsIngested: number;
  }): Promise<StoredWalletSnapshot>;
  upsertSyncState(input: {
    propertyId: string;
    wallet: string;
    status: WalletSyncStatus;
    lastSyncAt?: string | null;
    lastSuccessAt?: string | null;
    lastError?: string | null;
    recordsIngested?: number;
  }): Promise<StoredWalletSyncState>;
  getSyncState(propertyId: string, wallet: string): Promise<StoredWalletSyncState | null>;
}
