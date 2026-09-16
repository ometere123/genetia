"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { GenetiaClient, MARKET_CATEGORIES, type Market, type MarketPage } from "@genetia/sdk";
import { Icon } from "./site-header";
import { useI18n } from "./i18n";

type StatusFilter = "ALL" | "ACTIVE" | "RESOLVED";

const marketClient = new GenetiaClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "",
});

function formatUsdc(raw?: string, locale = "en") {
  if (!raw || !/^\d+$/.test(raw)) return "—";
  const amount = BigInt(raw);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ".";
  return `$${whole.toLocaleString(locale)}${separator}${fraction}`;
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

function closeLabel(value: string, locale = "en") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : `${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

function MarketCard({ market }: { market: Market }) {
  const { t, locale } = useI18n();
  const yes = yesProbability(market);
  const no = yes === null ? null : 100 - yes;
  const resolved = market.status === "RESOLVED";
  const live = !resolved && new Date(market.closeTime).getTime() > Date.now();
  const remaining = Math.max(0, new Date(market.closeTime).getTime() - Date.now());
  const timeLabel = remaining <= 0 ? t("market.ended") : remaining >= 86_400_000
    ? t("market.daysLeft", { n: Math.floor(remaining / 86_400_000) })
    : remaining >= 3_600_000 ? t("market.hoursLeft", { n: Math.floor(remaining / 3_600_000) }) : t("market.minutesLeft", { n: Math.max(1, Math.floor(remaining / 60_000)) });
  const volume = marketVolume(market);

  return (
    <Link href={`/markets/${encodeURIComponent(market.marketId)}`} className="market-card group block overflow-hidden rounded-2xl border border-border bg-surface-1">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-muted px-2.5 py-1 text-[11px] font-medium capitalize text-brand-light"><Icon name={market.category.toLowerCase()} className="h-[11px] w-[11px]" />{t(`category.${market.category}`)}</span>
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
          <div className="flex flex-1 items-center justify-between rounded-xl border border-border bg-surface-3 px-3 py-2.5 transition-colors group-hover:border-yes/30"><span className="text-xs font-medium text-slate-400">{t("market.yes")}</span><span className="text-base font-bold text-yes">{yes === null ? "—" : `${yes.toFixed(0)}%`}</span></div>
          <div className="flex flex-1 items-center justify-between rounded-xl border border-border bg-surface-3 px-3 py-2.5 transition-colors group-hover:border-no/30"><span className="text-xs font-medium text-slate-400">{t("market.no")}</span><span className="text-base font-bold text-no">{no === null ? "—" : `${no.toFixed(0)}%`}</span></div>
        </div>
      </div>
      <div className="px-4 pb-1"><div className="h-1 overflow-hidden rounded-full bg-surface-4"><div className="prob-bar-yes h-full rounded-full transition-all duration-500" style={{ width: `${yes ?? 50}%` }} /></div></div>
      <div className="mt-2 flex items-center justify-between border-t border-border px-4 py-3">
        <span className="text-[11px] text-slate-500">{formatUsdc(volume.toString(), locale)} {t("market.volume")}</span>
        <span className="text-[11px] font-medium text-slate-600 transition-colors group-hover:text-slate-300">{t("market.trade")}</span>
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
  const { t, locale } = useI18n();
  const [category, setCategory] = useState("all");
  const [engine, setEngine] = useState<"all" | "POOL" | "LMSR">("all");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<MarketPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const filterKey = `${category}\u0000${engine}\u0000${status}\u0000${search.trim()}`;
  const currentFilterKey = useRef(filterKey);
  currentFilterKey.current = filterKey;

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
    setLoadingMore(false);
    const timer = window.setTimeout(() => {
      marketClient.markets({
        category: category === "all" ? undefined : category,
        engine: engine === "all" ? undefined : engine,
        status: status === "ALL" ? undefined : status,
        search: search.trim() || undefined,
        limit: 48,
      }).then((result) => {
        if (!cancelled) setPage(result);
      }).catch((reason: unknown) => {
        if (!cancelled) { setPage(null); setError(reason instanceof Error ? reason.message : "Unable to load indexed markets."); }
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, search.trim() ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [category, engine, search, status]);

  const markets = page?.items ?? [];
  const featured = status !== "RESOLVED" && category === "all" && engine === "all" && !search.trim()
    ? [...markets].sort((a, b) => (marketVolume(a) > marketVolume(b) ? -1 : marketVolume(a) < marketVolume(b) ? 1 : 0))[0]
    : undefined;
  const listedMarkets = featured ? markets.filter((market) => market.marketId !== featured.marketId) : markets;

  async function loadMore() {
    if (!page?.nextCursor || loadingMore) return;
    const requestedFilterKey = filterKey;
    const cursor = page.nextCursor;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await marketClient.markets({
        category: category === "all" ? undefined : category,
        engine: engine === "all" ? undefined : engine,
        status: status === "ALL" ? undefined : status,
        search: search.trim() || undefined,
        cursor,
        limit: 48,
      });
      if (currentFilterKey.current !== requestedFilterKey) return;
      setPage((current) => current ? {
        items: [...current.items, ...next.items.filter((item) => !current.items.some((existing) => existing.marketId === item.marketId))],
        nextCursor: next.nextCursor,
      } : next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load more markets.");
    } finally {
      setLoadingMore(false);
    }
  }

  return <>
    <section aria-label="Market filters" className="sticky top-[70px] z-30 border-b border-border bg-surface-0">
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6">
        <div className="mr-3 flex shrink-0 items-center gap-0.5">
          {([{ id: "ALL", label: t("status.all"), icon: "trend" }, { id: "ACTIVE", label: t("status.open"), icon: "bolt" }, { id: "RESOLVED", label: t("status.resolved"), icon: "sparkle" }] as const).map((item) => <button key={item.id} type="button" aria-pressed={status === item.id} onClick={() => setStatus(item.id)} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${status === item.id ? "bg-surface-3 text-white" : "text-slate-500 hover:bg-surface-2 hover:text-slate-300"}`}><Icon name={item.icon} className="h-3 w-3" />{item.label}</button>)}
        </div>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")} className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${category === "all" ? "bg-surface-3 text-white" : "text-slate-500 hover:bg-surface-2 hover:text-slate-300"}`}><Icon name="grid" className="h-3 w-3" />{t("category.all")}</button>
        {MARKET_CATEGORIES.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${category === item ? "bg-surface-3 text-white" : "text-slate-500 hover:bg-surface-2 hover:text-slate-300"}`}><Icon name={item} className="h-3 w-3" />{t(`category.${item}`)}</button>)}
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        {([{ id: "all", label: t("engine.all") }, { id: "POOL", label: t("engine.pool") }, { id: "LMSR", label: t("engine.lmsr") }] as const).map((item) => <button key={item.id} type="button" aria-pressed={engine === item.id} onClick={() => setEngine(item.id)} className={`flex shrink-0 items-center whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${engine === item.id ? "bg-surface-3 text-white" : "text-slate-500 hover:bg-surface-2 hover:text-slate-300"}`}>{item.label}</button>)}
      </div>
    </section>
    <main className="flex-1 bg-surface-0 text-slate-100">
      <section className="px-4 py-8 sm:px-6">
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(300px,22.5vw)]">
          <div className="min-w-0">
            {featured && <FeaturedMarketCard market={featured} />}
            <div className="mb-6 flex items-center justify-between gap-4">
              <h1 className="text-sm font-semibold text-slate-300">{loading ? t("markets.loading") : error ? t("markets.unavailable") : markets.length === 0 ? t("markets.empty") : t(markets.length === 1 ? "markets.countOne" : "markets.count", { n: markets.length })}</h1>
              <Link href="/create" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-dark"><span aria-hidden="true">＋</span> {t("create.market")}</Link>
            </div>
            {error && <div role="status" className="mb-3 text-xs text-slate-500">{t("markets.unavailableHelp")}</div>}
            {loading && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <SkeletonCard key={index} />)}</div>}
            {!loading && markets.length === 0 && <div className="flex min-h-[368px] flex-col items-center justify-center rounded-2xl border border-border bg-surface-1 px-6 py-12 text-center"><Icon name="inbox" className="h-10 w-10 text-slate-500" /><p className="mt-5 text-base text-slate-400">{error ? t("markets.unavailable") : search.trim() ? t("markets.noMatch") : t("markets.empty")}</p>{error ? <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-surface-3 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-surface-4">{t("action.retry")}</button> : search.trim() ? <button type="button" onClick={() => { setSearch(""); window.history.replaceState(null, "", "/"); }} className="mt-6 rounded-xl bg-surface-3 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-surface-4">{t("search.clear")}</button> : <Link href="/create" className="mt-6 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark">{t("create.market")}</Link>}</div>}
            {!loading && !error && markets.length > 0 && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{listedMarkets.map((market) => <MarketCard key={market.marketId} market={market} />)}</div>}
            {!loading && !error && Boolean(page?.nextCursor) && <div className="mt-6 text-center"><button type="button" onClick={loadMore} disabled={loadingMore} className="rounded-xl border border-border bg-surface-2 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-surface-3 disabled:cursor-wait disabled:opacity-60">{loadingMore ? t("action.loading") : t("markets.loadMore")}</button></div>}
          </div>
          <aside className="rounded-2xl border border-brand/25 bg-brand/5 p-5"><h2 className="text-sm font-semibold text-brand-light">{t("sidebar.title")}</h2><p id="how-it-works" className="mt-2 text-sm leading-6 text-slate-500">{t("sidebar.body")}</p></aside>
        </div>
      </section>
    </main>
  </>;
}

function FeaturedMarketCard({ market }: { market: Market }) {
  const { t, locale } = useI18n();
  const probability = yesProbability(market);
  return <Link href={`/markets/${encodeURIComponent(market.marketId)}`} className="group mb-6 block overflow-hidden rounded-3xl border border-brand/25 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.18),transparent_55%),linear-gradient(145deg,rgb(var(--surface-1)),rgb(var(--surface-0)))] shadow-xl shadow-black/10 transition hover:border-brand/50">
    <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[1fr_230px] lg:items-center">
      <div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-brand-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-light">{t("market.featured")}</span><span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">{t(`category.${market.category}`)}</span><span className="text-[10px] font-medium uppercase tracking-[0.13em] text-slate-500">{market.engine}</span></div><h2 className="mt-4 max-w-3xl text-xl font-semibold leading-7 tracking-tight text-white transition group-hover:text-brand-light sm:text-2xl">{market.question}</h2><p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-6 text-slate-400">{market.description}</p><div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500"><span>{t("market.closes")} {closeLabel(market.closeTime, locale)}</span><span>{formatUsdc(marketVolume(market).toString(), locale)} {t("market.matched")}</span></div></div>
      <div className="rounded-2xl border border-border bg-surface-0/70 p-4"><div className="flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{t("market.probability")}</p><p className="mt-2 text-3xl font-semibold text-yes-light">{probability === null ? "—" : `${probability.toFixed(0)}%`}</p></div><span className="mb-1 text-xs text-slate-500">{t("market.yes")}</span></div><div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-3"><span className="prob-bar-yes" style={{ width: `${probability ?? 50}%` }} /><span className="prob-bar-no" style={{ width: `${probability === null ? 50 : 100 - probability}%` }} /></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-yes-light">{t("market.yes")}</span><span className="text-no-light">{t("market.no")} {probability === null ? "—" : `${(100 - probability).toFixed(0)}%`}</span></div><div className="mt-4 border-t border-border pt-3 text-xs font-semibold text-brand-light transition group-hover:text-white">{t("market.view")}</div></div>
    </div>
  </Link>;
}
