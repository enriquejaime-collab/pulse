"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageShell } from "@/app/components/page-shell";

interface WalletProfile {
  id: string;
  propertyId: string;
  wallet: string;
  label: string | null;
  strategyTag: string | null;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  autoHealEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PropertyModel {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  wallets: WalletProfile[];
}

interface WalletSyncStateModel {
  id: string;
  propertyId: string;
  wallet: string;
  status: "idle" | "syncing" | "success" | "error";
  lastRunId: string | null;
  consecutiveFailures: number;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  recordsIngested: number;
  reliabilityStatus: "pass" | "pass_with_trade_drift" | "mismatch" | null;
  reliabilityCheckedAt: string | null;
  reliabilityTradeDelta: number | null;
  updatedAt: string;
}

interface ReliabilityReport {
  pass: boolean;
  status?: "pass" | "pass_with_trade_drift" | "mismatch";
  strictPass?: boolean;
  tolerance?: {
    tradeDeltaSoft?: number;
  };
  checkedAt: string;
  deltas: {
    trades: number;
    closedPositions: number;
    wins: number;
    losses: number;
  };
}

interface WalletReliabilityState {
  isLoading: boolean;
  report: ReliabilityReport | null;
  error: string | null;
}

interface SchedulerDueWallet {
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
}

interface WalletPolicyDraft {
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  autoHealEnabled: boolean;
}

const WALLET_PATTERN = /^0x[a-f0-9]{40}$/i;

const formatRelativeDate = (value: string | null): string => {
  if (!value) {
    return "never";
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return "never";
  }
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
};

const syncStatusClass = (status: WalletSyncStateModel["status"] | undefined): string => {
  if (status === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "error") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (status === "syncing") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  return "border-slate-200 bg-white text-slate-600";
};

const reliabilityReportClass = (report: ReliabilityReport | null): string => {
  if (!report) {
    return "border-slate-200 bg-white text-slate-600";
  }
  if (report.status === "mismatch") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (report.status === "pass_with_trade_drift") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (report.pass) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-200 bg-white text-slate-600";
};

const reliabilityReportLabel = (report: ReliabilityReport | null): string => {
  if (!report) {
    return "Not checked";
  }
  if (report.status === "pass_with_trade_drift") {
    return "Pass (trade drift)";
  }
  if (report.status === "mismatch") {
    return "Mismatch";
  }
  return report.pass ? "Pass" : "Unknown";
};

const buildWalletReliabilityKey = (propertyId: string, wallet: string): string => `${propertyId}:${wallet.toLowerCase()}`;
const STALE_MULTIPLIER = 3;
const SYNC_INTERVAL_OPTIONS = [5, 10, 15, 30, 60, 120, 240, 360, 720];

const isWalletStale = (state: WalletSyncStateModel | undefined, intervalMinutes: number): boolean => {
  if (!state?.lastSuccessAt) {
    return false;
  }
  const lastSuccessMs = Date.parse(state.lastSuccessAt);
  if (!Number.isFinite(lastSuccessMs)) {
    return false;
  }
  return Date.now() - lastSuccessMs > intervalMinutes * STALE_MULTIPLIER * 60 * 1000;
};

const getDueReasonLabel = (dueReason: SchedulerDueWallet["dueReason"]): string => {
  if (dueReason === "sync_error") {
    return "retry after error";
  }
  if (dueReason === "never_synced") {
    return "first sync";
  }
  return "interval elapsed";
};

const reliabilityStateClass = (
  status: WalletSyncStateModel["reliabilityStatus"]
): string => {
  if (status === "mismatch") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "pass_with_trade_drift") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (status === "pass") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-200 bg-white text-slate-600";
};

const reliabilityStateLabel = (
  status: WalletSyncStateModel["reliabilityStatus"]
): string => {
  if (status === "mismatch") {
    return "mismatch";
  }
  if (status === "pass_with_trade_drift") {
    return "pass (drift)";
  }
  if (status === "pass") {
    return "pass";
  }
  return "not checked";
};

const formatWalletShort = (wallet: string): string => `${wallet.slice(0, 10)}...${wallet.slice(-4)}`;

export default function SettingsPage() {
  const [properties, setProperties] = useState<PropertyModel[]>([]);
  const [syncStatesByProperty, setSyncStatesByProperty] = useState<Record<string, WalletSyncStateModel[]>>({});
  const [reliabilityByWallet, setReliabilityByWallet] = useState<Record<string, WalletReliabilityState>>({});
  const [walletPolicyDrafts, setWalletPolicyDrafts] = useState<Record<string, WalletPolicyDraft>>({});
  const [walletPolicySavingKey, setWalletPolicySavingKey] = useState<string | null>(null);
  const [dueWallets, setDueWallets] = useState<SchedulerDueWallet[]>([]);
  const [isDueWalletsLoading, setIsDueWalletsLoading] = useState(false);
  const [isSchedulerRunning, setIsSchedulerRunning] = useState(false);
  const [schedulerStatus, setSchedulerStatus] = useState<string | null>(null);
  const [backend, setBackend] = useState<"supabase" | "local" | "unknown">("unknown");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPropertyName, setNewPropertyName] = useState("");
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [walletInput, setWalletInput] = useState("");
  const [walletAliasInput, setWalletAliasInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadSyncStatesForProperties = useCallback(async (items: PropertyModel[]) => {
    if (items.length === 0) {
      setSyncStatesByProperty({});
      return;
    }

    const entries = await Promise.all(
      items.map(async (property) => {
        try {
          const response = await fetch(`/api/properties/${encodeURIComponent(property.id)}/sync-state`, {
            cache: "no-store"
          });
          const payload = (await response.json()) as {
            syncStates?: WalletSyncStateModel[];
          };
          if (!response.ok) {
            return [property.id, []] as const;
          }
          return [property.id, payload.syncStates ?? []] as const;
        } catch {
          return [property.id, []] as const;
        }
      })
    );

    setSyncStatesByProperty(Object.fromEntries(entries));
  }, []);

  const loadProperties = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/properties");
      const payload = (await response.json()) as {
        properties?: PropertyModel[];
        backend?: "supabase" | "local";
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load properties.");
      }
      const nextProperties = payload.properties ?? [];
      setProperties(nextProperties);
      setBackend(payload.backend ?? "unknown");
      await loadSyncStatesForProperties(nextProperties);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load properties.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [loadSyncStatesForProperties]);

  const loadDueWallets = useCallback(async () => {
    setIsDueWalletsLoading(true);
    try {
      const response = await fetch("/api/ops/sync-due", { cache: "no-store" });
      const payload = (await response.json()) as { dueWallets?: SchedulerDueWallet[] };
      if (!response.ok) {
        return;
      }
      setDueWallets(payload.dueWallets ?? []);
    } catch {
      // best-effort diagnostics only
    } finally {
      setIsDueWalletsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProperties();
  }, [loadProperties]);

  useEffect(() => {
    void loadDueWallets();
  }, [loadDueWallets]);

  const onCreateProperty = async (event: FormEvent) => {
    event.preventDefault();
    const name = newPropertyName.trim();
    if (!name) {
      setError("Property name is required.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create property.");
      }
      setNewPropertyName("");
      setIsCreateFormOpen(false);
      await loadProperties();
      await loadDueWallets();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Failed to create property.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onStartEditProperty = (property: PropertyModel) => {
    setEditingPropertyId(property.id);
    setEditingName(property.name);
    setWalletInput("");
    setWalletAliasInput("");
    setError(null);
    const nextDrafts: Record<string, WalletPolicyDraft> = {};
    for (const wallet of property.wallets) {
      nextDrafts[buildWalletReliabilityKey(property.id, wallet.wallet)] = {
        syncEnabled: wallet.syncEnabled,
        syncIntervalMinutes: wallet.syncIntervalMinutes,
        autoHealEnabled: wallet.autoHealEnabled
      };
    }
    setWalletPolicyDrafts((previous) => ({
      ...previous,
      ...nextDrafts
    }));
  };

  const onSavePropertyName = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingPropertyId) {
      return;
    }
    const name = editingName.trim();
    if (!name) {
      setError("Property name cannot be empty.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/properties/${encodeURIComponent(editingPropertyId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update property.");
      }
      await loadProperties();
      await loadDueWallets();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Failed to update property.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onAddWallet = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingPropertyId) {
      return;
    }
    const wallet = walletInput.trim().toLowerCase();
    if (!WALLET_PATTERN.test(wallet)) {
      setError("Enter a valid wallet address (0x...).");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/properties/${encodeURIComponent(editingPropertyId)}/wallets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          label: walletAliasInput.trim() || null
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save wallet.");
      }
      setWalletInput("");
      setWalletAliasInput("");
      await loadProperties();
      await loadDueWallets();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Failed to save wallet.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onDeleteWallet = async (propertyId: string, wallet: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/properties/${encodeURIComponent(propertyId)}/wallets?wallet=${encodeURIComponent(wallet)}`,
        { method: "DELETE" }
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to remove wallet.");
      }
      await loadProperties();
      await loadDueWallets();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Failed to remove wallet.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onRunReliabilityCheck = async (propertyId: string, wallet: string) => {
    const key = buildWalletReliabilityKey(propertyId, wallet);
    setReliabilityByWallet((previous) => ({
      ...previous,
      [key]: {
        isLoading: true,
        report: previous[key]?.report ?? null,
        error: null
      }
    }));

    try {
      const response = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/reliability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet })
      });
      const payload = (await response.json()) as ReliabilityReport & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Reliability check failed.");
      }

      setReliabilityByWallet((previous) => ({
        ...previous,
        [key]: {
          isLoading: false,
          report: payload,
          error: null
        }
      }));
      await loadProperties();
      await loadDueWallets();
    } catch (checkError) {
      const message = checkError instanceof Error ? checkError.message : "Reliability check failed.";
      setReliabilityByWallet((previous) => ({
        ...previous,
        [key]: {
          isLoading: false,
          report: previous[key]?.report ?? null,
          error: message
        }
      }));
    }
  };

  const onSaveWalletPolicy = async (propertyId: string, wallet: string) => {
    const key = buildWalletReliabilityKey(propertyId, wallet);
    const draft = walletPolicyDrafts[key];
    if (!draft) {
      return;
    }
    setWalletPolicySavingKey(key);
    setError(null);
    try {
      const response = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/wallets`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          syncEnabled: draft.syncEnabled,
          syncIntervalMinutes: draft.syncIntervalMinutes,
          autoHealEnabled: draft.autoHealEnabled
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update wallet policy.");
      }
      await loadProperties();
      await loadDueWallets();
    } catch (policyError) {
      const message = policyError instanceof Error ? policyError.message : "Failed to update wallet policy.";
      setError(message);
    } finally {
      setWalletPolicySavingKey(null);
    }
  };

  const onUpdateWalletPolicyDraft = (
    propertyId: string,
    wallet: string,
    patch: Partial<WalletPolicyDraft>
  ) => {
    const key = buildWalletReliabilityKey(propertyId, wallet);
    setWalletPolicyDrafts((previous) => {
      const current = previous[key];
      if (!current) {
        return previous;
      }
      return {
        ...previous,
        [key]: {
          ...current,
          ...patch
        }
      };
    });
  };

  const onRunSchedulerNow = async () => {
    setIsSchedulerRunning(true);
    setSchedulerStatus(null);
    try {
      const response = await fetch("/api/ops/sync-due?maxWallets=50", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const payload = (await response.json()) as {
        attempted?: number;
        success?: number;
        failed?: number;
        healed?: number;
        remainingDue?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to run scheduler.");
      }
      setSchedulerStatus(
        `Scheduler run: ${payload.success ?? 0}/${payload.attempted ?? 0} ok, ${payload.failed ?? 0} failed, ${payload.healed ?? 0} healed, ${payload.remainingDue ?? 0} remaining due.`
      );
      await loadProperties();
      await loadDueWallets();
    } catch (schedulerError) {
      const message = schedulerError instanceof Error ? schedulerError.message : "Failed to run scheduler.";
      setSchedulerStatus(message);
    } finally {
      setIsSchedulerRunning(false);
    }
  };

  return (
    <PageShell
      title="Settings"
      subtitle="Manage properties and wallet profiles for persisted Polymarket snapshots."
    >
      <section className="glass-panel rounded-2xl p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Property Management</p>
            <p className="mt-1 text-sm text-slate-600">
              Existing properties and wallet profiles used by the Trades dashboard.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Backend: <span className="font-medium text-slate-700">{backend}</span>
            {isLoading ? " · loading..." : ""}
          </p>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200/90 bg-white/70 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Sync Automation</p>
              <p className="mt-1 text-sm text-slate-600">
                Due wallets run incremental sync first, then reliability check, with optional auto-heal full sync.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onRunSchedulerNow()}
              disabled={isSchedulerRunning}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSchedulerRunning ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                  Running
                </span>
              ) : (
                "Run Due Sync Now"
              )}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
              Due wallets: {isDueWalletsLoading ? "..." : dueWallets.length}
            </span>
            {dueWallets.length > 0 && (
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                Most overdue: {Math.max(...dueWallets.map((row) => row.overdueMinutes)).toLocaleString()} min
              </span>
            )}
          </div>
          {schedulerStatus && <p className="mt-2 text-xs text-slate-600">{schedulerStatus}</p>}

          {dueWallets.length > 0 && (
            <div className="mt-3 space-y-2">
              {dueWallets.slice(0, 8).map((due) => (
                <div
                  key={`${due.propertyId}:${due.wallet}`}
                  className="grid gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                >
                  <p className="font-medium text-slate-800">
                    {due.propertyName} · {due.label ? `${due.label} · ` : ""}
                    {formatWalletShort(due.wallet)}
                  </p>
                  <p className="text-slate-600">
                    {getDueReasonLabel(due.dueReason)} · overdue {due.overdueMinutes.toLocaleString()} min
                  </p>
                  <p className="text-slate-600">
                    every {due.syncIntervalMinutes} min · auto-heal {due.autoHealEnabled ? "on" : "off"}
                  </p>
                  <span
                    className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 font-medium ${reliabilityStateClass(
                      due.reliabilityStatus
                    )}`}
                  >
                    reliability: {reliabilityStateLabel(due.reliabilityStatus)}
                  </span>
                </div>
              ))}
              {dueWallets.length > 8 && (
                <p className="text-xs text-slate-500">Showing 8 of {dueWallets.length} due wallets.</p>
              )}
            </div>
          )}
          {!isDueWalletsLoading && dueWallets.length === 0 && (
            <p className="mt-3 text-xs text-slate-500">All wallets are currently within their sync interval.</p>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {properties.map((property) => {
            const isEditing = editingPropertyId === property.id;
            const propertySyncStates = syncStatesByProperty[property.id] ?? [];
            const syncStateByWallet = new Map(
              propertySyncStates.map((state) => [state.wallet.toLowerCase(), state] as const)
            );
            const successCount = propertySyncStates.filter((state) => state.status === "success").length;
            return (
              <article key={property.id} className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">{property.name}</h2>
                    <p className="text-xs text-slate-500">
                      {property.wallets.length} wallet{property.wallets.length === 1 ? "" : "s"}
                    </p>
                    {property.wallets.length > 0 && (
                      <p className="mt-1 text-xs text-slate-500">
                        Sync healthy: {successCount}/{property.wallets.length}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => (isEditing ? setEditingPropertyId(null) : onStartEditProperty(property))}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    {isEditing ? "Close" : "Edit"}
                  </button>
                </div>

                {property.wallets.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {property.wallets.map((wallet) => {
                      const state = syncStateByWallet.get(wallet.wallet.toLowerCase());
                      const stale = isWalletStale(state, wallet.syncIntervalMinutes);
                      return (
                        <div
                          key={wallet.id}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5"
                        >
                          <span className="text-xs font-medium text-slate-700">
                            {wallet.label ? `${wallet.label} · ` : ""}
                            {formatWalletShort(wallet.wallet)}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${syncStatusClass(
                              state?.status
                            )}`}
                          >
                            {state?.status ?? "idle"}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {state?.status === "success"
                              ? `Last success ${formatRelativeDate(state.lastSuccessAt)}`
                              : state?.status === "error"
                                ? "Needs retry"
                                : "Not synced"}
                          </span>
                          <span className="text-[11px] text-slate-500">{wallet.syncIntervalMinutes}m interval</span>
                          {stale && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                              stale
                            </span>
                          )}
                          {isEditing && (
                            <button
                              type="button"
                              onClick={() => onDeleteWallet(property.id, wallet.wallet)}
                              className="text-xs font-medium text-slate-500 hover:text-red-600"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {isEditing && (
                  <>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <form onSubmit={onSavePropertyName} className="rounded-lg border border-slate-200 bg-white/80 p-3">
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Property Name</label>
                        <input
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
                        />
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          className="mt-3 inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                        >
                          Save Name
                        </button>
                      </form>

                      <form onSubmit={onAddWallet} className="rounded-lg border border-slate-200 bg-white/80 p-3">
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Add Wallet</label>
                        <input
                          placeholder="0x..."
                          value={walletInput}
                          onChange={(event) => setWalletInput(event.target.value)}
                          className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
                        />
                        <input
                          placeholder="Alias (optional)"
                          value={walletAliasInput}
                          onChange={(event) => setWalletAliasInput(event.target.value)}
                          className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
                        />
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          className="mt-3 inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                        >
                          Save Wallet
                        </button>
                      </form>
                    </div>

                    {property.wallets.length > 0 && (
                      <div className="mt-4 rounded-lg border border-slate-200 bg-white/80 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Wallet Sync Policy</p>
                          <p className="text-[11px] text-slate-500">
                            Configure interval and auto-heal, then validate with reliability checks.
                          </p>
                        </div>
                        <div className="mt-3 space-y-2">
                          {property.wallets.map((wallet) => {
                            const key = buildWalletReliabilityKey(property.id, wallet.wallet);
                            const reliabilityState = reliabilityByWallet[key];
                            const reliabilityReport = reliabilityState?.report ?? null;
                            const persistedSyncState = syncStateByWallet.get(wallet.wallet.toLowerCase());
                            const stale = isWalletStale(persistedSyncState, wallet.syncIntervalMinutes);
                            const draft = walletPolicyDrafts[key] ?? {
                              syncEnabled: wallet.syncEnabled,
                              syncIntervalMinutes: wallet.syncIntervalMinutes,
                              autoHealEnabled: wallet.autoHealEnabled
                            };
                            const isPolicyDirty =
                              draft.syncEnabled !== wallet.syncEnabled ||
                              draft.syncIntervalMinutes !== wallet.syncIntervalMinutes ||
                              draft.autoHealEnabled !== wallet.autoHealEnabled;
                            const isPolicySaving = walletPolicySavingKey === key;

                            return (
                              <div
                                key={`${wallet.id}-diagnostics`}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-3"
                              >
                                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                                  <p className="text-sm font-medium text-slate-800">
                                    {wallet.label ? `${wallet.label} · ` : ""}
                                    {formatWalletShort(wallet.wallet)}
                                  </p>
                                  <div className="grid gap-2 sm:grid-cols-[auto_auto_auto_auto]">
                                    <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700">
                                      <input
                                        type="checkbox"
                                        checked={draft.syncEnabled}
                                        onChange={(event) =>
                                          onUpdateWalletPolicyDraft(property.id, wallet.wallet, {
                                            syncEnabled: event.target.checked
                                          })
                                        }
                                        className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900"
                                      />
                                      Auto-sync
                                    </label>

                                    <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700">
                                      Interval
                                      <select
                                        value={draft.syncIntervalMinutes}
                                        onChange={(event) =>
                                          onUpdateWalletPolicyDraft(property.id, wallet.wallet, {
                                            syncIntervalMinutes: Math.max(1, Number(event.target.value))
                                          })
                                        }
                                        className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-800"
                                      >
                                        {SYNC_INTERVAL_OPTIONS.map((minutes) => (
                                          <option key={minutes} value={minutes}>
                                            {minutes}m
                                          </option>
                                        ))}
                                      </select>
                                    </label>

                                    <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700">
                                      <input
                                        type="checkbox"
                                        checked={draft.autoHealEnabled}
                                        onChange={(event) =>
                                          onUpdateWalletPolicyDraft(property.id, wallet.wallet, {
                                            autoHealEnabled: event.target.checked
                                          })
                                        }
                                        className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900"
                                      />
                                      Auto-heal
                                    </label>

                                    <button
                                      type="button"
                                      onClick={() => void onSaveWalletPolicy(property.id, wallet.wallet)}
                                      disabled={isPolicySaving || !isPolicyDirty}
                                      className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {isPolicySaving ? "Saving..." : isPolicyDirty ? "Save Policy" : "Saved"}
                                    </button>
                                  </div>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                  <span
                                    className={`rounded-full border px-2.5 py-1 font-medium ${syncStatusClass(
                                      persistedSyncState?.status
                                    )}`}
                                  >
                                    Sync: {persistedSyncState?.status ?? "idle"}
                                  </span>
                                  {stale && (
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
                                      stale ({wallet.syncIntervalMinutes * STALE_MULTIPLIER}m+)
                                    </span>
                                  )}
                                  <span
                                    className={`rounded-full border px-2.5 py-1 font-medium ${
                                      reliabilityReport
                                        ? reliabilityReportClass(reliabilityReport)
                                        : reliabilityStateClass(persistedSyncState?.reliabilityStatus ?? null)
                                    }`}
                                  >
                                    Reliability:{" "}
                                    {reliabilityReport
                                      ? reliabilityReportLabel(reliabilityReport)
                                      : reliabilityStateLabel(persistedSyncState?.reliabilityStatus ?? null)}
                                  </span>
                                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                                    Last success: {formatRelativeDate(persistedSyncState?.lastSuccessAt ?? null)}
                                  </span>
                                  {persistedSyncState?.reliabilityCheckedAt && !reliabilityReport && (
                                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                                      Checked: {formatRelativeDate(persistedSyncState.reliabilityCheckedAt)}
                                    </span>
                                  )}
                                  {persistedSyncState?.reliabilityTradeDelta !== null &&
                                    persistedSyncState?.reliabilityTradeDelta !== undefined &&
                                    !reliabilityReport && (
                                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                                        Delta trades:{" "}
                                        {persistedSyncState.reliabilityTradeDelta >= 0 ? "+" : ""}
                                        {persistedSyncState.reliabilityTradeDelta}
                                      </span>
                                    )}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                  <button
                                    type="button"
                                    onClick={() => void onRunReliabilityCheck(property.id, wallet.wallet)}
                                    disabled={reliabilityState?.isLoading}
                                    className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {reliabilityState?.isLoading ? (
                                      <span className="inline-flex items-center gap-2">
                                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                                        Checking
                                      </span>
                                    ) : (
                                      "Run Reliability Check"
                                    )}
                                  </button>
                                  {reliabilityReport && (
                                    <>
                                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                                        Delta trades: {reliabilityReport.deltas.trades >= 0 ? "+" : ""}
                                        {reliabilityReport.deltas.trades}
                                      </span>
                                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                                        Delta closed: {reliabilityReport.deltas.closedPositions >= 0 ? "+" : ""}
                                        {reliabilityReport.deltas.closedPositions}
                                      </span>
                                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                                        Delta W/L: {reliabilityReport.deltas.wins >= 0 ? "+" : ""}
                                        {reliabilityReport.deltas.wins}/{reliabilityReport.deltas.losses >= 0 ? "+" : ""}
                                        {reliabilityReport.deltas.losses}
                                      </span>
                                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                                        Checked: {formatRelativeDate(reliabilityReport.checkedAt)}
                                      </span>
                                      {reliabilityReport.status === "pass_with_trade_drift" && (
                                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-medium text-blue-700">
                                          tolerance ±{reliabilityReport.tolerance?.tradeDeltaSoft ?? 10} trades
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                                {reliabilityState?.error && (
                                  <p className="mt-2 text-xs font-medium text-red-700">
                                    Reliability check error: {reliabilityState.error}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>

        <div className="mt-4">
          {!isCreateFormOpen ? (
            <button
              type="button"
              onClick={() => setIsCreateFormOpen(true)}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Add New Property
            </button>
          ) : (
            <form onSubmit={onCreateProperty} className="rounded-xl border border-slate-200 bg-white/80 p-4">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Property Name</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  value={newPropertyName}
                  onChange={(event) => setNewPropertyName(event.target.value)}
                  placeholder="e.g. Polymarket"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  Save Property
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateFormOpen(false);
                    setNewPropertyName("");
                  }}
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {error && <p className="mt-4 text-sm font-medium text-red-700">{error}</p>}
      </section>
    </PageShell>
  );
}
