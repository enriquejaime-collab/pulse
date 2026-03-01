import { NextResponse } from "next/server";
import { getPropertyStore } from "@/src/lib/persistence/property-store";

const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await context.params;
    const wallet = (new URL(request.url).searchParams.get("wallet") ?? "").trim().toLowerCase();
    if (!WALLET_ADDRESS_PATTERN.test(wallet)) {
      return NextResponse.json(
        { error: "Invalid wallet. Provide a 42-character EVM address (0x...)." },
        { status: 400 }
      );
    }

    const store = getPropertyStore();
    const snapshot = await store.getLatestSnapshot(propertyId, wallet);
    const syncState = await store.getSyncState(propertyId, wallet);
    if (!snapshot) {
      return NextResponse.json({ snapshot: null, syncState }, { status: 200 });
    }
    return NextResponse.json({ snapshot, syncState }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load wallet summary.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
