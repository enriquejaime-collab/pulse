import { NextResponse } from "next/server";
import { getPropertyStore } from "@/src/lib/persistence/property-store";

const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await context.params;
    const wallet = (new URL(request.url).searchParams.get("wallet") ?? "").trim().toLowerCase();
    const store = getPropertyStore();

    if (wallet) {
      if (!WALLET_ADDRESS_PATTERN.test(wallet)) {
        return NextResponse.json(
          { error: "Invalid wallet. Provide a 42-character EVM address (0x...)." },
          { status: 400 }
        );
      }

      const [syncState, latestRun] = await Promise.all([
        store.getSyncState(propertyId, wallet),
        store.listSyncRuns(propertyId, wallet, 1).then((rows) => rows[0] ?? null)
      ]);

      return NextResponse.json({ syncState, latestRun }, { status: 200 });
    }

    const syncStates = await store.listSyncStates(propertyId);
    return NextResponse.json({ syncStates }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load sync state.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
