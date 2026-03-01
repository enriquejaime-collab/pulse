import { NextResponse } from "next/server";
import { getPolymarketSummary } from "@/src/lib/polymarket/summary";

const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wallet = (url.searchParams.get("wallet") ?? "").trim();

  if (!WALLET_ADDRESS_PATTERN.test(wallet)) {
    return NextResponse.json(
      { error: "Invalid wallet. Provide a 42-character EVM address (0x...)." },
      { status: 400 }
    );
  }

  try {
    const summary = await getPolymarketSummary(wallet);
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Polymarket summary.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
