"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GenetiaClient, type ActivityRecord } from "@genetia/sdk";
import TradePanel from "./trade-panel";

export default function MarketDetail({ params }: { params: { id: string } }) {
  const client = useMemo(() => new GenetiaClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "" }), []);
  const [market, setMarket] = useState<Awaited<ReturnType<GenetiaClient["market"]>> | null>(null);
  const [prices, setPrices] = useState<ActivityRecord | null>(null);
  const [resolution, setResolution] = useState<ActivityRecord | null>(null);
  const [evidence, setEvidence] = useState<ActivityRecord[]>([]);
  const [trades, setTrades] = useState<ActivityRecord[]>([]);
  const [liquidity, setLiquidity] = useState<ActivityRecord[]>([]);
  const [message, setMessage] = useState("Loading indexed market state…");
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [detail, quoteState, sources, recentTrades, liquidityRows] = await Promise.all([
        client.market(params.id), client.prices(params.id), client.evidence(params.id),
        client.trades(params.id), client.liquidity(params.id),
      ]);
      if (!cancelled) {
        setMarket(detail); setPrices(quoteState); setEvidence(sources);
        setTrades(recentTrades); setLiquidity(liquidityRows); setMessage("");
      }
      void client.resolution(params.id).then((result) => { if (!cancelled) setResolution(result); }).catch(() => undefined);
    };
    const onConfirmed = (event: Event) => {
      const detail = (event as CustomEvent<{ marketId?: string }>).detail;
      if (detail?.marketId === params.id) void refresh().catch((reason: unknown) => {
        if (!cancelled) setMessage(reason instanceof Error ? reason.message : "Confirmed transaction; indexed state is still catching up.");
      });
    };
    void refresh().catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : "Market unavailable"));
    window.addEventListener("genetia:transaction-confirmed", onConfirmed);
    return () => { cancelled = true; window.removeEventListener("genetia:transaction-confirmed", onConfirmed); };
  }, [client, params.id]);
  if (!market) return <main className="min-h-screen bg-slate-950 p-8 text-slate-100"><Link href="/" className="text-cyan-400">← Markets</Link><p className="mt-10 text-slate-400">{message}</p></main>;
  return <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100"><section className="mx-auto max-w-5xl"><Link href="/" className="text-cyan-400">← Markets</Link><div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]"><article><div className="text-sm text-slate-400">{market.category} · {market.engine === "POOL" ? "Pool" : "Live Price / LMSR"}</div><h1 className="mt-4 text-3xl font-bold">{market.question}</h1><p className="mt-5 text-slate-300">{market.description}</p><div className="mt-4 grid gap-3 text-sm text-slate-400 sm:grid-cols-3"><p>Closes {new Date(market.closeTime).toLocaleString()}</p><p>Resolution {new Date(market.resolutionAvailableTime).toLocaleString()}</p><p>Terminal deadline {new Date(market.terminalDeadline).toLocaleString()}</p></div><div className="mt-8 grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-4"><p className="text-xs uppercase text-emerald-400">YES definition</p><p className="mt-2">{market.yesDefinition ?? "Not available in the indexed manifest."}</p></div><div className="rounded-xl border border-rose-900 bg-rose-950/30 p-4"><p className="text-xs uppercase text-rose-400">NO definition</p><p className="mt-2">{market.noDefinition ?? "Not available in the indexed manifest."}</p></div></div><section className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">Resolution status</h2><div className="mt-4 space-y-2 text-sm text-slate-300"><p>Lifecycle: <span className="text-cyan-400">{String(resolution?.lifecycle ?? "not indexed")}</span></p><p>Execution: {String(resolution?.executionStatus ?? "pending")}</p><p>Manifest: <code className="break-all text-xs text-slate-400">{market.manifestHash}</code></p><p>Resolver: <code className="text-xs text-slate-400">{market.resolverAddress}</code></p></div></section><div className="mt-6 grid gap-6 md:grid-cols-2"><section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">Evidence</h2><p className="mt-2 text-sm text-slate-400">Evidence attempts and source identities are indexed from finalized resolver state.</p><ul className="mt-4 space-y-2 text-sm">{evidence.length ? evidence.map((item, index) => <li key={String(item.id ?? index)} className="break-all text-slate-300">{String(item.url ?? item.sourceIdentity ?? "locked source")}</li>) : <li className="text-slate-500">No indexed evidence records.</li>}</ul></section><section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">Recent trades</h2><ul className="mt-4 space-y-2 text-sm">{trades.length ? trades.slice(0, 8).map((item, index) => <li key={String(item.id ?? index)} className="break-all text-slate-300">{String(item.side ?? item.action ?? "Trade")} · {String(item.amount ?? item.shares ?? "Amount indexed")}</li>) : <li className="text-slate-500">No indexed trades yet.</li>}</ul></section></div><section className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">Liquidity activity</h2><p className="mt-3 text-sm text-slate-400">{liquidity.length ? `${liquidity.length} indexed liquidity event(s).` : "No indexed liquidity activity."}</p></section></article><aside className="h-fit rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="font-semibold">{market.engine === "POOL" ? "Pool market" : "Live Price market"}</h2>{market.pool && <div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-lg bg-emerald-950/40 p-3"><p className="text-xs text-emerald-400">YES pool</p><p className="mt-1 text-lg">{market.pool.yesTotal}</p></div><div className="rounded-lg bg-rose-950/40 p-3"><p className="text-xs text-rose-400">NO pool</p><p className="mt-1 text-lg">{market.pool.noTotal}</p></div></div>}{prices && <pre className="mt-5 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300">{JSON.stringify(prices, null, 2)}</pre>}<TradePanel marketId={market.marketId} engine={market.engine} /><p className="mt-3 text-xs text-slate-500">Your wallet signs transactions. Genetia does not custody balances.</p>{message && <p className="mt-3 text-sm text-cyan-300">{message}</p>}</aside></div></section></main>;
}
