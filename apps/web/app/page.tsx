"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GenetiaClient, type Market, type MarketPage } from "@genetia/sdk";
import { Icon } from "./site-header";

const categories = ["all", "crypto", "politics", "sports", "science", "entertainment"];
type StatusFilter = "ALL" | "ACTIVE" | "RESOLVED";

const marketClient = new GenetiaClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "",
});

function formatUsdc(raw?: string) {
  if (!raw || !/^\d+$/.test(raw)) return "—";
  const amount = BigInt(raw);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `$${whole.toLocaleString("en-US")}.${fraction}`;
}

function yesProbability(market: Market) {
  const yes = BigInt(market.engine === "POOL" ? market.pool?.yesTotal ?? "0" : market.lmsr?.yesPrice ?? "0");
  const no = BigInt(market.engine === "POOL" ? market.pool?.noTotal ?? "0" : market.lmsr?.noPrice ?? "0");
  if (yes + no === 0n) return null;
  return Number((yes * 10_000n) / (yes + no)) / 100;
}

function marketVolume(market: Market) {
  const raw = market.engine === "POOL"
    ? BigInt(market.pool?.yesTotal ?? "0") + BigInt(market.pool?.noTotal ?? "0")
    : BigInt(market.lmsr?.funded ?? "0");
  return raw;
}

function closeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function MarketCard({ market }: { market: Market }) {
  const yes = yesProbability(market);
  const no = yes === null ? null : 100 - yes;
  const resolved = market.status === "RESOLVED";
  const live = !resolved && new Date(market.closeTime).getTime() > Date.now();
  const remaining = Math.max(0, new Date(market.closeTime).getTime() - Date.now());
  const timeLabel = remaining <= 0 ? "Ended" : remaining >= 86_400_000
    ? `${Math.floor(remaining / 86_400_000)}d left`
    : remaining >= 3_600_000 ? `${Math.floor(remaining / 3_600_000)}h left` : `${Math.max(1, Math.floor(remaining / 60_000))}m left`;
  const volume = marketVolume(market);

  return (
    <Link href={`/markets/${encodeURIComponent(market.marketId)}`} className="market-card group block overflow-hidden rounded-2xl border border-border bg-surface-1">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-muted px-2.5 py-1 text-[11px] font-medium capitalize text-brand-light"><Icon name={market.category.toLowerCase()} className="h-[11px] w-[11px]" />{market.category}</span>
          <span className="flex items-center gap-1.5">
            {live && <span className="flex items-center gap-1 text-[11px] font-medium text-yes"><span className="live-dot h-1.5 w-1.5 rounded-full bg-yes" />Live</span>}
            {resolved ? <span className="rounded-full bg-brand-muted px-2 py-0.5 text-[11px] font-semibold text-brand-light">Resolved</span> : <span className="text-[11px] text-slate-500">{timeLabel}</span>}
          </span>
      </div>
      <div className="px-4 pb-3">
        <h3 className="line-clamp-2 min-h-10 text-sm font-medium leading-snug text-slate-100 transition-colors group-hover:text-white">{market.question}</h3>
      </div>
      <div className="px-4 pb-3">
        <div className="flex gap-2">
          <div className="flex flex-1 items-center justify-between rounded-xl border border-border bg-surface-3 px-3 py-2.5 transition-colors group-hover:border-yes/30"><span className="text-xs font-medium text-slate-400">YES</span><span className="text-base font-bold text-yes">{yes === null ? "—" : `${yes.toFixed(0)}%`}</span></div>
          <div className="flex flex-1 items-center justify-between rounded-xl border border-border bg-surface-3 px-3 py-2.5 transition-colors group-hover:border-no/30"><span className="text-xs font-medium text-slate-400">NO</span><span className="text-base font-bold text-no">{no === null ? "—" : `${no.toFixed(0)}%`}</span></div>
        </div>
      </div>
      <div className="px-4 pb-1"><div className="h-1 overflow-hidden rounded-full bg-surface-4"><div className="prob-bar-yes h-full rounded-full transition-all duration-500" style={{ width: `${yes ?? 50}%` }} /></div></div>
      <div className="mt-2 flex items-center justify-between border-t border-border px-4 py-3">
        <span className="text-[11px] text-slate-500">{formatUsdc(volume.toString())} volume</span>
        <span className="text-[11px] font-medium text-slate-600 transition-colors group-hover:text-slate-300">Trade →</span>
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return <div className="overflow-hidden rounded-2xl border border-border bg-surface-1 p-5" aria-hidden="true">
    <div className="h-5 w-24 animate-pulse rounded-full bg-surface-3" />
    <div className="mt-5 h-5 w-full animate-pulse rounded bg-surface-3" />
    <div className="mt-2 h-5 w-3/4 animate-pulse rounded bg-surface-3" />
    <div className="mt-8 h-2 animate-pulse rounded bg-surface-3" />
    <div className="mt-7 h-4 w-2/3 animate-pulse rounded bg-surface-3" />
  </div>;
}

export default function Home() {
  const [category, setCategory] = useState("all");
  const [engine, setEngine] = useState<"all" | "POOL" | "LMSR">("all");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<MarketPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSearch(new URLSearchParams(window.location.search).get("q") ?? "");
    const onSearch = (event: Event) => setSearch((event as CustomEvent<{ query: string }>).detail.query);
    window.addEventListener("genetia:search", onSearch);
    return () => window.removeEventListener("genetia:search", onSearch);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    marketClient.markets({
      category: category === "all" ? undefined : category,
      engine: engine === "all" ? undefined : engine,
      status: status === "ALL" ? undefined : status,
      limit: 48,
    }).then((result) => {
      if (!cancelled) setPage(result);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load indexed markets.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [category, engine, status]);

  const markets = useMemo(() => (page?.items ?? []).filter((market) =>
    `${market.title} ${market.question} ${market.category}`.toLowerCase().includes(search.trim().toLowerCase()),
  ), [page, search]);
  const featured = status !== "RESOLVED" && category === "all" && engine === "all" && !search.trim()
    ? [...markets].sort((a, b) => (marketVolume(a) > marketVolume(b) ? -1 : marketVolume(a) < marketVolume(b) ? 1 : 0))[0]
    : undefined;
  const listedMarkets = featured ? markets.filter((market) => market.marketId !== featured.marketId) : markets;

  return <>
    <section aria-label="Market filters" className="sticky top-[70px] z-30 border-b border-border bg-surface-0">
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6">
        <div className="mr-3 flex shrink-0 items-center gap-0.5">
          {([{ id: "ALL", label: "All", icon: "trend" }, { id: "ACTIVE", label: "Open", icon: "bolt" }, { id: "RESOLVED", label: "Resolved", icon: "sparkle" }] as const).map((item) => <button key={item.id} type="button" aria-pressed={status === item.id} onClick={() => setStatus(item.id)} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${status === item.id ? "bg-surface-3 text-white" : "text-slate-500 hover:bg-surface-2 hover:text-slate-300"}`}><Icon name={item.icon} className="h-3 w-3" />{item.label}</button>)}
        </div>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        {categories.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${category === item ? "bg-surface-3 text-white" : "text-slate-500 hover:bg-surface-2 hover:text-slate-300"}`}><Icon name={item === "all" ? "grid" : item} className="h-3 w-3" />{item === "all" ? "All" : item}</button>)}
      </div>
    </section>
    <main className="flex-1 bg-surface-0 text-slate-100">
      <section className="px-4 py-8 sm:px-6">
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(300px,22.5vw)]">
          <div className="min-w-0">
            {featured && <FeaturedMarketCard market={featured} />}
            <div className="mb-6 flex items-center justify-between gap-4">
              <h1 className="text-sm font-semibold text-slate-300">{loading ? "Loading markets…" : error ? "Market feed unavailable." : markets.length === 0 ? "No markets found." : `${markets.length} ${markets.length === 1 ? "market" : "markets"}`}</h1>
              <Link href="/create" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-dark"><span aria-hidden="true">＋</span> Create Market</Link>
            </div>
            {error && <div role="status" className="mb-3 text-xs text-slate-500">Live market data is temporarily unavailable.</div>}
            {loading && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <SkeletonCard key={index} />)}</div>}
            {!loading && markets.length === 0 && <div className="flex min-h-[368px] flex-col items-center justify-center rounded-2xl border border-border bg-surface-1 px-6 py-12 text-center"><Icon name="inbox" className="h-10 w-10 text-slate-500" /><p className="mt-5 text-base text-slate-400">{error ? "Market feed unavailable." : "No markets found."}</p>{error ? <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-surface-3 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-surface-4">Retry</button> : <Link href="/create" className="mt-6 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark">Create Market</Link>}</div>}
            {!loading && !error && markets.length > 0 && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{listedMarkets.map((market) => <MarketCard key={market.marketId} market={market} />)}</div>}
          </div>
          <aside className="rounded-2xl border border-brand/25 bg-brand/5 p-5"><h2 className="text-sm font-semibold text-brand-light">GenLayer-Resolved Markets</h2><p id="how-it-works" className="mt-2 text-sm leading-6 text-slate-500">GenLayer validators fetch live data and reach consensus to resolve markets.</p></aside>
        </div>
      </section>
    </main>
  </>;
}

function FeaturedMarketCard({ market }: { market: Market }) {
  const probability = yesProbability(market);
  return <Link href={`/markets/${encodeURIComponent(market.marketId)}`} className="group mb-6 block overflow-hidden rounded-3xl border border-brand/25 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.18),transparent_55%),linear-gradient(145deg,rgb(var(--surface-1)),rgb(var(--surface-0)))] shadow-xl shadow-black/10 transition hover:border-brand/50">
    <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[1fr_230px] lg:items-center">
      <div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-brand-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-light">Featured market</span><span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">{market.category}</span><span className="text-[10px] font-medium uppercase tracking-[0.13em] text-slate-500">{market.engine}</span></div><h2 className="mt-4 max-w-3xl text-xl font-semibold leading-7 tracking-tight text-white transition group-hover:text-brand-light sm:text-2xl">{market.question}</h2><p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-6 text-slate-400">{market.description}</p><div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500"><span>Closes {closeLabel(market.closeTime)}</span><span>{formatUsdc(marketVolume(market).toString())} matched</span></div></div>
      <div className="rounded-2xl border border-border bg-surface-0/70 p-4"><div className="flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">Market probability</p><p className="mt-2 text-3xl font-semibold text-yes-light">{probability === null ? "—" : `${probability.toFixed(0)}%`}</p></div><span className="mb-1 text-xs text-slate-500">YES</span></div><div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-3"><span className="prob-bar-yes" style={{ width: `${probability ?? 50}%` }} /><span className="prob-bar-no" style={{ width: `${probability === null ? 50 : 100 - probability}%` }} /></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-yes-light">YES</span><span className="text-no-light">NO {probability === null ? "—" : `${(100 - probability).toFixed(0)}%`}</span></div><div className="mt-4 border-t border-border pt-3 text-xs font-semibold text-brand-light transition group-hover:text-white">View market <span aria-hidden="true">→</span></div></div>
    </div>
  </Link>;
}
