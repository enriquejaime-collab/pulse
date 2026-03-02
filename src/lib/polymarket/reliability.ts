import { getPropertyStore } from "@/src/lib/persistence/property-store";
import type { PropertyStore } from "@/src/lib/persistence/property-store-types";
import {
  buildPolymarketSummaryFromDataSets,
  fetchPolymarketSummaryDataSets,
  type PolymarketActivity,
  type PolymarketPosition,
  type PolymarketTrade
} from "@/src/lib/polymarket/summary";
import type { StoredRawDataSets } from "@/src/lib/persistence/property-store-types";

export const TRADE_DELTA_SOFT_TOLERANCE = 10;

const toSummaryDataSets = (raw: StoredRawDataSets) => ({
  trades: raw.trades as unknown as PolymarketTrade[],
  closedPositions: raw.closedPositions as unknown as PolymarketPosition[],
  openPositions: raw.openPositions as unknown as PolymarketPosition[],
  activity: raw.activity as unknown as PolymarketActivity[]
});

export interface ReliabilityReport {
  pass: boolean;
  status: "pass" | "pass_with_trade_drift" | "mismatch";
  strictPass: boolean;
  tolerance: {
    tradeDeltaSoft: number;
  };
  checkedAt: string;
  checks: {
    tradesMatch: boolean;
    closedPositionsMatch: boolean;
    winsMatch: boolean;
    lossesMatch: boolean;
  };
  live: {
    records: {
      trades: number;
      closedPositions: number;
      openPositions: number;
      activity: number;
    };
    wins: number;
    losses: number;
    totalTrades: number;
    totalVolumeUsd: number;
    netPnl: number;
  };
  persisted: {
    records: {
      trades: number;
      closedPositions: number;
      openPositions: number;
      activity: number;
    };
    wins: number;
    losses: number;
    totalTrades: number;
    totalVolumeUsd: number;
    netPnl: number;
  };
  deltas: {
    trades: number;
    closedPositions: number;
    openPositions: number;
    activity: number;
    wins: number;
    losses: number;
    totalVolumeUsd: number;
    netPnl: number;
  };
}

export const runWalletReliabilityCheck = async (
  propertyId: string,
  wallet: string,
  store: PropertyStore = getPropertyStore()
): Promise<ReliabilityReport> => {
  const [liveDataSets, persistedRaw] = await Promise.all([
    fetchPolymarketSummaryDataSets(wallet, { mode: "full" }),
    store.getRawDataSets(propertyId, wallet)
  ]);

  const liveSummary = buildPolymarketSummaryFromDataSets(wallet, liveDataSets);
  const persistedSummary = buildPolymarketSummaryFromDataSets(wallet, toSummaryDataSets(persistedRaw));

  const checks = {
    tradesMatch: liveSummary.records.trades === persistedSummary.records.trades,
    closedPositionsMatch: liveSummary.records.closedPositions === persistedSummary.records.closedPositions,
    winsMatch: liveSummary.wins === persistedSummary.wins,
    lossesMatch: liveSummary.losses === persistedSummary.losses
  };

  const deltas = {
    trades: persistedSummary.records.trades - liveSummary.records.trades,
    closedPositions: persistedSummary.records.closedPositions - liveSummary.records.closedPositions,
    openPositions: persistedSummary.records.openPositions - liveSummary.records.openPositions,
    activity: persistedSummary.records.activity - liveSummary.records.activity,
    wins: persistedSummary.wins - liveSummary.wins,
    losses: persistedSummary.losses - liveSummary.losses,
    totalVolumeUsd: persistedSummary.totalVolumeUsd - liveSummary.totalVolumeUsd,
    netPnl: persistedSummary.netPnl - liveSummary.netPnl
  };

  const coreChecksPass = checks.closedPositionsMatch && checks.winsMatch && checks.lossesMatch;
  const tradeDeltaAbs = Math.abs(deltas.trades);
  const strictPass = coreChecksPass && checks.tradesMatch;
  const softPass = coreChecksPass && tradeDeltaAbs <= TRADE_DELTA_SOFT_TOLERANCE;
  const status: "pass" | "pass_with_trade_drift" | "mismatch" = strictPass
    ? "pass"
    : softPass
      ? "pass_with_trade_drift"
      : "mismatch";

  return {
    pass: softPass,
    status,
    strictPass,
    tolerance: {
      tradeDeltaSoft: TRADE_DELTA_SOFT_TOLERANCE
    },
    checkedAt: new Date().toISOString(),
    checks,
    live: {
      records: liveSummary.records,
      wins: liveSummary.wins,
      losses: liveSummary.losses,
      totalTrades: liveSummary.totalTrades,
      totalVolumeUsd: liveSummary.totalVolumeUsd,
      netPnl: liveSummary.netPnl
    },
    persisted: {
      records: persistedSummary.records,
      wins: persistedSummary.wins,
      losses: persistedSummary.losses,
      totalTrades: persistedSummary.totalTrades,
      totalVolumeUsd: persistedSummary.totalVolumeUsd,
      netPnl: persistedSummary.netPnl
    },
    deltas
  };
};

