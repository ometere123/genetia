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

  return <main className="flex-1 bg-surface-0 px-4 py-8 text-slate-100 sm:px-6 sm:py-10">
    <section className="mx-auto max-w-[1168px]">
      <div className="rounded-2xl border border-border bg-surface-1 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-brand to-indigo-400 text-lg font-bold text-white">G</span><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-light">Your account</p><h1 className="mt-1 text-xl font-semibold text-white">My Portfolio</h1></div></div><Link href="/wallet" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-surface-3">Manage Wallet ↗</Link></div>
        <p className="mt-4 max-w-2xl text-xs leading-5 text-slate-500">Portfolio activity is indexed from Base for your authenticated Privy wallet. Exit eligibility is always confirmed on chain.</p>
        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <SummaryCard label="USDC wallet balance" value="View wallet" detail="Read directly on Base Sepolia" href="/wallet" />
          <SummaryCard label="Indexed position records" value={loading ? "…" : String(positions.length)} detail="From the authenticated API" />
          <SummaryCard label="Realized P&L" value="—" detail="Not provided by the current read model" />
          <SummaryCard label="Indexed trades" value={loading ? "…" : String(history.length)} detail="Base event projection" />
        </div>
      </div>
      {!authenticated ? <button onClick={() => login()} className="mt-6 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-dark">Log in to view portfolio</button> : <>
        <div className="mt-5 rounded-2xl border border-border bg-surface-1 p-5 sm:p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Selected wallet</p>
          <p className="mt-2 break-all font-mono text-sm text-slate-200">{wallet?.address ?? "Wallet is loading…"}</p>
          <p className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] ${wallet?.chainId === "eip155:84532" ? "border-emerald-900/80 bg-emerald-950/40 text-emerald-300" : "border-amber-900/80 bg-amber-950/40 text-amber-300"}`}>{wallet?.chainId === "eip155:84532" ? "Base Sepolia connected" : "Switch to Base Sepolia before signing transactions."}</p>
        </div>
        {loading && <p className="mt-6 text-slate-400">Loading indexed positions and activity…</p>}
        {error && <p role="alert" className="mt-6 rounded-lg border border-amber-800 bg-amber-950/30 p-4 text-amber-200">{error}</p>}
        {!loading && !error && <div id="history" className="mt-6 grid gap-5 md:grid-cols-2">
          <RecordList title="Positions" records={positions} empty="No indexed positions for this wallet yet." />
          <RecordList title="Recent activity" records={history} empty="No indexed activity for this wallet yet." />
        </div>}
      </>}
      <p className="mt-6 rounded-xl border border-border bg-surface-1/60 p-4 text-xs leading-5 text-slate-500">The index is for display only. Claim, refund, redemption, and withdrawal eligibility must be confirmed against the relevant Base contract before signing.</p>
    </section>
  </main>;
}

function SummaryCard({ label, value, detail, href }: { label: string; value: string; detail: string; href?: string }) {
  const content = <><p className="text-[10px] text-slate-500">{label}</p><p className={`mt-2 text-lg font-semibold ${href ? "text-brand-light" : "text-slate-100"}`}>{value}</p><p className="mt-1 text-[10px] text-slate-600">{detail}</p></>;
  return href ? <Link href={href} className="rounded-xl border border-border bg-surface-2 p-3.5 transition hover:border-brand/40">{content}</Link> : <div className="rounded-xl border border-border bg-surface-2 p-3.5">{content}</div>;
}

function RecordList({ title, records, empty }: { title: string; records: ActivityRecord[]; empty: string }) {
  return <section className="rounded-2xl border border-border bg-surface-1 p-5 sm:p-6">
    <div className="flex items-center justify-between"><h2 className="font-semibold text-slate-100">{title}</h2><span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-slate-500">{records.length}</span></div>
    {records.length === 0 ? <p className="mt-4 rounded-xl bg-surface-0 p-4 text-sm text-slate-500">{empty}</p> : <ul className="mt-4 space-y-3">{records.map((record, index) => <li key={String(record.id ?? record.transactionHash ?? index)} className="rounded-xl border border-border bg-surface-0 p-3.5">
      <p className="text-sm font-medium text-brand-light">{String(record.action ?? record.engine ?? record.kind ?? "Onchain position")}</p>
      <p className="mt-1 break-all text-xs text-slate-400">{String(record.question ?? record.marketId ?? record.market_id ?? "Market details unavailable")}</p>
      <p className="mt-2 break-all font-mono text-[11px] text-slate-600">{String(record.transactionHash ?? record.txHash ?? "Indexed state")}</p>
    </li>)}</ul>}
  </section>;
}
