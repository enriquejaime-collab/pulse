"use client";

import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/app/components/page-shell";

interface PolymarketSummaryResponse {
  wallet: string;
  asOf: string;
  totalTrades: number;
  totalVolumeUsd: number;
  estimatedFeesPaid: number | null;
  makerRebates: number;
  netEstimatedFees: number | null;
  feeDataCoveragePct: number;
  realizedPnl: number;
  openPnl: number;
  netPnl: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  pairExecution: {
    pairedMarkets: number;
    unpairedMarkets: number;
    activeMarkets: number;
    completionRatePct: number;
    grossEdgeUsd: number;
    netEdgeUsd: number | null;
    avgComboCost: number;
    avgGrossEdgeCentsPerPair: number;
    avgGrossEdgeBps: number;
    positiveEdgeRatePct: number;
    avgHedgeDelaySec: number | null;
    p95HedgeDelaySec: number | null;
  };
  tradeRows: Array<{
    id: string;
    timestamp: string;
    marketTitle: string;
    marketKey: string;
    outcome: string;
    side: string;
    price: number;
    size: number;
    notionalUsd: number;
    txHash: string;
  }>;
  closedPairRows: Array<{
    id: string;
    closedAt: string;
    eventTime: string | null;
    marketTitle: string;
    pairStatus: "Paired" | "Missing Leg";
    result: "Won" | "Lost" | "Flat";
    upUnits: number;
    upAvgPrice: number | null;
    upCost: number;
    upPnl: number;
    downUnits: number;
    downAvgPrice: number | null;
    downCost: number;
    downPnl: number;
    edge: number | null;
    coveragePct: number | null;
    pnlPct: number | null;
    auditFlags: string[];
    netPnl: number;
  }>;
  records: {
    trades: number;
    closedPositions: number;
    openPositions: number;
    activity: number;
  };
}

const formatUsd = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

const formatSignedUsd = (value: number): string => `${value >= 0 ? "+" : "-"}${formatUsd(Math.abs(value))}`;
const formatSignedCents = (value: number): string => `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}c`;
const formatAvgPriceCents = (value: number | null): string => (value === null ? "-" : `${Math.round(value * 100)}c`);
type DateRangePreset = "all" | "24h" | "7d" | "30d" | "month_to_date" | "last_month" | "custom";

const toDateInput = (date: Date): string => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getDateRangeBounds = (
  preset: DateRangePreset,
  customStartDate: string,
  customEndDate: string
): { startMs: number | null; endMs: number | null } => {
  const now = new Date();
  const nowMs = now.getTime();

  if (preset === "24h") {
    return { startMs: nowMs - 24 * 60 * 60 * 1000, endMs: nowMs };
  }
  if (preset === "7d") {
    return { startMs: nowMs - 7 * 24 * 60 * 60 * 1000, endMs: nowMs };
  }
  if (preset === "30d") {
    return { startMs: nowMs - 30 * 24 * 60 * 60 * 1000, endMs: nowMs };
  }
  if (preset === "month_to_date") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
    return { startMs: monthStart, endMs: nowMs };
  }
  if (preset === "last_month") {
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0).getTime();
    return { startMs: lastMonthStart, endMs: thisMonthStart };
  }
  if (preset === "custom") {
    const startMs = customStartDate ? new Date(`${customStartDate}T00:00:00`).getTime() : null;
    const endMs = customEndDate ? new Date(`${customEndDate}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 : null;
    return {
      startMs: startMs && Number.isFinite(startMs) ? startMs : null,
      endMs: endMs && Number.isFinite(endMs) ? endMs : null
    };
  }
  return { startMs: null, endMs: null };
};

const isInDateRange = (timestampMs: number, startMs: number | null, endMs: number | null): boolean => {
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  if (startMs !== null && timestampMs < startMs) {
    return false;
  }
  if (endMs !== null && timestampMs >= endMs) {
    return false;
  }
  return true;
};

const getRowTimeMs = (row: PolymarketSummaryResponse["closedPairRows"][number]): number =>
  Date.parse(row.eventTime ?? row.closedAt);

const getWindowBounds = (startDate: string, endDate: string): { startMs: number | null; endMs: number | null } => {
  if (!startDate || !endDate) {
    return { startMs: null, endMs: null };
  }
  const startMs = new Date(`${startDate}T00:00:00`).getTime();
  const endMs = new Date(`${endDate}T00:00:00`).getTime() + 24 * 60 * 60 * 1000;
  return {
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null
  };
};

const matchesStrategy = (marketTitle: string, strategy: string, customFilter: string): boolean => {
  const title = marketTitle.toLowerCase();
  if (strategy === "btc_updown") {
    return title.includes("bitcoin up or down");
  }
  if (strategy === "eth_updown") {
    return title.includes("ethereum up or down");
  }
  if (strategy === "custom") {
    const normalized = customFilter.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    return title.includes(normalized);
  }
  return true;
};

const getStrategyLabel = (strategy: "all" | "btc_updown" | "eth_updown" | "custom", customFilter: string): string => {
  if (strategy === "btc_updown") {
    return "Bitcoin Up or Down";
  }
  if (strategy === "eth_updown") {
    return "Ethereum Up or Down";
  }
  if (strategy === "custom") {
    const text = customFilter.trim();
    return text ? `Custom: ${text}` : "Custom";
  }
  return "All closed markets";
};

const getDatePresetLabel = (
  preset: DateRangePreset,
  customStartDate: string,
  customEndDate: string
): string => {
  if (preset === "24h") {
    return "Past 24 hours";
  }
  if (preset === "7d") {
    return "Past 7 days";
  }
  if (preset === "30d") {
    return "Past 30 days";
  }
  if (preset === "month_to_date") {
    return "Month to date";
  }
  if (preset === "last_month") {
    return "Last month";
  }
  if (preset === "custom") {
    if (customStartDate && customEndDate) {
      return `${customStartDate} to ${customEndDate}`;
    }
    return "Custom range";
  }
  return "All time";
};

const computePairExecutionFromClosedRows = (rows: PolymarketSummaryResponse["closedPairRows"]) => {
  const activeMarkets = rows.length;
  const pairedMarkets = rows.filter((row) => row.pairStatus === "Paired").length;
  const unpairedMarkets = Math.max(activeMarkets - pairedMarkets, 0);
  const pairedWithEdge = rows.filter(
    (row) => row.pairStatus === "Paired" && row.edge !== null && row.upAvgPrice !== null && row.downAvgPrice !== null
  );
  const completionRatePct = activeMarkets > 0 ? (pairedMarkets / activeMarkets) * 100 : 0;
  const grossEdgeUsd = pairedWithEdge.reduce((sum, row) => sum + (row.edge ?? 0), 0);
  const avgComboCost =
    pairedWithEdge.length > 0
      ? pairedWithEdge.reduce((sum, row) => sum + (row.upAvgPrice ?? 0) + (row.downAvgPrice ?? 0), 0) /
        pairedWithEdge.length
      : 0;
  const avgGrossEdgeCentsPerPair = pairedWithEdge.length > 0 ? (grossEdgeUsd / pairedWithEdge.length) * 100 : 0;
  const avgGrossEdgeBps = pairedWithEdge.length > 0 ? (grossEdgeUsd / pairedWithEdge.length) * 10_000 : 0;
  const positiveEdgeRatePct =
    pairedWithEdge.length > 0 ? (pairedWithEdge.filter((row) => (row.edge ?? 0) > 0).length / pairedWithEdge.length) * 100 : 0;

  return {
    pairedMarkets,
    unpairedMarkets,
    activeMarkets,
    completionRatePct,
    grossEdgeUsd,
    netEdgeUsd: null,
    avgComboCost,
    avgGrossEdgeCentsPerPair,
    avgGrossEdgeBps,
    positiveEdgeRatePct,
    avgHedgeDelaySec: null,
    p95HedgeDelaySec: null
  };
};

const percentile = (sortedValues: number[], p: number): number => {
  if (sortedValues.length === 0) {
    return 0;
  }
  const idx = (p / 100) * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) {
    return sortedValues[lo] ?? 0;
  }
  const loVal = sortedValues[lo] ?? 0;
  const hiVal = sortedValues[hi] ?? 0;
  const w = idx - lo;
  return loVal * (1 - w) + hiVal * w;
};

const computeEdgeDistribution = (rows: PolymarketSummaryResponse["closedPairRows"]) => {
  const edgesCents = rows
    .filter((row) => row.pairStatus === "Paired" && row.edge !== null)
    .map((row) => (row.edge ?? 0) * 100)
    .sort((a, b) => a - b);

  return {
    sample: edgesCents.length,
    p10: percentile(edgesCents, 10),
    p50: percentile(edgesCents, 50),
    p90: percentile(edgesCents, 90)
  };
};

const computeMissingLegImpact = (rows: PolymarketSummaryResponse["closedPairRows"]) => {
  const missingRows = rows.filter((row) => row.pairStatus === "Missing Leg");
  const count = missingRows.length;
  const notional = missingRows.reduce((sum, row) => sum + row.upCost + row.downCost, 0);
  const exposureShares = missingRows.reduce((sum, row) => sum + Math.abs(row.upUnits - row.downUnits), 0);
  const netPnl = missingRows.reduce((sum, row) => sum + row.netPnl, 0);
  const worstLoss = count > 0 ? Math.min(...missingRows.map((row) => row.netPnl)) : 0;

  return { count, notional, exposureShares, netPnl, worstLoss };
};

const computePnlBridge = (rows: PolymarketSummaryResponse["closedPairRows"]) => {
  let netPnl = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let pairedPnl = 0;
  let missingLegPnl = 0;
  let worstLoss = 0;
  let sizeWeightedEdgeUsd = 0;
  let matchedUnits = 0;

  for (const row of rows) {
    netPnl += row.netPnl;

    if (row.netPnl > 0) {
      grossWins += row.netPnl;
    } else if (row.netPnl < 0) {
      grossLosses += row.netPnl;
      worstLoss = Math.min(worstLoss, row.netPnl);
    }

    if (row.pairStatus === "Paired") {
      pairedPnl += row.netPnl;
      if (row.edge !== null) {
        const matched = Math.min(row.upUnits, row.downUnits);
        if (matched > 0) {
          matchedUnits += matched;
          sizeWeightedEdgeUsd += row.edge * matched;
        }
      }
    } else {
      missingLegPnl += row.netPnl;
    }
  }

  const sizeWeightedEdgeCentsPerMatchedUnit = matchedUnits > 0 ? (sizeWeightedEdgeUsd / matchedUnits) * 100 : 0;

  return {
    netPnl,
    grossWins,
    grossLosses,
    pairedPnl,
    missingLegPnl,
    worstLoss,
    sizeWeightedEdgeUsd,
    matchedUnits,
    sizeWeightedEdgeCentsPerMatchedUnit
  };
};

const computeWindowMetrics = (rows: PolymarketSummaryResponse["closedPairRows"]) => {
  const pair = computePairExecutionFromClosedRows(rows);
  const edges = computeEdgeDistribution(rows);
  const missing = computeMissingLegImpact(rows);
  const netPnl = rows.reduce((sum, row) => sum + row.netPnl, 0);
  return {
    rows: rows.length,
    pairCompletionPct: pair.completionRatePct,
    grossEdgeUsd: pair.grossEdgeUsd,
    positiveEdgePct: pair.positiveEdgeRatePct,
    netPnl,
    missingLegs: missing.count,
    edgeP50: edges.p50
  };
};

const formatSignedNumber = (value: number, decimals = 1, suffix = ""): string =>
  `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(decimals)}${suffix}`;

const metricColor = (value: number): string => {
  if (value > 0) {
    return "text-emerald-700";
  }
  if (value < 0) {
    return "text-red-700";
  }
  return "text-slate-700";
};

export default function TradesPage() {
  const [walletInput, setWalletInput] = useState("");
  const [summary, setSummary] = useState<PolymarketSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closedRowsVisible, setClosedRowsVisible] = useState(50);
  const [strategyFilter, setStrategyFilter] = useState<"all" | "btc_updown" | "eth_updown" | "custom">("all");
  const [customStrategyFilter, setCustomStrategyFilter] = useState("");
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [windowAStart, setWindowAStart] = useState("");
  const [windowAEnd, setWindowAEnd] = useState("");
  const [windowBStart, setWindowBStart] = useState("");
  const [windowBEnd, setWindowBEnd] = useState("");
  const [isAllTimeSummaryOpen, setIsAllTimeSummaryOpen] = useState(true);
  const [isIterationComparisonOpen, setIsIterationComparisonOpen] = useState(false);

  const strategyClosedRows = useMemo(() => {
    if (!summary) {
      return [];
    }
    return summary.closedPairRows.filter((row) => matchesStrategy(row.marketTitle, strategyFilter, customStrategyFilter));
  }, [summary, strategyFilter, customStrategyFilter]);

  const filteredClosedRows = useMemo(() => {
    const { startMs, endMs } = getDateRangeBounds(dateRangePreset, customStartDate, customEndDate);
    return strategyClosedRows
      .filter((row) => isInDateRange(getRowTimeMs(row), startMs, endMs))
      .sort((a, b) => getRowTimeMs(b) - getRowTimeMs(a));
  }, [strategyClosedRows, dateRangePreset, customStartDate, customEndDate]);

  const closedAuditSummary = useMemo(() => {
    const missingLegs = filteredClosedRows.filter((row) => row.pairStatus === "Missing Leg").length;
    const flagged = filteredClosedRows.filter((row) => row.auditFlags.length > 0).length;
    return { missingLegs, flagged };
  }, [filteredClosedRows]);

  const filteredPairExecution = useMemo(
    () => computePairExecutionFromClosedRows(filteredClosedRows),
    [filteredClosedRows]
  );
  const filteredEdgeDistribution = useMemo(
    () => computeEdgeDistribution(filteredClosedRows),
    [filteredClosedRows]
  );
  const filteredMissingImpact = useMemo(
    () => computeMissingLegImpact(filteredClosedRows),
    [filteredClosedRows]
  );
  const filteredPnlBridge = useMemo(
    () => computePnlBridge(filteredClosedRows),
    [filteredClosedRows]
  );

  const windowARows = useMemo(() => {
    const { startMs, endMs } = getWindowBounds(windowAStart, windowAEnd);
    if (startMs === null || endMs === null) {
      return [];
    }
    return strategyClosedRows.filter((row) => isInDateRange(getRowTimeMs(row), startMs, endMs));
  }, [strategyClosedRows, windowAStart, windowAEnd]);

  const windowBRows = useMemo(() => {
    const { startMs, endMs } = getWindowBounds(windowBStart, windowBEnd);
    if (startMs === null || endMs === null) {
      return [];
    }
    return strategyClosedRows.filter((row) => isInDateRange(getRowTimeMs(row), startMs, endMs));
  }, [strategyClosedRows, windowBStart, windowBEnd]);

  const windowAMetrics = useMemo(() => computeWindowMetrics(windowARows), [windowARows]);
  const windowBMetrics = useMemo(() => computeWindowMetrics(windowBRows), [windowBRows]);
  const comparisonDelta = useMemo(
    () => ({
      pairs: windowBMetrics.rows - windowAMetrics.rows,
      completion: windowBMetrics.pairCompletionPct - windowAMetrics.pairCompletionPct,
      grossEdgeUsd: windowBMetrics.grossEdgeUsd - windowAMetrics.grossEdgeUsd,
      positiveEdgePct: windowBMetrics.positiveEdgePct - windowAMetrics.positiveEdgePct,
      netPnl: windowBMetrics.netPnl - windowAMetrics.netPnl,
      missingLegs: windowBMetrics.missingLegs - windowAMetrics.missingLegs,
      edgeP50: windowBMetrics.edgeP50 - windowAMetrics.edgeP50
    }),
    [windowAMetrics, windowBMetrics]
  );

  const strategyFilterLabel = useMemo(
    () => getStrategyLabel(strategyFilter, customStrategyFilter),
    [strategyFilter, customStrategyFilter]
  );
  const dateRangeLabel = useMemo(
    () => getDatePresetLabel(dateRangePreset, customStartDate, customEndDate),
    [dateRangePreset, customStartDate, customEndDate]
  );

  useEffect(() => {
    setClosedRowsVisible(50);
  }, [summary?.asOf, strategyFilter, customStrategyFilter, dateRangePreset, customStartDate, customEndDate]);

  useEffect(() => {
    if (!summary) {
      return;
    }
    const now = new Date();
    const bEnd = new Date(now);
    const bStart = new Date(now);
    bStart.setDate(bStart.getDate() - 6);

    const aEnd = new Date(bStart);
    aEnd.setDate(aEnd.getDate() - 1);
    const aStart = new Date(aEnd);
    aStart.setDate(aStart.getDate() - 6);

    setWindowAStart(toDateInput(aStart));
    setWindowAEnd(toDateInput(aEnd));
    setWindowBStart(toDateInput(bStart));
    setWindowBEnd(toDateInput(bEnd));
  }, [summary, summary?.asOf, strategyFilter, customStrategyFilter]);

  const onFetchSummary = async () => {
    const wallet = walletInput.trim();
    if (!wallet) {
      setError("Enter your wallet address first.");
      setSummary(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/polymarket/summary?wallet=${encodeURIComponent(wallet)}`);
      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        setSummary(null);
        const errorMessage =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Failed to fetch Polymarket data.";
        setError(errorMessage);
        return;
      }

      setSummary(payload as PolymarketSummaryResponse);
    } catch {
      setSummary(null);
      setError("Network error while loading your summary.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PageShell
      title="Trades"
      subtitle="Pull your Polymarket trading stats directly from API data for P/L, trades, win/loss, and pair execution."
      showHeader={false}
    >
      <section className="glass-panel rounded-3xl p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-slate-900">Polymarket Wallet Summary</h2>
        <p className="mt-2 text-sm text-slate-600">
          Uses your public wallet address to pull your Polymarket trading stats directly from API data.
        </p>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            placeholder="0x..."
            value={walletInput}
            onChange={(event) => setWalletInput(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
          />
          <button
            type="button"
            onClick={onFetchSummary}
            disabled={isLoading}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Loading..." : "Fetch"}
          </button>
        </div>

        {error && <p className="mt-4 text-sm font-medium text-red-700">{error}</p>}
      </section>

      {summary && (
        <>
          <section className="glass-panel overflow-hidden rounded-2xl">
            <button
              type="button"
              onClick={() => setIsAllTimeSummaryOpen((open) => !open)}
              aria-expanded={isAllTimeSummaryOpen}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">All-time Summary</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {summary.totalTrades.toLocaleString()} trades · {formatUsd(summary.totalVolumeUsd)} volume
                </p>
              </div>
              <span className="text-xs font-medium text-slate-600">{isAllTimeSummaryOpen ? "Collapse" : "Expand"}</span>
            </button>

            {isAllTimeSummaryOpen && (
              <div className="border-t border-slate-200/80 p-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <article className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Net P/L</p>
                    <p className={`mt-2 text-2xl font-semibold ${metricColor(summary.netPnl)}`}>
                      {formatSignedUsd(summary.netPnl)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Realized {formatSignedUsd(summary.realizedPnl)} | Open {formatSignedUsd(summary.openPnl)}
                    </p>
                  </article>

                  <article className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Win / Loss</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">
                      {summary.wins} / {summary.losses}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Win rate: {summary.winRate.toFixed(1)}% | Breakeven: {summary.breakeven}
                    </p>
                  </article>

                  <article className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Trades</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{summary.totalTrades.toLocaleString()}</p>
                    <p className="mt-1 text-xs text-slate-500">Volume: {formatUsd(summary.totalVolumeUsd)}</p>
                  </article>
                </div>

                <p className="mt-4 rounded-xl border border-slate-200/80 bg-white/75 px-3 py-2 text-xs text-slate-600">
                  Definitions: <span className="font-medium text-slate-700">Total Trades</span> is raw fills from{" "}
                  <code>/trades</code>. <span className="font-medium text-slate-700">Pair Execution markets</span> are
                  unique market events in closed pairs after current filters.
                </p>
              </div>
            )}
          </section>

          <section className="glass-panel rounded-2xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Filter Controls</p>
            <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">Select your analysis window</h3>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4">
              <div className="sm:w-auto">
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Strategy</label>
                <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    value={strategyFilter}
                    onChange={(event) =>
                      setStrategyFilter(event.target.value as "all" | "btc_updown" | "eth_updown" | "custom")
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 sm:w-[18rem]"
                  >
                    <option value="all">All closed markets</option>
                    <option value="btc_updown">Bitcoin Up or Down only</option>
                    <option value="eth_updown">Ethereum Up or Down only</option>
                    <option value="custom">Custom market text</option>
                  </select>
                  {strategyFilter === "custom" && (
                    <input
                      type="text"
                      value={customStrategyFilter}
                      onChange={(event) => setCustomStrategyFilter(event.target.value)}
                      placeholder="e.g. Bitcoin Up or Down"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 sm:w-[18rem]"
                    />
                  )}
                </div>
              </div>

              <div className="sm:w-auto">
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Date</label>
                <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    value={dateRangePreset}
                    onChange={(event) => setDateRangePreset(event.target.value as DateRangePreset)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 sm:w-[13rem]"
                  >
                    <option value="all">All time</option>
                    <option value="24h">Past 24 hours</option>
                    <option value="7d">Past 7 days</option>
                    <option value="30d">Past 30 days</option>
                    <option value="month_to_date">Month to date</option>
                    <option value="last_month">Last month</option>
                    <option value="custom">Custom range</option>
                  </select>
                  {dateRangePreset === "custom" && (
                    <>
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(event) => setCustomStartDate(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                      />
                      <span className="text-xs text-slate-500">to</span>
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(event) => setCustomEndDate(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                      />
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                {filteredClosedRows.length.toLocaleString()} markets
              </span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
                {closedAuditSummary.missingLegs.toLocaleString()} missing legs
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                {closedAuditSummary.flagged.toLocaleString()} flagged rows
              </span>
            </div>
          </section>

          <section className="glass-panel rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Pair Execution</p>
                <h3 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Pair Execution Metrics</h3>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                Live · Filtered
              </span>
            </div>

            <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-700">
              Net P/L {formatSignedUsd(filteredPnlBridge.netPnl)} = wins {formatSignedUsd(filteredPnlBridge.grossWins)} +
              losses {formatSignedUsd(filteredPnlBridge.grossLosses)} · missing-leg P/L{" "}
              {formatSignedUsd(filteredPnlBridge.missingLegPnl)}
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Theoretical Edge (1x)</p>
                <p className={`mt-1 text-2xl font-semibold ${metricColor(filteredPairExecution.grossEdgeUsd)}`}>
                  {formatSignedUsd(filteredPairExecution.grossEdgeUsd)}
                </p>
                <p className="mt-1 text-xs text-slate-500">1 unit per paired market</p>
              </div>

              <div className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Pair Completion</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {filteredPairExecution.completionRatePct.toFixed(1)}%
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {filteredPairExecution.pairedMarkets} paired / {filteredPairExecution.activeMarkets} active
                </p>
              </div>

              <div className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Positive Edge</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">
                  {filteredPairExecution.positiveEdgeRatePct.toFixed(1)}%
                </p>
                <p className="mt-1 text-xs text-slate-500">Among paired markets only</p>
              </div>

              <div className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Missing Leg P/L</p>
                <p className={`mt-1 text-2xl font-semibold ${metricColor(filteredPnlBridge.missingLegPnl)}`}>
                  {formatSignedUsd(filteredPnlBridge.missingLegPnl)}
                </p>
                <p className="mt-1 text-xs text-slate-500">{filteredMissingImpact.count} missing legs</p>
              </div>

              <div className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Net P/L (Period)</p>
                <p className={`mt-1 text-2xl font-semibold ${metricColor(filteredPnlBridge.netPnl)}`}>
                  {formatSignedUsd(filteredPnlBridge.netPnl)}
                </p>
                <p className="mt-1 text-xs text-slate-500">All filtered closed pairs</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Edge Distribution (Cents)</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-slate-200/80 bg-white/80 px-2 py-2 text-center">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">p10</p>
                    <p className="mt-1 text-lg font-semibold text-slate-800">{formatSignedCents(filteredEdgeDistribution.p10)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200/80 bg-white/80 px-2 py-2 text-center">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">p50</p>
                    <p className="mt-1 text-lg font-semibold text-slate-800">{formatSignedCents(filteredEdgeDistribution.p50)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200/80 bg-white/80 px-2 py-2 text-center">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">p90</p>
                    <p className="mt-1 text-lg font-semibold text-slate-800">{formatSignedCents(filteredEdgeDistribution.p90)}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">Based on {filteredEdgeDistribution.sample} paired markets</p>
                <p className="mt-1 text-xs text-slate-500">
                  Size-weighted edge: {formatSignedUsd(filteredPnlBridge.sizeWeightedEdgeUsd)} (
                  {formatSignedCents(filteredPnlBridge.sizeWeightedEdgeCentsPerMatchedUnit)} per matched unit)
                </p>
              </div>

              <div className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">P/L Bridge (Filtered)</p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Gross wins</p>
                    <p className={`mt-1 text-lg font-semibold ${metricColor(filteredPnlBridge.grossWins)}`}>
                      {formatSignedUsd(filteredPnlBridge.grossWins)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Gross losses</p>
                    <p className={`mt-1 text-lg font-semibold ${metricColor(filteredPnlBridge.grossLosses)}`}>
                      {formatSignedUsd(filteredPnlBridge.grossLosses)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Paired P/L</p>
                    <p className={`mt-1 text-lg font-semibold ${metricColor(filteredPnlBridge.pairedPnl)}`}>
                      {formatSignedUsd(filteredPnlBridge.pairedPnl)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Worst single loss</p>
                    <p className={`mt-1 text-lg font-semibold ${metricColor(filteredPnlBridge.worstLoss)}`}>
                      {formatSignedUsd(filteredPnlBridge.worstLoss)}
                    </p>
                  </div>
                </div>
                <p className="mt-2 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2 text-xs text-slate-600">
                  Net P/L = Gross wins + Gross losses
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Missing legs {filteredMissingImpact.count} | Exposure {filteredMissingImpact.exposureShares.toFixed(2)} shares | Notional at risk{" "}
                  {formatUsd(filteredMissingImpact.notional)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Net P/L = Paired P/L + Missing-leg P/L
                </p>
              </div>
            </div>
          </section>

          <section className="glass-panel overflow-hidden rounded-2xl">
            <button
              type="button"
              onClick={() => setIsIterationComparisonOpen((open) => !open)}
              aria-expanded={isIterationComparisonOpen}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                  Iteration Comparison (A vs B)
                </h3>
                <p className="mt-1 text-xs text-slate-500">Uses strategy filter, independent date windows</p>
              </div>
              <span className="text-xs font-medium text-slate-600">
                {isIterationComparisonOpen ? "Collapse" : "Expand"}
              </span>
            </button>

            {isIterationComparisonOpen && (
              <div className="border-t border-slate-200/80 px-5 py-4">
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Window A (Baseline)</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        value={windowAStart}
                        onChange={(event) => setWindowAStart(event.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                      />
                      <span className="text-xs text-slate-500">to</span>
                      <input
                        type="date"
                        value={windowAEnd}
                        onChange={(event) => setWindowAEnd(event.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/90 bg-white/70 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Window B (Candidate)</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        value={windowBStart}
                        onChange={(event) => setWindowBStart(event.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                      />
                      <span className="text-xs text-slate-500">to</span>
                      <input
                        type="date"
                        value={windowBEnd}
                        onChange={(event) => setWindowBEnd(event.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200/90 bg-white/80">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-100/90 text-slate-700">
                        <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">Metric</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">A</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">B</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">Delta (B-A)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="odd:bg-white even:bg-slate-50/60">
                        <td className="border-b border-slate-100 px-3 py-2 text-slate-700">Pairs (rows)</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">{windowAMetrics.rows}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">{windowBMetrics.rows}</td>
                        <td
                          className={`border-b border-slate-100 px-3 py-2 text-right font-medium ${metricColor(
                            comparisonDelta.pairs
                          )}`}
                        >
                          {formatSignedNumber(comparisonDelta.pairs, 0)}
                        </td>
                      </tr>
                      <tr className="odd:bg-white even:bg-slate-50/60">
                        <td className="border-b border-slate-100 px-3 py-2 text-slate-700">Pair completion</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">
                          {windowAMetrics.pairCompletionPct.toFixed(1)}%
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">
                          {windowBMetrics.pairCompletionPct.toFixed(1)}%
                        </td>
                        <td
                          className={`border-b border-slate-100 px-3 py-2 text-right font-medium ${metricColor(
                            comparisonDelta.completion
                          )}`}
                        >
                          {formatSignedNumber(comparisonDelta.completion, 1, "%")}
                        </td>
                      </tr>
                      <tr className="odd:bg-white even:bg-slate-50/60">
                        <td className="border-b border-slate-100 px-3 py-2 text-slate-700">Gross edge</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">
                          {formatSignedUsd(windowAMetrics.grossEdgeUsd)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">
                          {formatSignedUsd(windowBMetrics.grossEdgeUsd)}
                        </td>
                        <td
                          className={`border-b border-slate-100 px-3 py-2 text-right font-medium ${metricColor(
                            comparisonDelta.grossEdgeUsd
                          )}`}
                        >
                          {formatSignedUsd(comparisonDelta.grossEdgeUsd)}
                        </td>
                      </tr>
                      <tr className="odd:bg-white even:bg-slate-50/60">
                        <td className="border-b border-slate-100 px-3 py-2 text-slate-700">Positive edge rate</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">
                          {windowAMetrics.positiveEdgePct.toFixed(1)}%
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">
                          {windowBMetrics.positiveEdgePct.toFixed(1)}%
                        </td>
                        <td
                          className={`border-b border-slate-100 px-3 py-2 text-right font-medium ${metricColor(
                            comparisonDelta.positiveEdgePct
                          )}`}
                        >
                          {formatSignedNumber(comparisonDelta.positiveEdgePct, 1, "%")}
                        </td>
                      </tr>
                      <tr className="odd:bg-white even:bg-slate-50/60">
                        <td className="border-b border-slate-100 px-3 py-2 text-slate-700">Net P/L</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">
                          {formatSignedUsd(windowAMetrics.netPnl)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">
                          {formatSignedUsd(windowBMetrics.netPnl)}
                        </td>
                        <td
                          className={`border-b border-slate-100 px-3 py-2 text-right font-medium ${metricColor(
                            comparisonDelta.netPnl
                          )}`}
                        >
                          {formatSignedUsd(comparisonDelta.netPnl)}
                        </td>
                      </tr>
                      <tr className="odd:bg-white even:bg-slate-50/60">
                        <td className="border-b border-slate-100 px-3 py-2 text-slate-700">Missing legs</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">
                          {windowAMetrics.missingLegs}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">
                          {windowBMetrics.missingLegs}
                        </td>
                        <td
                          className={`border-b border-slate-100 px-3 py-2 text-right font-medium ${metricColor(
                            -comparisonDelta.missingLegs
                          )}`}
                        >
                          {formatSignedNumber(comparisonDelta.missingLegs, 0)}
                        </td>
                      </tr>
                      <tr className="odd:bg-white even:bg-slate-50/60">
                        <td className="px-3 py-2 text-slate-700">Median edge (p50)</td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {formatSignedCents(windowAMetrics.edgeP50)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {formatSignedCents(windowBMetrics.edgeP50)}
                        </td>
                        <td className={`px-3 py-2 text-right font-medium ${metricColor(comparisonDelta.edgeP50)}`}>
                          {formatSignedCents(comparisonDelta.edgeP50)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section className="glass-panel overflow-hidden rounded-2xl">
            <div className="border-b border-slate-200/80 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Raw Trade Data</h3>
              <p className="mt-1 text-xs text-slate-500">
                Closed pairs sorted by market event time (most recent first). This table is the source for filtered pair
                metrics.
              </p>
            </div>
            <div className="sticky top-[5.25rem] z-10 border-y border-slate-200/80 bg-white/90 px-4 py-2 backdrop-blur-sm sm:px-5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold uppercase tracking-wide text-slate-500">Active filters</span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
                  Strategy: {strategyFilterLabel}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
                  Date: {dateRangeLabel}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
                  Net P/L: {formatSignedUsd(filteredPnlBridge.netPnl)}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
                  Theoretical edge (1x): {formatSignedUsd(filteredPairExecution.grossEdgeUsd)}
                </span>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
                  Missing-leg P/L: {formatSignedUsd(filteredPnlBridge.missingLegPnl)}
                </span>
              </div>
            </div>
            <div className="overflow-x-auto px-3 sm:px-4">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-100/95">
                  <tr>
                    <th className="w-36 border-b border-slate-200 pl-4 pr-2 py-2 text-left font-semibold text-slate-800">Event</th>
                    <th className="w-16 border-b border-slate-200 px-2 py-2 text-left font-semibold text-slate-800">Result</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-800">Market</th>
                    <th className="w-36 border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-800">UP Bet</th>
                    <th className="w-36 border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-800">DOWN Bet</th>
                    <th className="w-28 border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-800">Pair</th>
                    <th className="w-20 border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-800">Edge</th>
                    <th className="w-24 border-b border-slate-200 pl-2 pr-4 py-2 text-right font-semibold text-slate-800">Net P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClosedRows.slice(0, closedRowsVisible).map((row) => (
                    <tr key={row.id} className="odd:bg-white even:bg-slate-50/60">
                      <td className="border-b border-slate-100 pl-4 pr-2 py-2 text-slate-700">
                        <p>{new Date(row.eventTime ?? row.closedAt).toLocaleDateString()}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(row.eventTime ?? row.closedAt).toLocaleTimeString()}
                        </p>
                        {row.eventTime && (
                          <p className="text-[11px] text-slate-400">
                            closed {new Date(row.closedAt).toLocaleTimeString()}
                          </p>
                        )}
                      </td>
                      <td
                        className={`border-b border-slate-100 px-2 py-2 font-medium ${
                          row.result === "Won"
                            ? "text-emerald-700"
                            : row.result === "Lost"
                              ? "text-red-700"
                              : "text-slate-700"
                        }`}
                      >
                        {row.result}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                        <p className="whitespace-nowrap text-[0.9rem] leading-snug text-slate-800" title={row.marketTitle}>
                          {row.marketTitle}
                        </p>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                        {row.upUnits > 0 ? (
                          <>
                            <p>{row.upUnits.toFixed(2)} shares</p>
                            <p className="text-xs text-slate-500">avg {formatAvgPriceCents(row.upAvgPrice)}</p>
                            <p className="text-xs text-slate-500">cost {formatUsd(row.upCost)}</p>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                        {row.downUnits > 0 ? (
                          <>
                            <p>{row.downUnits.toFixed(2)} shares</p>
                            <p className="text-xs text-slate-500">avg {formatAvgPriceCents(row.downAvgPrice)}</p>
                            <p className="text-xs text-slate-500">cost {formatUsd(row.downCost)}</p>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-700">
                        {row.pairStatus === "Missing Leg" ? (
                          <span className="inline-flex whitespace-nowrap items-center gap-1.5 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                            <span aria-hidden="true">!</span>
                            Missing Leg
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
                            Paired
                          </span>
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-2 text-right text-slate-700">
                        {row.edge === null ? "-" : formatSignedCents(row.edge * 100)}
                      </td>
                      <td className={`border-b border-slate-100 pl-2 pr-4 py-2 text-right font-medium ${metricColor(row.netPnl)}`}>
                        <p>{formatSignedUsd(row.netPnl)}</p>
                        {row.pnlPct !== null && <p className="text-xs text-slate-500">{row.pnlPct.toFixed(1)}%</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 px-6 py-3 text-sm">
              <p className="text-slate-600">
                Showing {Math.min(closedRowsVisible, filteredClosedRows.length)} of {filteredClosedRows.length} pairs
              </p>
              <p className="text-xs text-slate-500">
                Wallet {summary.wallet.slice(0, 8)}...{summary.wallet.slice(-4)} · As of{" "}
                {new Date(summary.asOf).toLocaleString()}
              </p>
              <div className="flex gap-2">
                {closedRowsVisible > 50 && (
                  <button
                    type="button"
                    onClick={() => setClosedRowsVisible(50)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-700 transition hover:bg-slate-50"
                  >
                    Show less
                  </button>
                )}
                {closedRowsVisible < filteredClosedRows.length && (
                  <button
                    type="button"
                    onClick={() => setClosedRowsVisible((current) => current + 50)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-700 transition hover:bg-slate-50"
                  >
                    Show 50 more
                  </button>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </PageShell>
  );
}
