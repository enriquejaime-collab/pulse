import { NextResponse } from "next/server";
import { getPropertyStore } from "@/src/lib/persistence/property-store";
import { runWalletReliabilityCheck } from "@/src/lib/polymarket/reliability";

const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

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
    const report = await runWalletReliabilityCheck(propertyId, wallet, store);
    await store.upsertSyncState({
      propertyId,
      wallet,
      status: "success",
      reliabilityStatus: report.status,
      reliabilityCheckedAt: report.checkedAt,
      reliabilityTradeDelta: report.deltas.trades
    });

    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reliability check failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

