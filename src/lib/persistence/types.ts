export type Platform = "broker-a" | "broker-b" | "polymarket" | "unknown";

export interface ImportBatch {
  id: string;
  filename: string;
  platform: Platform;
  importedAt: string;
  rowCount: number;
}

export type TradeSide = "buy" | "sell" | "other";

export interface Transaction {
  id: string;
  batchId: string;
  platform: Platform;
  timestamp: string;
  instrument: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fees: number;
  pnl: number;
  currency: string;
  raw: Record<string, unknown>;
}
