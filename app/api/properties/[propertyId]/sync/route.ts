import { NextResponse } from "next/server";
import { getPropertyStore } from "@/src/lib/persistence/property-store";
import { getPolymarketSummary } from "@/src/lib/polymarket/summary";

const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const countRecordsIngested = (summary: Awaited<ReturnType<typeof getPolymarketSummary>>): number => {
  const records = summary.records;
  return records.trades + records.closedPositions + records.openPositions + records.activity;
};

export async function POST(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await context.params;
  let wallet = "";
  try {
    const payload = (await request.json()) as {
      wallet?: string;
      forceRefresh?: boolean;
    };

    wallet = (payload.wallet ?? "").trim().toLowerCase();
    if (!WALLET_ADDRESS_PATTERN.test(wallet)) {
      return NextResponse.json(
        { error: "Invalid wallet. Provide a 42-character EVM address (0x...)." },
        { status: 400 }
      );
    }

    const forceRefresh = Boolean(payload.forceRefresh);
    const store = getPropertyStore();

    if (!forceRefresh) {
      const snapshot = await store.getLatestSnapshot(propertyId, wallet);
      const syncState = await store.getSyncState(propertyId, wallet);
      if (snapshot) {
        return NextResponse.json(
          {
            source: "cache",
            summary: snapshot.summary,
            snapshot,
            syncState
          },
          { status: 200 }
        );
      }
    }

    const now = new Date().toISOString();
    await store.upsertSyncState({
      propertyId,
      wallet,
      status: "syncing",
      lastSyncAt: now,
      lastError: null
    });

    const summary = await getPolymarketSummary(wallet);
    const recordsIngested = countRecordsIngested(summary);
    const snapshot = await store.saveSnapshot({
      propertyId,
      wallet,
      summary,
      recordsIngested
    });

    const syncState = await store.upsertSyncState({
      propertyId,
      wallet,
      status: "success",
      lastSyncAt: now,
      lastSuccessAt: now,
      lastError: null,
      recordsIngested
    });

    return NextResponse.json(
      {
        source: "live",
        summary,
        snapshot,
        syncState
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync wallet.";
    if (WALLET_ADDRESS_PATTERN.test(wallet)) {
      const store = getPropertyStore();
      await store.upsertSyncState({
        propertyId,
        wallet,
        status: "error",
        lastSyncAt: new Date().toISOString(),
        lastError: message
      });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
