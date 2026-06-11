"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plus, Lightbulb, Inbox } from "lucide-react";
import MarketCard, { type MarketData } from "../components/MarketCard";
import FeaturedMarket from "../components/FeaturedMarket";
import CategoryTabs, { type FilterCategory, type FilterStatus } from "../components/CategoryTabs";
import HotTopics from "../components/HotTopics";
import CreateMarketModal from "../components/CreateMarketModal";
import { useAccount } from "wagmi";

const ADMIN_ADDRESS = (process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? "").toLowerCase();

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="h-4 w-24 rounded-full bg-surface-4 animate-pulse" />
        <div className="h-4 w-full rounded bg-surface-4 animate-pulse" />
        <div className="h-4 w-3/4 rounded bg-surface-4 animate-pulse" />
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="h-12 rounded-xl bg-surface-4 animate-pulse" />
          <div className="h-12 rounded-xl bg-surface-4 animate-pulse" />
        </div>
      </div>
      <div className="h-px bg-border" />
      <div className="px-4 py-3"><div className="h-3 w-20 rounded bg-surface-4 animate-pulse" /></div>
    </div>
  );
}

/**
 * The Postgres `markets` table is the canonical catalog. We fetch from
 * `/api/markets` and map the DB rows into the `MarketData` shape that the
 * existing MarketCard / FeaturedMarket / HotTopics components expect.
 *
 * Arc contracts come into play only at resolution time (relayer pushes
 * verdicts on-chain when a market has an `arcAddress`).
 */

interface DBMarket {
  id: string;
  title: string;
  category: string;
  expiry: string;
  status: string;
  yesPool: string;
  noPool: string;
  lmsrB: string | null;
  usdcVolume: string;
  isFeatured: boolean;
  arcAddress: string | null;
  settlement?: { resolution: string | null } | null;
}

/**
 * Compute the LMSR YES price in basis-points (0–10000).
 * Formula: p(YES) = exp(qYes/b) / (exp(qYes/b) + exp(qNo/b))
 * Falls back to pool-ratio when b is absent (pre-LMSR markets).
 */
function lmsrProbBps(qYes: number, qNo: number, b: number | null): bigint {
  if (b && b > 0) {
    const eY = Math.exp(qYes / b);
    const eN = Math.exp(qNo  / b);
    const p  = eY / (eY + eN);
    return BigInt(Math.round(p * 10_000));
  }
  // Fallback: simple pool ratio
  const total = qYes + qNo;
  if (total === 0) return 5000n;
  return BigInt(Math.round((qYes / total) * 10_000));
}

function dbToMarketData(m: DBMarket): MarketData {
  const qYes  = parseFloat(m.yesPool);
  const qNo   = parseFloat(m.noPool);
  const b     = m.lmsrB ? parseFloat(m.lmsrB) : null;

  // Keep yesPool/noPool as share counts (micros) for display purposes
  const yesPool = BigInt(Math.round(qYes * 1_000_000));
  const noPool  = BigInt(Math.round(qNo  * 1_000_000));

  return {
    address:    m.arcAddress ?? m.id,
    question:   m.title,
    category:   m.category,
    endDate:    BigInt(Math.floor(new Date(m.expiry).getTime() / 1000)),
    yesPool,
    noPool,
    usdcVolume: parseFloat(m.usdcVolume) || 0,
    isFeatured: m.isFeatured,
    resolved:   m.status === "resolved",
    outcome:    m.settlement?.resolution === "YES",
    yesProbBps: lmsrProbBps(qYes, qNo, b),
  };
}

export default function HomePage() {
  const t = useTranslations("home");
  const { address, isConnected } = useAccount();
  const isAdmin = isConnected && !!address && address.toLowerCase() === ADMIN_ADDRESS;

  const [showCreate,    setShowCreate]    = useState(false);
  const [filterCat,     setFilterCat]     = useState<FilterCategory>("all");
  const [filterStatus,  setFilterStatus]  = useState<FilterStatus>("all");

  const { data: markets = [], isLoading } = useQuery({
    queryKey: ["markets", filterCat, filterStatus],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterCat    !== "all") params.set("category", filterCat);
      if (filterStatus === "open")     params.set("status", "active");
      if (filterStatus === "resolved") params.set("status", "resolved");
      params.set("limit", "100");
      const res = await fetch(`/api/markets?${params}`);
      if (!res.ok) return [];
      const body = await res.json();
      return (body.markets as DBMarket[]).map(dbToMarketData);
    },
    refetchInterval: 15_000,
  });

  const filtered = markets;

  // The featured banner only renders for the unfiltered "All / not resolved"
  // view. Picking a featured candidate when we're in a category-filtered view
  // and then quietly excluding it from the grid is what made "2 markets" only
  // render one card. So compute `featured` only when it's actually going to
  // be shown.
  const showFeatured = filterCat === "all" && filterStatus !== "resolved";

  const featured = showFeatured
    ? (markets.find((m) => m.isFeatured && !m.resolved) ??
       [...markets]
         .filter((m) => !m.resolved)
         .sort((a, b) => Number(b.yesPool + b.noPool) - Number(a.yesPool + a.noPool))[0])
    : undefined;

  const gridMarkets = featured
    ? filtered.filter((m) => m.address !== featured.address)
    : filtered;

  return (
    <>
      <CategoryTabs
        activeCategory={filterCat}
        activeStatus={filterStatus}
        onCategoryChange={setFilterCat}
        onStatusChange={setFilterStatus}
      />

      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <div className="flex gap-6">
          {/* Main */}
          <div className="flex-1 min-w-0 space-y-6">
            {!isLoading && featured && (
              <FeaturedMarket market={featured} />
            )}

            {/* Header row — always visible so the Suggest/Create button is
                reachable. The label adapts to whether there are markets in
                the grid (featured is shown separately above). */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300">
                {isLoading
                  ? t("loading")
                  : filtered.length === 0
                    ? t("noMarkets")
                    : `${filtered.length} ${filtered.length !== 1 ? t("markets_plural") : t("markets")}`}
              </h2>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-dark transition-all shadow-lg shadow-brand/20"
              >
                {isAdmin ? <Plus size={14} /> : <Lightbulb size={14} />}
                {isAdmin ? t("newMarket") : t("suggestMarket")}
              </button>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : gridMarkets.length === 0 && !featured ? (
              <div className="rounded-2xl border border-border bg-surface-1 p-16 text-center">
                <Inbox size={32} className="mx-auto mb-3 text-slate-500" />
                <p className="text-slate-400 text-sm mb-4">{t("noMarkets")}</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark transition-colors"
                >
                  {isAdmin ? t("createFirst") : t("suggestMarket")}
                </button>
              </div>
            ) : gridMarkets.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {gridMarkets.map((m) => <MarketCard key={m.address} {...m} />)}
              </div>
            ) : null}
          </div>

          {/* Sidebar */}
          <aside className="hidden xl:block w-72 shrink-0">
            <HotTopics markets={markets} />
          </aside>
        </div>
      </div>

      {showCreate && <CreateMarketModal onClose={() => setShowCreate(false)} />}
    </>
  );
}
