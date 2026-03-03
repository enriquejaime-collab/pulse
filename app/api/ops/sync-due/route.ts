import { NextResponse } from "next/server";
import { getPropertyStore } from "@/src/lib/persistence/property-store";
import type { StoredWallet } from "@/src/lib/persistence/property-store-types";

type DueWallet = {
  propertyId: string;
  propertyName: string;
  wallet: string;
  label: string | null;
  syncIntervalMinutes: number;
  autoHealEnabled: boolean;
  lastSuccessAt: string | null;
  lastSyncAt: string | null;
  status: string | null;
  reliabilityStatus: "pass" | "pass_with_trade_drift" | "mismatch" | null;
  reliabilityCheckedAt: string | null;
  dueReason: "never_synced" | "interval_elapsed" | "sync_error";
  overdueMinutes: number;
};

const asMs = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getNowIso = (): string => new Date().toISOString();

const getDueWallets = async (): Promise<DueWallet[]> => {
  const store = getPropertyStore();
  const properties = await store.listProperties();
  const nowMs = Date.now();
  const dueWallets: DueWallet[] = [];

  for (const property of properties) {
    const syncStateRows = await store.listSyncStates(property.id);
    const stateByWallet = new Map(syncStateRows.map((row) => [row.wallet, row] as const));

    for (const walletProfile of property.wallets) {
      if (!walletProfile.syncEnabled) {
        continue;
      }
      const state = stateByWallet.get(walletProfile.wallet);
      const intervalMs = walletProfile.syncIntervalMinutes * 60 * 1000;
      const lastSuccessMs = asMs(state?.lastSuccessAt ?? null);
      const lastSyncMs = asMs(state?.lastSyncAt ?? null);

      let dueReason: DueWallet["dueReason"] | null = null;
      if (state?.status === "error") {
        dueReason = "sync_error";
      } else if (lastSuccessMs === null) {
        dueReason = "never_synced";
      } else if (nowMs - lastSuccessMs >= intervalMs) {
        dueReason = "interval_elapsed";
      }

      if (!dueReason) {
        continue;
      }

      const overdueMinutes =
        lastSuccessMs === null ? walletProfile.syncIntervalMinutes : Math.max(0, Math.floor((nowMs - lastSuccessMs) / 60000));

      dueWallets.push({
        propertyId: property.id,
        propertyName: property.name,
        wallet: walletProfile.wallet,
        label: walletProfile.label,
        syncIntervalMinutes: walletProfile.syncIntervalMinutes,
        autoHealEnabled: walletProfile.autoHealEnabled,
        lastSuccessAt: state?.lastSuccessAt ?? null,
        lastSyncAt: state?.lastSyncAt ?? null,
        status: state?.status ?? null,
        reliabilityStatus: state?.reliabilityStatus ?? null,
        reliabilityCheckedAt: state?.reliabilityCheckedAt ?? null,
        dueReason,
        overdueMinutes
      });
    }
  }

  return dueWallets.sort((a, b) => b.overdueMinutes - a.overdueMinutes);
};

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body)
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  return payload;
};

const runSyncForWallet = async (request: Request, due: DueWallet) => {
  const baseUrl = new URL(request.url).origin;
  const syncUrl = `${baseUrl}/api/properties/${encodeURIComponent(due.propertyId)}/sync`;
  const reliabilityUrl = `${baseUrl}/api/properties/${encodeURIComponent(due.propertyId)}/reliability`;

  const syncPayload = await postJson<{
    mode?: "full" | "incremental";
    syncRun?: { recordsIngested?: number };
  }>(syncUrl, {
    wallet: due.wallet,
    forceRefresh: true
  });

  let reliability = await postJson<{
    status: "pass" | "pass_with_trade_drift" | "mismatch";
    deltas: { trades: number };
    checkedAt: string;
  }>(reliabilityUrl, {
    wallet: due.wallet
  });

  let healed = false;
  if (reliability.status === "mismatch" && due.autoHealEnabled) {
    healed = true;
    await postJson(syncUrl, {
      wallet: due.wallet,
      forceRefresh: true,
      forceFull: true
    });
    reliability = await postJson(reliabilityUrl, {
      wallet: due.wallet
    });
  }

  return {
    propertyId: due.propertyId,
    propertyName: due.propertyName,
    wallet: due.wallet,
    label: due.label,
    dueReason: due.dueReason,
    syncMode: syncPayload.mode ?? "incremental",
    recordsIngested: Number(syncPayload.syncRun?.recordsIngested ?? 0),
    reliabilityStatus: reliability.status,
    reliabilityTradeDelta: reliability.deltas.trades,
    healed
  };
};

export async function GET(_request: Request) {
  try {
    const dueWallets = await getDueWallets();
    return NextResponse.json(
      {
        asOf: getNowIso(),
        dueCount: dueWallets.length,
        dueWallets
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load due wallets.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const maxWalletsRaw = Number(url.searchParams.get("maxWallets") ?? "20");
    const maxWallets = Number.isFinite(maxWalletsRaw) && maxWalletsRaw > 0 ? Math.min(maxWalletsRaw, 200) : 20;
    const runAll = url.searchParams.get("all") === "1";

    const dueWallets = await getDueWallets();
    const queue = runAll ? dueWallets : dueWallets.slice(0, maxWallets);

    const results: Array<
      | {
          propertyId: string;
          propertyName: string;
          wallet: string;
          label: string | null;
          dueReason: DueWallet["dueReason"];
          syncMode: "full" | "incremental";
          recordsIngested: number;
          reliabilityStatus: "pass" | "pass_with_trade_drift" | "mismatch";
          reliabilityTradeDelta: number;
          healed: boolean;
          ok: true;
        }
      | {
          propertyId: string;
          propertyName: string;
          wallet: string;
          label: string | null;
          dueReason: DueWallet["dueReason"];
          ok: false;
          error: string;
        }
    > = [];

    for (const due of queue) {
      try {
        const result = await runSyncForWallet(request, due);
        results.push({
          ...result,
          ok: true
        });
      } catch (error) {
        results.push({
          propertyId: due.propertyId,
          propertyName: due.propertyName,
          wallet: due.wallet,
          label: due.label,
          dueReason: due.dueReason,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown scheduler error"
        });
      }
    }

    const success = results.filter((row) => row.ok).length;
    const failed = results.length - success;
    const healed = results.filter((row) => row.ok && row.healed).length;
    const mismatches = results.filter((row) => row.ok && row.reliabilityStatus === "mismatch").length;

    return NextResponse.json(
      {
        asOf: getNowIso(),
        attempted: results.length,
        success,
        failed,
        healed,
        mismatches,
        remainingDue: Math.max(dueWallets.length - results.length, 0),
        results
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run scheduled sync.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
