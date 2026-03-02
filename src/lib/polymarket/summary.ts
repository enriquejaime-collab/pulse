const POLYMARKET_DATA_API_BASE_URL = "https://data-api.polymarket.com";

export interface PolymarketTrade {
  id?: string;
  side?: string;
  size?: number | string;
  price?: number | string;
  fee_rate_bps?: number | string;
  transactionHash?: string;
  timestamp?: number | string;
  asset?: string;
  outcome?: string;
  outcomeIndex?: number | string;
  conditionId?: string;
  market?: string;
  marketId?: string;
  slug?: string;
  eventSlug?: string;
  title?: string;
  question?: string;
}

export interface PolymarketPosition {
  [key: string]: unknown;
  realizedPnl?: number | string;
  cashPnl?: number | string;
}

export interface PolymarketActivity {
  [key: string]: unknown;
  type?: string;
  usdcSize?: number | string;
  timestamp?: number | string;
}

export interface PolymarketSummary {
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
    marketUrl: string | null;
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

export const getTradeCanonicalKey = (trade: PolymarketTrade): string => {
  const outcomeToken = String(trade.asset ?? trade.outcome ?? trade.outcomeIndex ?? "");
  const marketToken = String(trade.conditionId ?? trade.marketId ?? trade.market ?? trade.slug ?? "");
  return [
    String(trade.id ?? ""),
    String(trade.transactionHash ?? ""),
    String(trade.timestamp ?? ""),
    outcomeToken,
    String(trade.side ?? ""),
    String(trade.size ?? ""),
    String(trade.price ?? ""),
    marketToken
  ]
    .map((part) => part.trim().toLowerCase())
    .join("|");
};

interface NormalizedTrade {
  id: string;
  side: "BUY" | "SELL" | "OTHER";
  price: number;
  quoteSize: number;
  payoutUnits: number;
  feeEstimate: number | null;
  timestampMs: number;
  marketKey: string;
  marketTitle: string;
  outcomeKey: string;
}

interface OutcomeAggregate {
  units: number;
  quoteCost: number;
  firstTimestampMs: number;
}

interface ClosedLegAggregate {
  units: number;
  cost: number;
  pnl: number;
}

interface ClosedPairAggregate {
  marketTitle: string;
  closedAtMs: number;
  marketUrl: string | null;
  legs: Record<"UP" | "DOWN", ClosedLegAggregate>;
}

const MARKET_MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11
};

const toNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toTimestampMs = (value: unknown): number => {
  const parsed = tryParseTimestampMs(value);
  return parsed ?? Date.now();
};

const tryParseTimestampMs = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const getStringFromKeys = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
};

const getNumberFromKeys = (record: Record<string, unknown>, keys: string[]): number => {
  for (const key of keys) {
    const parsed = toNumber(record[key]);
    if (parsed !== 0) {
      return parsed;
    }
  }
  return 0;
};

const to24Hour = (hour12: number, amPmRaw: string): number => {
  const amPm = amPmRaw.toUpperCase();
  if (amPm === "AM") {
    return hour12 === 12 ? 0 : hour12;
  }
  return hour12 === 12 ? 12 : hour12 + 12;
};

const parseMarketEventStartMs = (title: string, fallbackMs: number): number | null => {
  const eventRegex =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{1,2}):(\d{2})\s*(AM|PM)-(\d{1,2}):(\d{2})\s*(AM|PM)\s*ET\b/i;
  const match = title.match(eventRegex);
  if (!match) {
    return null;
  }

  const monthIndex = MARKET_MONTHS[match[1]?.toLowerCase() ?? ""];
  const day = Number(match[2] ?? 0);
  const startHour12 = Number(match[3] ?? 0);
  const startMinute = Number(match[4] ?? 0);
  if (!Number.isFinite(monthIndex) || day <= 0 || startHour12 <= 0 || startMinute < 0) {
    return null;
  }

  const year = new Date(fallbackMs).getUTCFullYear();
  const startHour24 = to24Hour(startHour12, match[5] ?? "AM");
  // Use ET fixed offset for ordering; precision to the minute is sufficient for audit sorting.
  const timestamp = Date.UTC(year, monthIndex, day, startHour24 + 5, startMinute, 0, 0);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const extractArray = <T>(payload: unknown): T[] => {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const maybeCollection = payload as Record<string, unknown>;
  const collectionKeys = ["data", "items", "results", "trades", "positions", "activity"];
  for (const key of collectionKeys) {
    if (Array.isArray(maybeCollection[key])) {
      return maybeCollection[key] as T[];
    }
  }

  return [];
};

interface FetchOptions {
  maxOffset?: number;
  pageSize?: number;
  dedupeKey?: (row: unknown) => string;
  nonFatalStatuses?: number[];
  queryParams?: Record<string, string | number | boolean>;
  maxPages?: number;
  stopWhenAllRowsOlderThanMs?: number;
  getRowTimestampMs?: (row: unknown) => number | null;
}

const dedupeRows = <T>(rows: T[], dedupeKey?: (row: unknown) => string): T[] => {
  if (!dedupeKey) {
    return rows;
  }

  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of rows) {
    const key = dedupeKey(row);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
};

const fetchPaginated = async <T>(endpoint: string, wallet: string, options: FetchOptions = {}): Promise<T[]> => {
  const pageSize = options.pageSize ?? 50;
  const maxOffset = options.maxOffset ?? 10_000;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  const nonFatalStatuses = new Set(options.nonFatalStatuses ?? []);
  const allRows: T[] = [];

  for (let page = 0; ; page += 1) {
    if (page >= maxPages) {
      break;
    }
    const offset = page * pageSize;
    if (offset > maxOffset) {
      break;
    }

    const url = new URL(`${POLYMARKET_DATA_API_BASE_URL}${endpoint}`);
    url.searchParams.set("user", wallet);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    for (const [key, value] of Object.entries(options.queryParams ?? {})) {
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) {
      if (nonFatalStatuses.has(response.status)) {
        // Some Data API endpoints return 400 when offset exceeds the allowed max.
        // Treat that as "end of pagination" only after at least one successful page.
        if (page > 0) {
          break;
        }
        throw new Error(`Polymarket API error (${response.status}) at ${endpoint}`);
      }
      throw new Error(`Polymarket API error (${response.status}) at ${endpoint}`);
    }

    const payload = (await response.json()) as unknown;
    const rows = extractArray<T>(payload);
    allRows.push(...rows);

    const stopWhenAllRowsOlderThanMs = options.stopWhenAllRowsOlderThanMs;
    const getRowTimestampMs = options.getRowTimestampMs;
    if (stopWhenAllRowsOlderThanMs !== undefined && getRowTimestampMs && rows.length > 0) {
      const isAllOlder = rows.every((row) => {
        const timestampMs = getRowTimestampMs(row);
        return timestampMs !== null && timestampMs !== undefined && timestampMs <= stopWhenAllRowsOlderThanMs;
      });
      if (isAllOlder) {
        break;
      }
    }

    if (rows.length < pageSize) {
      break;
    }
  }

  return dedupeRows(allRows, options.dedupeKey);
};

const estimateTradeFee = (trade: PolymarketTrade): number => {
  const side = (trade.side ?? "").toUpperCase();
  const size = toNumber(trade.size);
  const price = toNumber(trade.price);
  const feeRateBps = toNumber(trade.fee_rate_bps);

  if (size <= 0 || feeRateBps <= 0 || price <= 0 || price >= 1) {
    return 0;
  }

  const feeRate = feeRateBps / 10_000;
  const minPrice = Math.min(price, 1 - price);

  if (side === "BUY") {
    return feeRate * minPrice * (size / price);
  }

  return feeRate * minPrice * size;
};

const getMarketKey = (trade: PolymarketTrade): string => {
  return (
    trade.conditionId ??
    trade.marketId ??
    trade.market ??
    trade.slug ??
    trade.eventSlug ??
    trade.question ??
    trade.title ??
    "unknown-market"
  );
};

const getMarketTitle = (trade: PolymarketTrade): string => {
  return trade.question ?? trade.title ?? trade.market ?? trade.slug ?? trade.eventSlug ?? getMarketKey(trade);
};

const getOutcomeKey = (trade: PolymarketTrade): string => {
  return trade.asset ?? trade.outcome ?? String(trade.outcomeIndex ?? "unknown-outcome");
};

const normalizePolymarketUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("https://polymarket.com/")) {
    return trimmed;
  }
  if (trimmed.startsWith("http://polymarket.com/")) {
    return `https://${trimmed.slice("http://".length)}`;
  }
  if (trimmed.startsWith("/event/")) {
    return `https://polymarket.com${trimmed}`;
  }
  if (trimmed.startsWith("event/")) {
    return `https://polymarket.com/${trimmed}`;
  }
  return null;
};

const looksLikeSlug = (value: string): boolean => /^[a-z0-9-]+$/i.test(value.trim());

const buildPolymarketEventUrlFromSlugs = (eventSlugRaw: string, marketSlugRaw: string): string | null => {
  const eventSlug = eventSlugRaw.trim();
  const marketSlug = marketSlugRaw.trim();
  if (!eventSlug || !marketSlug || !looksLikeSlug(eventSlug) || !looksLikeSlug(marketSlug)) {
    return null;
  }
  return `https://polymarket.com/event/${eventSlug}/${marketSlug}`;
};

const getPolymarketEventUrlFromRecord = (record: Record<string, unknown>): string | null => {
  const explicit = getStringFromKeys(record, [
    "url",
    "marketUrl",
    "market_url",
    "eventUrl",
    "event_url",
    "href",
    "permalink",
    "link"
  ]);
  const normalizedExplicit = explicit ? normalizePolymarketUrl(explicit) : null;
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const eventSlug = getStringFromKeys(record, ["eventSlug", "event_slug", "event", "eventId", "event_id"]);
  const marketSlug = getStringFromKeys(record, ["slug", "marketSlug", "market_slug"]);
  const fullFromBoth = buildPolymarketEventUrlFromSlugs(eventSlug, marketSlug);
  if (fullFromBoth) {
    return fullFromBoth;
  }

  if (looksLikeSlug(marketSlug)) {
    const fallback = buildPolymarketEventUrlFromSlugs(marketSlug, marketSlug);
    if (fallback) {
      return fallback;
    }
  }
  if (looksLikeSlug(eventSlug)) {
    const fallback = buildPolymarketEventUrlFromSlugs(eventSlug, eventSlug);
    if (fallback) {
      return fallback;
    }
  }

  return null;
};

const normalizeTrade = (trade: PolymarketTrade): NormalizedTrade | null => {
  const sideRaw = (trade.side ?? "").toUpperCase();
  const side: NormalizedTrade["side"] = sideRaw === "BUY" ? "BUY" : sideRaw === "SELL" ? "SELL" : "OTHER";
  const price = toNumber(trade.price);
  const quoteSize = toNumber(trade.size);
  // Data API trade.size is in outcome token units (shares), not USDC notional.
  const payoutUnits = quoteSize;
  const marketKey = getMarketKey(trade);
  const marketTitle = getMarketTitle(trade);
  const outcomeKey = getOutcomeKey(trade);
  const feeEstimate = toNumber(trade.fee_rate_bps) > 0 ? estimateTradeFee(trade) : null;

  if (price <= 0 || price >= 1 || quoteSize <= 0 || payoutUnits <= 0 || !marketKey || !marketTitle || !outcomeKey) {
    return null;
  }

  return {
    id:
      trade.id ??
      `${trade.transactionHash ?? "tx"}:${trade.timestamp ?? "ts"}:${trade.asset ?? "asset"}:${trade.side ?? "side"}`,
    side,
    price,
    quoteSize,
    payoutUnits,
    feeEstimate,
    timestampMs: toTimestampMs(trade.timestamp),
    marketKey,
    marketTitle,
    outcomeKey
  };
};

const percentile = (sortedValues: number[], p: number): number => {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((p / 100) * (sortedValues.length - 1))));
  return sortedValues[index] ?? 0;
};

const canonicalDirection = (outcomeKey: string): string => {
  const normalized = outcomeKey.trim().toLowerCase();
  if (normalized.includes("up") || normalized === "yes") {
    return "UP";
  }
  if (normalized.includes("down") || normalized === "no") {
    return "DOWN";
  }
  return normalized || "unknown";
};

const getPositionRealizedPnl = (position: PolymarketPosition): number => {
  const asRecord = position as Record<string, unknown>;
  const directRealized = toFiniteNumberOrNull(position.realizedPnl);
  if (directRealized !== null) {
    return directRealized;
  }

  const fallbackRealized = getNumberFromKeys(asRecord, ["realizedPNL", "pnl", "profit", "profitLoss"]);
  if (fallbackRealized !== 0) {
    return fallbackRealized;
  }

  return getNumberFromKeys(asRecord, ["cashPnl"]);
};

const getOpenPositionPnl = (position: PolymarketPosition): number => {
  const asRecord = position as Record<string, unknown>;
  const totalPnl = getNumberFromKeys(asRecord, ["totalPnl", "totalPNL", "positionPnl", "netPnl"]);
  if (totalPnl !== 0) {
    return totalPnl;
  }

  return toNumber(position.cashPnl);
};

const getActivityType = (activityRow: PolymarketActivity): string => {
  const asRecord = activityRow as Record<string, unknown>;
  return getStringFromKeys(asRecord, ["type", "activityType", "eventType"]).toUpperCase();
};

const getActivityAmountUsd = (activityRow: PolymarketActivity, candidateKeys: string[]): number => {
  const asRecord = activityRow as Record<string, unknown>;
  for (const key of candidateKeys) {
    const value = toFiniteNumberOrNull(asRecord[key]);
    if (value !== null) {
      return Math.abs(value);
    }
  }
  return 0;
};

const getActivityFeePaid = (activityRow: PolymarketActivity): number => {
  const type = getActivityType(activityRow);
  const explicitFee = getActivityAmountUsd(activityRow, [
    "fee",
    "feeUsd",
    "feeUSDC",
    "feeAmount",
    "tradingFee",
    "trading_fee",
    "feesPaid",
    "fees"
  ]);
  if (explicitFee > 0) {
    return explicitFee;
  }
  if (type.includes("FEE")) {
    return getActivityAmountUsd(activityRow, ["usdcSize", "amount", "value", "sizeUsd"]);
  }
  return 0;
};

const getActivityMakerRebate = (activityRow: PolymarketActivity): number => {
  const type = getActivityType(activityRow);
  if (!type.includes("REBATE")) {
    return 0;
  }
  return getActivityAmountUsd(activityRow, [
    "rebate",
    "rebateUsd",
    "rebateUSDC",
    "makerRebate",
    "maker_reward",
    "usdcSize",
    "amount"
  ]);
};

const buildLatestMarketUrlByMarketTitle = (trades: PolymarketTrade[]): Map<string, string> => {
  const best = new Map<string, { ts: number; url: string }>();

  for (const trade of trades) {
    const marketTitle = getMarketTitle(trade);
    if (!marketTitle) {
      continue;
    }
    const tradeRecord = trade as unknown as Record<string, unknown>;
    const candidate = getPolymarketEventUrlFromRecord(tradeRecord);
    if (!candidate) {
      continue;
    }
    const ts = tryParseTimestampMs(trade.timestamp) ?? 0;
    const current = best.get(marketTitle);
    if (!current || ts >= current.ts) {
      best.set(marketTitle, { ts, url: candidate });
    }
  }

  return new Map(Array.from(best.entries()).map(([title, payload]) => [title, payload.url]));
};

const buildLatestTradeTimestampByMarket = (trades: PolymarketTrade[]): Map<string, number> => {
  const latestByMarket = new Map<string, number>();
  for (const trade of trades) {
    const marketTitle = getMarketTitle(trade);
    const ts = tryParseTimestampMs(trade.timestamp) ?? 0;
    if (ts <= 0) {
      continue;
    }
    latestByMarket.set(marketTitle, Math.max(latestByMarket.get(marketTitle) ?? 0, ts));
  }
  return latestByMarket;
};

const buildClosedPairRows = (closedPositions: PolymarketPosition[], trades: PolymarketTrade[]) => {
  const latestTradeByMarket = buildLatestTradeTimestampByMarket(trades);
  const marketUrlByTitle = buildLatestMarketUrlByMarketTitle(trades);
  const byMarket = new Map<string, ClosedPairAggregate>();

  for (const position of closedPositions) {
    const asRecord = position as Record<string, unknown>;
    const marketTitle =
      getStringFromKeys(asRecord, ["question", "title", "market", "marketTitle", "name"]) || "unknown-market";
    const outcomeRaw = getStringFromKeys(asRecord, ["outcome", "outcomeName", "token", "side", "position"]);
    const direction = canonicalDirection(outcomeRaw);
    if (direction !== "UP" && direction !== "DOWN") {
      continue;
    }

    const avgPrice =
      getNumberFromKeys(asRecord, ["avgPrice", "averagePrice", "entryPrice", "price", "avgEntryPrice"]) || 0;
    const unitsRaw = getNumberFromKeys(asRecord, ["size", "shares", "amount", "quantity", "positionSize", "tokens"]);
    const costRaw =
      getNumberFromKeys(asRecord, [
        "totalBought",
        "amountSpent",
        "spent",
        "costBasis",
        "notional",
        "initialValue",
        "buyValue"
      ]) || 0;
    const cost = costRaw > 0 ? costRaw : avgPrice > 0 && unitsRaw > 0 ? avgPrice * unitsRaw : 0;
    const units = unitsRaw > 0 ? unitsRaw : avgPrice > 0 && cost > 0 ? cost / avgPrice : 0;
    const pnl = getPositionRealizedPnl(position);
    const closedAtCandidate =
      tryParseTimestampMs(
        asRecord.closedAt ??
          asRecord.closed_at ??
          asRecord.updatedAt ??
          asRecord.updated_at ??
          asRecord.timestamp ??
          asRecord.createdAt ??
          asRecord.endDate
      ) ?? 0;
    const closedAtMs = Math.max(closedAtCandidate, latestTradeByMarket.get(marketTitle) ?? 0);
    const marketUrlFromPosition = getPolymarketEventUrlFromRecord(asRecord);
    const marketUrlFallback = marketUrlByTitle.get(marketTitle) ?? null;

    if (!byMarket.has(marketTitle)) {
      byMarket.set(marketTitle, {
        marketTitle,
        closedAtMs,
        marketUrl: marketUrlFromPosition ?? marketUrlFallback,
        legs: {
          UP: { units: 0, cost: 0, pnl: 0 },
          DOWN: { units: 0, cost: 0, pnl: 0 }
        }
      });
    }

    const aggregate = byMarket.get(marketTitle);
    if (!aggregate) {
      continue;
    }

    aggregate.closedAtMs = Math.max(aggregate.closedAtMs, closedAtMs);
    if (!aggregate.marketUrl && marketUrlFromPosition) {
      aggregate.marketUrl = marketUrlFromPosition;
    } else if (!aggregate.marketUrl && marketUrlFallback) {
      aggregate.marketUrl = marketUrlFallback;
    }
    aggregate.legs[direction].units += units;
    aggregate.legs[direction].cost += cost;
    aggregate.legs[direction].pnl += pnl;
  }

  return Array.from(byMarket.values())
    .map((pair) => {
      const up = pair.legs.UP;
      const down = pair.legs.DOWN;
      const upAvgPrice = up.units > 0 ? up.cost / up.units : null;
      const downAvgPrice = down.units > 0 ? down.cost / down.units : null;
      const edge =
        upAvgPrice !== null && downAvgPrice !== null ? 1 - (upAvgPrice + downAvgPrice) : null;
      const pairStatus: "Paired" | "Missing Leg" =
        up.units > 0 && down.units > 0 ? "Paired" : "Missing Leg";
      const netPnl = up.pnl + down.pnl;
      const result: "Won" | "Lost" | "Flat" = netPnl > 0 ? "Won" : netPnl < 0 ? "Lost" : "Flat";
      const totalCost = up.cost + down.cost;
      const coveragePct =
        up.units > 0 && down.units > 0 ? (Math.min(up.units, down.units) / Math.max(up.units, down.units)) * 100 : null;
      const pnlPct = totalCost > 0 ? (netPnl / totalCost) * 100 : null;
      const eventStartMs = parseMarketEventStartMs(pair.marketTitle, pair.closedAtMs);
      const auditFlags: string[] = [];
      if (pairStatus === "Missing Leg") {
        auditFlags.push("Missing leg");
      }
      if (upAvgPrice !== null && (upAvgPrice <= 0 || upAvgPrice >= 1)) {
        auditFlags.push("UP avg out of range");
      }
      if (downAvgPrice !== null && (downAvgPrice <= 0 || downAvgPrice >= 1)) {
        auditFlags.push("DOWN avg out of range");
      }
      if (coveragePct !== null && coveragePct < 95) {
        auditFlags.push("Leg size mismatch");
      }
      if (pnlPct !== null && Math.abs(pnlPct) > 150) {
        auditFlags.push("P/L outlier");
      }

      return {
        id: `${pair.marketTitle}:${pair.closedAtMs}`,
        closedAt: new Date(pair.closedAtMs > 0 ? pair.closedAtMs : Date.now()).toISOString(),
        eventTime: eventStartMs ? new Date(eventStartMs).toISOString() : null,
        marketTitle: pair.marketTitle,
        marketUrl: pair.marketUrl,
        pairStatus,
        result,
        upUnits: up.units,
        upAvgPrice,
        upCost: up.cost,
        upPnl: up.pnl,
        downUnits: down.units,
        downAvgPrice,
        downCost: down.cost,
        downPnl: down.pnl,
        edge,
        coveragePct,
        pnlPct,
        auditFlags,
        netPnl
      };
    })
    .sort((a, b) => {
      const aEvent = a.eventTime ? Date.parse(a.eventTime) : 0;
      const bEvent = b.eventTime ? Date.parse(b.eventTime) : 0;
      if (aEvent !== bEvent) {
        return bEvent - aEvent;
      }
      return Date.parse(b.closedAt) - Date.parse(a.closedAt);
    });
};

const buildPairExecutionStats = (trades: PolymarketTrade[]) => {
  const buyTrades = trades
    .map((trade) => normalizeTrade(trade))
    .filter((trade): trade is NormalizedTrade => Boolean(trade && trade.side === "BUY"))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const marketOutcomeMap = new Map<string, Map<string, OutcomeAggregate>>();

  for (const trade of buyTrades) {
    const marketGroupKey = trade.marketTitle;
    if (!marketOutcomeMap.has(marketGroupKey)) {
      marketOutcomeMap.set(marketGroupKey, new Map<string, OutcomeAggregate>());
    }
    const outcomes = marketOutcomeMap.get(marketGroupKey);
    if (!outcomes) {
      continue;
    }

    const directionKey = canonicalDirection(trade.outcomeKey);
    const current = outcomes.get(directionKey);
    if (!current) {
      outcomes.set(directionKey, {
        units: trade.payoutUnits,
        quoteCost: trade.payoutUnits * trade.price,
        firstTimestampMs: trade.timestampMs
      });
      continue;
    }

    current.units += trade.payoutUnits;
    current.quoteCost += trade.payoutUnits * trade.price;
    current.firstTimestampMs = Math.min(current.firstTimestampMs, trade.timestampMs);
  }

  let pairedMarkets = 0;
  let unpairedMarkets = 0;
  let activeMarkets = 0;
  let grossEdgeUsd = 0;
  const netEdgeUsd: number | null = null;
  let positiveEdgeMatches = 0;
  let totalComboCost = 0;
  const hedgeDelaysSec: number[] = [];

  for (const outcomes of marketOutcomeMap.values()) {
    const entries = Array.from(outcomes.entries()).filter(([, agg]) => agg.units > 1e-9);
    if (entries.length === 0) {
      continue;
    }

    activeMarkets += 1;

    if (entries.length < 2) {
      unpairedMarkets += 1;
      continue;
    }
    let firstEntry = entries.find(([key]) => key === "UP");
    let secondEntry = entries.find(([key]) => key === "DOWN");
    if (!firstEntry || !secondEntry) {
      const sorted = [...entries].sort((a, b) => (b[1]?.units ?? 0) - (a[1]?.units ?? 0));
      firstEntry = sorted[0];
      secondEntry = sorted[1];
    }

    if (!firstEntry || !secondEntry) {
      unpairedMarkets += 1;
      continue;
    }

    pairedMarkets += 1;
    const [, first] = firstEntry;
    const [, second] = secondEntry;
    if (!first || !second) {
      continue;
    }

    const firstAvgPrice = first.quoteCost / first.units;
    const secondAvgPrice = second.quoteCost / second.units;
    const comboCost = firstAvgPrice + secondAvgPrice;
    const edgePerPair = 1 - comboCost;
    grossEdgeUsd += edgePerPair;
    totalComboCost += comboCost;
    if (edgePerPair > 0) {
      positiveEdgeMatches += 1;
    }

    const delaySec = Math.abs(first.firstTimestampMs - second.firstTimestampMs) / 1000;
    hedgeDelaysSec.push(delaySec);
  }

  const completionRatePct = activeMarkets > 0 ? (pairedMarkets / activeMarkets) * 100 : 0;
  const avgComboCost = pairedMarkets > 0 ? totalComboCost / pairedMarkets : 0;
  const avgGrossEdgeCentsPerPair = pairedMarkets > 0 ? (grossEdgeUsd / pairedMarkets) * 100 : 0;
  const avgGrossEdgeBps = pairedMarkets > 0 ? (grossEdgeUsd / pairedMarkets) * 10_000 : 0;
  const positiveEdgeRatePct = pairedMarkets > 0 ? (positiveEdgeMatches / pairedMarkets) * 100 : 0;
  const sortedDelays = [...hedgeDelaysSec].sort((a, b) => a - b);
  const avgHedgeDelaySec = hedgeDelaysSec.length > 0 ? hedgeDelaysSec.reduce((a, b) => a + b, 0) / hedgeDelaysSec.length : 0;
  const p95HedgeDelaySec = percentile(sortedDelays, 95);

  return {
    pairedMarkets,
    unpairedMarkets,
    activeMarkets,
    completionRatePct,
    grossEdgeUsd,
    netEdgeUsd,
    avgComboCost,
    avgGrossEdgeCentsPerPair,
    avgGrossEdgeBps,
    positiveEdgeRatePct,
    avgHedgeDelaySec,
    p95HedgeDelaySec
  };
};

const buildPairExecutionFromClosedRows = (
  rows: Array<{
    pairStatus: "Paired" | "Missing Leg";
    upAvgPrice: number | null;
    downAvgPrice: number | null;
    edge: number | null;
  }>
) => {
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

export interface PolymarketSummaryDataSets {
  trades: PolymarketTrade[];
  closedPositions: PolymarketPosition[];
  openPositions: PolymarketPosition[];
  activity: PolymarketActivity[];
}

export interface PolymarketFetchModeOptions {
  mode?: "full" | "incremental";
  lastSuccessAt?: string | null;
  overlapHours?: number;
}

export const fetchPolymarketSummaryDataSets = async (
  wallet: string,
  options: PolymarketFetchModeOptions = {}
): Promise<PolymarketSummaryDataSets> => {
  const mode = options.mode ?? "full";
  void options.overlapHours;
  void options.lastSuccessAt;
  const maxPages = mode === "incremental" ? 200 : Number.POSITIVE_INFINITY;

  const [trades, closedPositions, openPositions, activity] = await Promise.all([
    fetchPaginated<PolymarketTrade>("/trades", wallet, {
      pageSize: 50,
      maxOffset: 100_000,
      maxPages,
      nonFatalStatuses: [400],
      queryParams: { takerOnly: false },
      dedupeKey: (row) => getTradeCanonicalKey(row as PolymarketTrade)
    }),
    fetchPaginated<PolymarketPosition>("/closed-positions", wallet, {
      pageSize: 50,
      maxOffset: 100_000,
      maxPages
    }),
    // Open positions are relatively small and represent current state, so always fetch full set.
    fetchPaginated<PolymarketPosition>("/positions", wallet, { pageSize: 50, maxOffset: 100_000 }),
    fetchPaginated<PolymarketActivity>("/activity", wallet, {
      pageSize: 50,
      maxOffset: 100_000,
      maxPages,
      nonFatalStatuses: [400, 404]
    })
  ]);

  return { trades, closedPositions, openPositions, activity };
};

export const buildPolymarketSummaryFromDataSets = (
  wallet: string,
  dataSets: PolymarketSummaryDataSets
): PolymarketSummary => {
  const { trades, closedPositions, openPositions, activity } = dataSets;

  const totalVolumeUsd = trades.reduce((total, trade) => total + toNumber(trade.price) * toNumber(trade.size), 0);
  const tradesWithFeeRate = trades.filter((trade) => toNumber(trade.fee_rate_bps) > 0);
  const feeDataCoveragePct = trades.length > 0 ? (tradesWithFeeRate.length / trades.length) * 100 : 0;
  const estimatedFeesPaid =
    tradesWithFeeRate.length > 0 ? tradesWithFeeRate.reduce((total, trade) => total + estimateTradeFee(trade), 0) : null;

  const makerRebates = activity.reduce((total, row) => total + getActivityMakerRebate(row), 0);
  const feesPaidFromActivity = activity.reduce((total, row) => total + getActivityFeePaid(row), 0);
  const appliedFeesPaid =
    feesPaidFromActivity > 0 ? feesPaidFromActivity : estimatedFeesPaid !== null ? estimatedFeesPaid : 0;

  const realizedPnl = closedPositions.reduce((total, row) => total + getPositionRealizedPnl(row), 0);
  const openPnl = openPositions.reduce((total, row) => total + getOpenPositionPnl(row), 0);
  const netPnl = realizedPnl + openPnl - appliedFeesPaid + makerRebates;

  const wins = closedPositions.filter((row) => getPositionRealizedPnl(row) > 0).length;
  const losses = closedPositions.filter((row) => getPositionRealizedPnl(row) < 0).length;
  const breakeven = Math.max(closedPositions.length - wins - losses, 0);
  const decisions = wins + losses;
  const winRate = decisions > 0 ? (wins / decisions) * 100 : 0;
  const closedPairRows = buildClosedPairRows(closedPositions, trades);
  const pairExecution = buildPairExecutionFromClosedRows(closedPairRows);
  const tradeRows = trades
    .map((trade, index) => {
      const price = toNumber(trade.price);
      const size = toNumber(trade.size);
      const timestampMs = toTimestampMs(trade.timestamp);
      return {
        id: trade.id ?? `${trade.transactionHash ?? "tx"}:${timestampMs}:${index}`,
        timestamp: new Date(timestampMs).toISOString(),
        marketTitle: getMarketTitle(trade),
        marketKey: getMarketKey(trade),
        outcome: String(trade.outcome ?? trade.asset ?? trade.outcomeIndex ?? "unknown"),
        side: String(trade.side ?? "unknown").toUpperCase(),
        price,
        size,
        notionalUsd: price * size,
        txHash: String(trade.transactionHash ?? "")
      };
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  return {
    wallet,
    asOf: new Date().toISOString(),
    totalTrades: trades.length,
    totalVolumeUsd,
    estimatedFeesPaid: appliedFeesPaid > 0 ? appliedFeesPaid : estimatedFeesPaid,
    makerRebates,
    netEstimatedFees: appliedFeesPaid > 0 ? appliedFeesPaid - makerRebates : estimatedFeesPaid === null ? null : estimatedFeesPaid - makerRebates,
    feeDataCoveragePct,
    realizedPnl,
    openPnl,
    netPnl,
    wins,
    losses,
    breakeven,
    winRate,
    pairExecution,
    tradeRows,
    closedPairRows,
    records: {
      trades: trades.length,
      closedPositions: closedPositions.length,
      openPositions: openPositions.length,
      activity: activity.length
    }
  };
};

export const getPolymarketSummary = async (wallet: string): Promise<PolymarketSummary> => {
  const dataSets = await fetchPolymarketSummaryDataSets(wallet, { mode: "full" });
  return buildPolymarketSummaryFromDataSets(wallet, dataSets);
};
