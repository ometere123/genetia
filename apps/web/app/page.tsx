"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GenetiaClient, type MarketPage } from "@genetia/sdk";
import AuthControls from "./auth-controls";

const categories = [
  "all", "crypto", "sports", "politics", "macro", "tech/AI", "science",
  "business", "entertainment", "culture", "geopolitics", "internet/social",
];

export default function Home() {
  const [category, setCategory] = useState("all");
  const [engine, setEngine] = useState<"all" | "POOL" | "LMSR">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<MarketPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useMemo(
    () => new GenetiaClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "" }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    client.markets({
      category: category === "all" ? undefined : category,
      engine: engine === "all" ? undefined : engine,
      status: "ACTIVE",
      limit: 24,
    }).then((result) => {
      if (!cancelled) { setPage(result); setError(null); }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load indexed markets");
    });
    return () => { cancelled = true; };
  }, [category, client, engine]);

  const markets = page?.items.filter((market) =>
    `${market.title} ${market.question} ${market.category}`.toLowerCase().includes(search.toLowerCase()),
  ) ?? [];

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <section className="mx-auto max-w-7xl">
        <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Genetia</p>
            <h1 className="mt-3 text-4xl font-bold">Markets resolved by evidence.</h1>
            <p className="mt-3 max-w-2xl text-slate-400">Explore broad YES/NO questions with transparent terms, indexed Base state, and GenLayer resolution progress.</p>
          </div>
          <div className="flex items-center gap-3">
            <AuthControls />
            <Link href="/portfolio" className="rounded-lg border border-slate-700 px-4 py-2 font-semibold text-slate-200">Portfolio</Link>
            <Link href="/create" className="rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950">Create a market</Link>
          </div>
        </div>
        <div className="mb-8 flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 md:flex-row">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search markets" className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none" />
          <select value={engine} onChange={(event) => setEngine(event.target.value as typeof engine)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
            <option value="all">All engines</option><option value="POOL">Pool</option><option value="LMSR">Live Price / LMSR</option>
          </select>
        </div>
        <div className="mb-8 flex gap-2 overflow-x-auto pb-2">
          {categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${category === item ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`}>{item}</button>)}
        </div>
        {error && <div className="rounded-lg border border-amber-700 bg-amber-950/30 p-4 text-amber-200">{error}</div>}
        {!error && !page && <p className="text-slate-400">Loading indexed markets…</p>}
        {!error && page && markets.length === 0 && <div className="rounded-xl border border-slate-800 p-8 text-slate-400">No active markets match this filter.</div>}
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {markets.map((market) => <Link key={market.marketId} href={`/markets/${encodeURIComponent(market.marketId)}`} className="rounded-xl border border-slate-800 bg-slate-900 p-5 transition hover:border-cyan-400">
            <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-500"><span>{market.category}</span><span className="text-cyan-400">{market.engine === "POOL" ? "Pool" : "Live Price"}</span></div>
            <h2 className="mt-4 line-clamp-3 text-lg font-semibold">{market.question}</h2>
            <p className="mt-4 text-sm text-slate-400">Closes {new Date(market.closeTime).toLocaleString()}</p>
            {market.pool && <p className="mt-3 text-sm text-slate-300">YES {market.pool.yesTotal} · NO {market.pool.noTotal}</p>}
          </Link>)}
        </div>
      </section>
    </main>
  );
}
