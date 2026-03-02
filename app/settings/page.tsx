"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/app/components/page-shell";

interface WalletProfile {
  id: string;
  propertyId: string;
  wallet: string;
  label: string | null;
  strategyTag: string | null;
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
  updatedAt: string;
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

export default function SettingsPage() {
  const [properties, setProperties] = useState<PropertyModel[]>([]);
  const [syncStatesByProperty, setSyncStatesByProperty] = useState<Record<string, WalletSyncStateModel[]>>({});
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

  const editingProperty = useMemo(
    () => properties.find((property) => property.id === editingPropertyId) ?? null,
    [properties, editingPropertyId]
  );

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

  useEffect(() => {
    void loadProperties();
  }, [loadProperties]);

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
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Failed to remove wallet.";
      setError(message);
    } finally {
      setIsSubmitting(false);
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

        <div className="mt-5 space-y-3">
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
                      return (
                        <div
                          key={wallet.id}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5"
                        >
                          <span className="text-xs font-medium text-slate-700">
                            {wallet.label ? `${wallet.label} · ` : ""}
                            {wallet.wallet.slice(0, 10)}...{wallet.wallet.slice(-4)}
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
