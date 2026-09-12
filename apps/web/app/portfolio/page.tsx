"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAccessToken, usePrivy, useWallets } from "@privy-io/react-auth";
import { GenetiaClient, type ActivityRecord } from "@genetia/sdk";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

export default function PortfolioPage() {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const client = useMemo(() => new GenetiaClient({ baseUrl: apiBase }), []);
  const [positions, setPositions] = useState<ActivityRecord[]>([]);
  const [history, setHistory] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!authenticated || !wallet?.address) {
      setPositions([]);
      setHistory([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    Promise.resolve(getAccessToken()).then((token) => {
      if (!token) throw new Error("Your Privy session expired. Log in again to view this wallet.");
      const auth = { authorization: `Bearer ${token}` };
      return Promise.all([client.positions(wallet.address, auth), client.history(wallet.address, auth)]);
    })
      .then(([nextPositions, nextHistory]) => {
        if (!cancelled) { setPositions(nextPositions); setHistory(nextHistory); }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Portfolio state could not be loaded.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authenticated, client, wallet?.address]);

  return <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
    <section className="mx-auto max-w-5xl">
      <Link href="/" className="text-cyan-400">← Markets</Link>
      <h1 className="mt-8 text-3xl font-bold">Portfolio</h1>
      <p className="mt-2 text-slate-400">Positions and activity are read from the indexed Base state for your selected Privy wallet.</p>
      {!authenticated ? <button onClick={() => login()} className="mt-6 rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950">Log in to view portfolio</button> : <>
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500">Selected wallet</p>
          <p className="mt-2 break-all font-mono text-sm">{wallet?.address ?? "Wallet is loading…"}</p>
          <p className="mt-2 text-sm text-slate-400">{wallet?.chainId === "eip155:84532" ? "Base Sepolia" : "Switch to Base Sepolia before signing transactions."}</p>
        </div>
        {loading && <p className="mt-6 text-slate-400">Loading indexed positions and activity…</p>}
        {error && <p role="alert" className="mt-6 rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-amber-200">{error}</p>}
        {!loading && !error && <div className="mt-8 grid gap-6 md:grid-cols-2">
          <RecordList title="Positions" records={positions} empty="No indexed positions for this wallet yet." />
          <RecordList title="Recent activity" records={history} empty="No indexed activity for this wallet yet." />
        </div>}
      </>}
      <p className="mt-8 text-xs text-slate-500">The index is for display only. Claim, refund, redemption, and withdrawal eligibility must be confirmed against the relevant Base contract before signing.</p>
    </section>
  </main>;
}

function RecordList({ title, records, empty }: { title: string; records: ActivityRecord[]; empty: string }) {
  return <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
    <h2 className="font-semibold">{title}</h2>
    {records.length === 0 ? <p className="mt-4 text-sm text-slate-500">{empty}</p> : <ul className="mt-4 space-y-3">{records.map((record, index) => <li key={String(record.id ?? record.transactionHash ?? index)} className="rounded-lg bg-slate-950 p-3">
      <p className="text-sm font-medium text-cyan-200">{String(record.action ?? record.engine ?? record.kind ?? "Onchain position")}</p>
      <p className="mt-1 break-all text-xs text-slate-400">{String(record.question ?? record.marketId ?? record.market_id ?? "Market details unavailable")}</p>
      <p className="mt-2 break-all font-mono text-[11px] text-slate-600">{String(record.transactionHash ?? record.txHash ?? "Indexed state")}</p>
    </li>)}</ul>}
  </section>;
}
