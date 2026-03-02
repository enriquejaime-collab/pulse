import { NextResponse } from "next/server";
import { getPropertyStore } from "@/src/lib/persistence/property-store";
import {
  buildPolymarketSummaryFromDataSets,
  fetchPolymarketSummaryDataSets,
  type PolymarketActivity,
  type PolymarketPosition,
  type PolymarketTrade
} from "@/src/lib/polymarket/summary";
import type { StoredRawDataSets } from "@/src/lib/persistence/property-store-types";

const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TRADE_DELTA_SOFT_TOLERANCE = 10;

const toSummaryDataSets = (raw: StoredRawDataSets) => ({
  trades: raw.trades as unknown as PolymarketTrade[],
  closedPositions: raw.closedPositions as unknown as PolymarketPosition[],
  openPositions: raw.openPositions as unknown as PolymarketPosition[],
  activity: raw.activity as unknown as PolymarketActivity[]
});

export async function POST(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await context.params;
    const payload = (await request.json()) as { wallet?: string };
    const wallet = (payload.wallet ?? "").trim().toLowerCase();

    if (!WALLET_ADDRESS_PATTERN.test(wallet)) {
      return NextResponse.json(
        { error: "Invalid wallet. Provide a 42-character EVM address (0x...)." },
        { status: 400 }
      );
    }

    const store = getPropertyStore();

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

    return NextResponse.json(
      {
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
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reliability check failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
