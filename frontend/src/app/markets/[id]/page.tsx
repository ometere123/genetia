"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import TradingPanel, { type MarketInfo } from "../../../components/TradingPanel";
import { timeUntil, shortAddr } from "../../../lib/format";
import {
  getComplianceDisclosure,
  getMarketPolicy,
  getMarketRestrictions,
} from "../../../lib/market-policy";
import { ChevronLeft, ExternalLink, Zap, Clock, Loader2 } from "lucide-react";
import clsx from "clsx";

type ChartRange = "1H" | "6H" | "1D" | "1W" | "ALL";
const ARC_EXPLORER_URL = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app";

interface HistoryPoint {
  t: string;
  yesPct: number;
  yesPool: string;
  noPool: string;
}

/**
 * Real probability history chart — fetches event-sourced points from
 * /api/markets/[id]/history and renders them as a step-style SVG line.
 * Each bet on the market becomes a point; the line is flat between bets.
 */
function ProbChart({
  marketId,
  range,
  currentYesPct,
}: {
  marketId: string;
  range: ChartRange;
  currentYesPct: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["market-history", marketId, range],
    queryFn: async () => {
      const res = await fetch(
        `/api/markets/${encodeURIComponent(marketId)}/history?range=${range}`
      );
      if (!res.ok) return { points: [] as HistoryPoint[], betCount: 0 };
      return (await res.json()) as { points: HistoryPoint[]; betCount: number };
    },
    refetchInterval: 20_000,
  });

  const w = 600;
  const h = 140;
  const points = data?.points ?? [];
  const betCount = data?.betCount ?? 0;

  if (isLoading && points.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-slate-500 text-xs gap-2">
        <Loader2 size={12} className="animate-spin" /> Loading history…
      </div>
    );
  }

  // No bets yet — show a flat line at the seed probability with a hint.
  if (betCount === 0) {
    const y = h - (currentYesPct / 100) * h;
    return (
      <div className="relative w-full h-full">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
          <path
            d={`M0,${y} L${w},${y}`}
            stroke="rgb(100 116 139)"
            strokeWidth="1.5"
            strokeDasharray="6 4"
            fill="none"
          />
        </svg>
        <p className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500 pointer-events-none">
          History begins after the first trade
        </p>
      </div>
    );
  }

  // Map points → SVG coords. X axis is time, Y axis is probability (0..100).
  const tMin = new Date(points[0].t).getTime();
  const tMax = new Date(points[points.length - 1].t).getTime();
  const tSpan = Math.max(1, tMax - tMin);

  const xy = points.map((p) => ({
    x: ((new Date(p.t).getTime() - tMin) / tSpan) * w,
    y: h - (p.yesPct / 100) * h,
    yesPct: p.yesPct,
  }));

  // Step-style path — flat between bets, vertical jump at each bet — so the
  // chart reads "the probability stayed at X% until this trade flipped it".
  const path = xy.reduce((acc, pt, i) => {
    if (i === 0) return `M${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    const prev = xy[i - 1];
    return `${acc} L${pt.x.toFixed(1)},${prev.y.toFixed(1)} L${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  }, "");

  const lastY = xy[xy.length - 1].y;
  const fillPath = `${path} L${w},${lastY} L${w},${h} L0,${h} Z`;

  const first = xy[0].yesPct;
  const last = xy[xy.length - 1].yesPct;
  const color = last >= first ? "#22c55e" : "#ef4444";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0"   />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#chartFill)" />
      <path d={path} stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Detect if the ID is an Arc contract address (0x...) or a DB CUID
function isAddress(id: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(id);
}

interface DbMarket {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  expiry: string;
  createdBy?: string | null;
  arcAddress?: string | null;
  yesPool: string;
  noPool: string;
  /** LMSR liquidity parameter (decimal USDC string). Null on legacy markets. */
  lmsrB?: string | null;
  lmsrStatus?: string | null;
  proposedOutcome?: string | null;
  pendingSince?: string | null;
  lmsrCollateral?: string | null;
  lmsrFees?: string | null;
  resolutionCriteria?: string | null;
  resolutionSource?: string | null;
  settlement?: { resolution: string; reasoning?: string; confidence?: number } | null;
  _count?: { arcTrades: number };
}

function extractEvidenceUrls(source?: string | null): string[] {
  if (!source) return [];
  const filter = (xs: unknown[]) =>
    xs
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => /^https?:\/\//i.test(x))
      .slice(0, 5);
  const trimmed = source.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return filter(parsed);
    } catch {
      // Fall through to line/comma split.
    }
  }
  return filter(trimmed.split(/[\n,]+/));
}

function challengeStatus(market: DbMarket): string {
  if (market.lmsrStatus === "Pending" && market.pendingSince) {
    const end = new Date(market.pendingSince).getTime() + 24 * 60 * 60 * 1000;
    const remainingMs = end - Date.now();
    if (remainingMs <= 0) return "Challenge window elapsed; finalisation is available.";
    const hours = Math.ceil(remainingMs / (60 * 60 * 1000));
    return `${hours}h remaining in the challenge window.`;
  }
  if (market.lmsrStatus === "Disputed") {
    return "Challenged; MVP admin adjudication is required.";
  }
  if (market.lmsrStatus === "Finalized") {
    return "Finalised on Arc; redemption is available for eligible outcome tokens.";
  }
  return "Starts after GenLayer proposes a verdict post-expiry.";
}

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const [chartRange, setChartRange] = useState<ChartRange>("1D");

  // ── Fetch from internal DB ────────────────────────────────────────────────
  // The endpoint accepts either a DB cuid or an Arc address in the slug —
  // approved suggestions live in both places, so we always try the DB first.
  // Only fall back to a pure on-chain read if the DB has no record at all.
  const { data: dbData, isLoading: dbLoading } = useQuery({
    queryKey: ["market-db", id],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${id}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.market as DbMarket | null;
    },
    refetchInterval: 15_000,
  });

  // LMSR markets don't expose a `marketInfo()` view — that was a parimutuel-
  // only helper. We rely on the indexer to mirror qYes/qNo/lmsrStatus into
  // the DB, so the page reads from `dbData` only. No on-chain RPC fan-out
  // per page load → no "execution reverted" noise in DevTools.
  const arcAddress = dbData?.arcAddress ?? (isAddress(id) ? id : null);

  const loading = dbLoading && !isAddress(id);

  // ── Merge DB + on-chain data ──────────────────────────────────────────────

  // If accessed by contract address directly (legacy), synthesise a market from on-chain data
  let market: (DbMarket & { yesPct: number; noPct: number; resolved: boolean }) | null = null;

  if (dbData) {
    // For LMSR markets, probability comes from Hanson's softmax over qYes/qNo
    // with liquidity parameter b. The on-chain Market contract is the source
    // of truth; the indexer mirrors qYes/qNo into `yesPool`/`noPool` so we
    // can compute the same value in-browser without an RPC fan-out.
    const yesPool = parseFloat(dbData.yesPool);
    const noPool  = parseFloat(dbData.noPool);
    const lmsrB   = dbData.lmsrB ? parseFloat(dbData.lmsrB) : null;

    let yesPct: number;
    if (lmsrB && lmsrB > 0) {
      // LMSR: p(Y) = exp(qY/b) / (exp(qY/b) + exp(qN/b))
      const eY = Math.exp(yesPool / lmsrB);
      const eN = Math.exp(noPool / lmsrB);
      yesPct = (eY / (eY + eN)) * 100;
    } else {
      // Legacy parimutuel fallback (markets pre-LMSR).
      const total = yesPool + noPool;
      yesPct = total > 0 ? (yesPool / total) * 100 : 50;
    }
    const resolved =
      dbData.status === "resolved" ||
      dbData.lmsrStatus === "Finalized" ||
      false;

    market = {
      ...dbData,
      yesPool: yesPool.toString(),
      noPool:  noPool.toString(),
      yesPct,
      noPct: 100 - yesPct,
      resolved,
      settlement: dbData.settlement ?? null,
    };
  }
  // Legacy "visit by Arc address with no DB row" path removed — admin
  // approval always seeds a DB row before the market is reachable. If we
  // ever need it back, it can be a single API call to a public LMSR-aware
  // read endpoint rather than a per-page wagmi useReadContract.

  // ── Build MarketInfo for TradingPanel ─────────────────────────────────────
  const marketInfo: MarketInfo | null = market
    ? {
        id:         market.id,
        title:      market.title,
        status:     market.status,
        yesPool:    market.yesPool,
        noPool:     market.noPool,
        lmsrB:      market.lmsrB ?? null,
        lmsrStatus: market.lmsrStatus ?? null,
        proposedOutcome: market.proposedOutcome ?? null,
        pendingSince: market.pendingSince ?? null,
        settlement: market.settlement ?? null,
      }
    : null;

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading || !market) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <div className="h-5 w-32 rounded bg-surface-3 animate-pulse mb-6" />
        <div className="flex gap-6">
          <div className="flex-1 space-y-4">
            <div className="h-40 rounded-2xl bg-surface-1 animate-pulse" />
            <div className="h-48 rounded-2xl bg-surface-1 animate-pulse" />
          </div>
          <div className="w-80 h-96 rounded-2xl bg-surface-1 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8 text-center text-slate-500">
        Market not found.
        <Link href="/" className="block mt-4 text-brand-light hover:text-white">← Back to markets</Link>
      </div>
    );
  }

  const { yesPct, noPct, resolved } = market;
  const total = parseFloat(market.yesPool) + parseFloat(market.noPool);
  const collateral = market.lmsrCollateral ? parseFloat(market.lmsrCollateral) : null;
  const isLive = !resolved && new Date(market.expiry) > new Date();
  const policy = getMarketPolicy(market);
  const restrictions = getMarketRestrictions(market);
  const disclosures = getComplianceDisclosure(market);
  const evidenceUrls = extractEvidenceUrls(market.resolutionSource);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 mb-5 transition-colors">
        <ChevronLeft size={14} /> All markets
      </Link>

      <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
        {/* Left column */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Header */}
          <div className="rounded-2xl border border-border bg-surface-1 p-6">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="rounded-full bg-surface-3 px-2.5 py-1 text-[11px] font-medium text-slate-400 capitalize">
                {market.category}
              </span>
              {resolved && market.settlement ? (
                <span className={clsx(
                  "rounded-full px-2.5 py-1 text-[11px] font-bold",
                  market.settlement.resolution === "YES" ? "bg-yes/15 text-yes" : "bg-no/15 text-no"
                )}>
                  Resolved {market.settlement.resolution}
                </span>
              ) : (
                <>
                  {isLive && (
                    <span className="flex items-center gap-1 text-[11px] text-yes font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-yes live-dot" /> LIVE
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock size={10} /> {timeUntil(BigInt(Math.floor(new Date(market.expiry).getTime() / 1000)))}
                  </span>
                </>
              )}
            </div>

            <h1 className="text-2xl font-bold text-white leading-snug mb-5">{market.title}</h1>

            {market.description && (
              <p className="text-sm text-slate-400 mb-5 leading-relaxed">{market.description}</p>
            )}

            <div className="flex gap-3 mb-4 flex-wrap">
              {[
                { label: "Yes", pct: yesPct,  active: resolved && market.settlement?.resolution === "YES", activeColor: "border-yes/40 bg-yes/10", textColor: "text-yes" },
                { label: "No",  pct: noPct,   active: resolved && market.settlement?.resolution === "NO",  activeColor: "border-no/40 bg-no/10",   textColor: "text-no"  },
              ].map(({ label, pct, active, activeColor, textColor }) => (
                <div key={label} className={clsx(
                  "flex items-center gap-3 rounded-xl border px-5 py-3",
                  active ? activeColor : "border-border bg-surface-2"
                )}>
                  <div>
                    <p className="text-[11px] text-slate-400 mb-0.5">{label}</p>
                    <p className={clsx("text-3xl font-bold leading-none", textColor)}>
                      {pct.toFixed(1)}%
                    </p>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-5 py-3">
                <div>
                  <p className="text-[11px] text-slate-400 mb-0.5">Shares outstanding</p>
                  <p className="text-xl font-bold text-white leading-none">
                    {total.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    shares outstanding · $1 face value each
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-5 py-3">
                <div>
                  <p className="text-[11px] text-slate-400 mb-0.5">Collateral</p>
                  <p className="text-xl font-bold text-white leading-none">
                    {collateral == null
                      ? "Indexing"
                      : `$${collateral.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{policy.settlementAsset}</p>
                </div>
              </div>
              {market._count && (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-5 py-3">
                  <div>
                    <p className="text-[11px] text-slate-400 mb-0.5">Trades</p>
                    <p className="text-xl font-bold text-white leading-none">{market._count.arcTrades}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="h-2.5 rounded-full bg-surface-4 overflow-hidden">
              <div
                className="h-full rounded-full prob-bar-yes transition-all duration-700"
                style={{ width: `${yesPct}%` }}
              />
            </div>
          </div>

          {/* Chart */}
          <div className="rounded-2xl border border-border bg-surface-1 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Probability history</h3>
              <div className="flex gap-1">
                {(["1H", "6H", "1D", "1W", "ALL"] as ChartRange[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setChartRange(t)}
                    className={clsx(
                      "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors",
                      chartRange === t
                        ? "bg-surface-3 text-white"
                        : "text-slate-500 hover:text-slate-300"
                    )}
                  >{t}</button>
                ))}
              </div>
            </div>
            <div className="h-36">
              <ProbChart marketId={market.id} range={chartRange} currentYesPct={yesPct} />
            </div>
            <div className="flex items-center gap-4 mt-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-yes" /> Yes {yesPct.toFixed(1)}%
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-no" /> No {noPct.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* GenLayer settlement info */}
          {resolved && market.settlement?.reasoning && (
            <div className="rounded-2xl border border-border bg-surface-1 p-5">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Zap size={14} className="text-brand-light" />
                GenLayer Resolution Reasoning
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">{market.settlement.reasoning}</p>
              {market.settlement.confidence != null && (
                <p className="text-xs text-slate-500 mt-2">
                  Confidence: {(market.settlement.confidence * 100).toFixed(0)}%
                </p>
              )}
            </div>
          )}

          {/* Resolution info */}
          <div className="rounded-2xl border border-border bg-surface-1 p-5">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Zap size={14} className="text-brand-light" />
              Resolution
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                { label: "Resolver",   value: "GenLayer Intelligent Contract" },
                { label: "Bridge",     value: "Trusted relayer/app pipeline"  },
                { label: "Custody",    value: "Circle Smart Wallets"          },
                { label: "Settlement", value: "Arc settlement layer"           },
                { label: "Asset",      value: policy.settlementAsset          },
                { label: "Fee",        value: "2% on entry"                   },
                { label: "Model",      value: "LMSR market maker"             },
                { label: "Status",     value: market.lmsrStatus ?? market.status },
                { label: "Challenge",  value: challengeStatus(market)         },
                { label: "Evidence",   value: evidenceUrls.length > 0 ? `${evidenceUrls.length} source URL(s)` : "Not configured" },
                { label: "Redemption", value: resolved ? "Available after token balance check" : "Available after finalisation" },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-surface-2 border border-border px-3 py-2.5">
                  <p className="text-slate-500 mb-0.5">{label}</p>
                  <p className="text-slate-200 font-medium">{value}</p>
                </div>
              ))}
            </div>

            {arcAddress && (
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-slate-500">Arc contract</span>
                <a
                  href={`${ARC_EXPLORER_URL}/address/${arcAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-brand-light hover:text-brand transition-colors font-mono"
                >
                  {shortAddr(arcAddress as `0x${string}`)}
                  <ExternalLink size={11} />
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Right column — trading panel */}
        <aside className="w-full lg:w-80 lg:shrink-0">
          {marketInfo && <TradingPanel market={marketInfo} />}
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-border bg-surface-1 p-5">
              <h3 className="text-sm font-semibold text-white mb-3">How resolution works</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                GenLayer analyses evidence and produces a verdict. A trusted relayer submits that
                verdict to the Arc market contract. The market then enters a challenge window. If
                unchallenged, it can be finalised and users can redeem winning outcome tokens. In
                this MVP, challenged markets are handled by admin adjudication. Future versions can
                replace this with multisig or governance.
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-surface-1 p-5">
              <h3 className="text-sm font-semibold text-white mb-3">Trust assumptions</h3>
              <div className="space-y-2 text-xs text-slate-300">
                {disclosures.map((item) => (
                  <p key={item}>{item}</p>
                ))}
                <p>Dispute multisig is not implemented yet.</p>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface-1 p-5">
              <h3 className="text-sm font-semibold text-white mb-3">Market policy</h3>
              <div className="space-y-2 text-xs">
                {restrictions.map((item) => (
                  <div key={item} className="rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-slate-300">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
