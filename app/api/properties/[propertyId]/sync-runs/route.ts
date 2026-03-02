import { NextResponse } from "next/server";
import { getPropertyStore } from "@/src/lib/persistence/property-store";

const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await context.params;
    const url = new URL(request.url);
    const wallet = (url.searchParams.get("wallet") ?? "").trim().toLowerCase();
    if (!WALLET_ADDRESS_PATTERN.test(wallet)) {
      return NextResponse.json(
        { error: "Invalid wallet. Provide a 42-character EVM address (0x...)." },
        { status: 400 }
      );
    }

    const parsedLimit = Number(url.searchParams.get("limit") ?? "10");
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 10;

    const store = getPropertyStore();
    const runs = await store.listSyncRuns(propertyId, wallet, limit);
    return NextResponse.json({ runs }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load sync runs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
