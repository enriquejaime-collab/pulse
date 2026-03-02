import { NextResponse } from "next/server";
import { getPropertyStore } from "@/src/lib/persistence/property-store";

const WALLET_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

const findProperty = async (propertyId: string) => {
  const store = getPropertyStore();
  const properties = await store.listProperties();
  return properties.find((property) => property.id === propertyId) ?? null;
};

export async function GET(_request: Request, context: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await context.params;
    const property = await findProperty(propertyId);
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }
    return NextResponse.json({ wallets: property.wallets }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load wallets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await context.params;
    const property = await findProperty(propertyId);
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    const payload = (await request.json()) as {
      wallet?: string;
      label?: string | null;
      strategyTag?: string | null;
      syncEnabled?: boolean;
      syncIntervalMinutes?: number;
      autoHealEnabled?: boolean;
    };
    const wallet = (payload.wallet ?? "").trim().toLowerCase();
    if (!WALLET_ADDRESS_PATTERN.test(wallet)) {
      return NextResponse.json(
        { error: "Invalid wallet. Provide a 42-character EVM address (0x...)." },
        { status: 400 }
      );
    }

    const store = getPropertyStore();
    const saved = await store.upsertWallet({
      propertyId,
      wallet,
      label: payload.label ?? null,
      strategyTag: payload.strategyTag ?? null,
      syncEnabled: payload.syncEnabled ?? true,
      syncIntervalMinutes: Math.max(1, Number(payload.syncIntervalMinutes ?? 15)),
      autoHealEnabled: payload.autoHealEnabled ?? true
    });
    return NextResponse.json({ wallet: saved }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save wallet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  try {
    const { propertyId } = await context.params;
    const payload = (await request.json()) as {
      wallet?: string;
      label?: string | null;
      strategyTag?: string | null;
      syncEnabled?: boolean;
      syncIntervalMinutes?: number;
      autoHealEnabled?: boolean;
    };
    const wallet = (payload.wallet ?? "").trim().toLowerCase();
    if (!WALLET_ADDRESS_PATTERN.test(wallet)) {
      return NextResponse.json(
        { error: "Invalid wallet. Provide a 42-character EVM address (0x...)." },
        { status: 400 }
      );
    }

    const patch: {
      propertyId: string;
      wallet: string;
      label?: string | null;
      strategyTag?: string | null;
      syncEnabled?: boolean;
      syncIntervalMinutes?: number;
      autoHealEnabled?: boolean;
    } = {
      propertyId,
      wallet
    };
    if (Object.prototype.hasOwnProperty.call(payload, "label")) {
      patch.label = payload.label ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "strategyTag")) {
      patch.strategyTag = payload.strategyTag ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "syncEnabled")) {
      patch.syncEnabled = Boolean(payload.syncEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "syncIntervalMinutes")) {
      patch.syncIntervalMinutes = Math.max(1, Number(payload.syncIntervalMinutes ?? 15));
    }
    if (Object.prototype.hasOwnProperty.call(payload, "autoHealEnabled")) {
      patch.autoHealEnabled = Boolean(payload.autoHealEnabled);
    }

    const store = getPropertyStore();
    const updated = await store.updateWallet(patch);
    return NextResponse.json({ wallet: updated }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update wallet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ propertyId: string }> }) {
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
    await store.deleteWallet(propertyId, wallet);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete wallet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
