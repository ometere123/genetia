"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getAccessToken, useLogin, usePrivy, useWallets } from "@privy-io/react-auth";
import { createPublicClient, formatUnits, http, parseAbi, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { GenetiaClient, type ActivityRecord } from "@genetia/sdk";
import { Icon } from "../site-header";

const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const balanceAbi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);
const api = new GenetiaClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "" });
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_RPC ?? "https://sepolia.base.org") });

function usdcDisplay(raw: bigint) {
  const cents = raw / 10_000n;
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `$${whole.toLocaleString("en-US")}.${fraction}`;
}

export default function WalletPage() {
  const { authenticated } = usePrivy();
  const { login } = useLogin();
  const { wallets } = useWallets();
  const [selectedAddress, setSelectedAddress] = useState("");
  const wallet = wallets.find((item) => item.address.toLowerCase() === selectedAddress.toLowerCase()) ?? wallets[0];
  const [balance, setBalance] = useState<bigint>();
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const onBaseSepolia = wallet?.chainId === `eip155:${baseSepolia.id}`;

  useEffect(() => {
    if (!authenticated || !wallet?.address) { setBalance(undefined); setRecords([]); return; }
    let cancelled = false;
    setLoading(true);
    setMessage("");
    const balanceRequest = onBaseSepolia
      ? publicClient.readContract({ address: usdc, abi: balanceAbi, functionName: "balanceOf", args: [wallet.address as Address] })
      : Promise.reject(new Error("Switch to Base Sepolia to read this wallet’s USDC balance."));
    const activityRequest = getAccessToken().then((token) => {
      if (!token) throw new Error("Your Privy session expired. Please log in again.");
      return api.history(wallet.address, { authorization: `Bearer ${token}` });
    });
    Promise.allSettled([balanceRequest, activityRequest]).then(([balanceResult, activityResult]) => {
      if (cancelled) return;
      if (balanceResult.status === "fulfilled") setBalance(balanceResult.value);
      else { setBalance(undefined); setMessage(balanceResult.reason instanceof Error ? balanceResult.reason.message : "Wallet balance is unavailable."); }
      if (activityResult.status === "fulfilled") setRecords(activityResult.value);
      else setMessage(activityResult.reason instanceof Error ? `${activityResult.reason.message} Wallet balance is read directly from Base.` : "Activity index is unavailable; on-chain wallet state is unchanged.");
    }).finally(() => { if (!cancelled) { setLoading(false); setRefreshing(false); } });
    return () => { cancelled = true; };
  }, [authenticated, onBaseSepolia, refreshKey, wallet?.address]);

  const refresh = useCallback(() => { setRefreshing(true); setRefreshKey((value) => value + 1); }, []);
  const changeNetwork = useCallback(async () => {
    if (!wallet) return;
    try { await wallet.switchChain(baseSepolia.id); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Network switch was not completed."); }
  }, [wallet]);

  return <main className="flex-1 bg-surface-0 px-4 py-8 text-slate-100 sm:px-6 sm:py-10">
    <section className="mx-auto max-w-[640px]">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div><p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-light"><Icon name="wallet" className="h-3.5 w-3.5" /> User-owned wallet</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Wallet</h1><p className="mt-1 text-xs text-slate-500">On-chain Base Sepolia balances. Genetia never holds your funds.</p></div>
        <button type="button" onClick={refresh} disabled={!wallet || refreshing} aria-label="Refresh wallet" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-1 text-slate-400 transition hover:text-white disabled:opacity-50"><span className={refreshing ? "animate-spin" : ""}>↻</span></button>
      </header>

      {!authenticated ? <section className="rounded-2xl border border-border bg-surface-1 p-8 text-center"><p className="text-sm text-slate-400">Log in to view your linked wallet and on-chain balance.</p><button type="button" onClick={() => login()} className="mt-5 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white">Connect wallet</button></section> : <>
        <section className="overflow-hidden rounded-2xl border border-border bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.11),transparent_55%),linear-gradient(145deg,rgb(var(--surface-1)),rgb(var(--surface-0)))] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4"><div><p className="text-[11px] text-slate-500">USDC in selected wallet</p><p className="mt-1 text-3xl font-semibold tracking-tight text-white">{balance === undefined ? "—" : usdcDisplay(balance)}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${onBaseSepolia ? "border-emerald-900/70 bg-emerald-950/30 text-emerald-300" : "border-amber-900/70 bg-amber-950/30 text-amber-300"}`}>{onBaseSepolia ? "Base Sepolia" : "Wrong network"}</span></div>
          <div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl border border-border bg-surface-0/70 p-3"><p className="text-[10px] text-slate-500">Wallet type</p><p className="mt-1 text-xs font-medium capitalize text-slate-200">{wallet?.walletClientType ?? "Privy wallet"}</p></div><div className="rounded-xl border border-border bg-surface-0/70 p-3"><p className="text-[10px] text-slate-500">Recent indexed trades</p><p className="mt-1 text-xs font-medium text-slate-200">{records.length}</p></div></div>
          {wallet && <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-0/70 px-3 py-2.5"><span className="truncate font-mono text-[11px] text-slate-400">{wallet.address}</span><button type="button" onClick={() => { void navigator.clipboard?.writeText(wallet.address); setMessage("Wallet address copied."); }} className="shrink-0 text-[11px] font-medium text-brand-light hover:text-white">Copy</button></div>}
          {!onBaseSepolia && <button type="button" onClick={() => void changeNetwork()} className="mt-4 w-full rounded-lg border border-amber-900/70 bg-amber-950/20 px-3 py-2.5 text-xs font-semibold text-amber-200">Switch wallet to Base Sepolia</button>}
        </section>

        <nav aria-label="Wallet sections" className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-surface-1 text-center text-xs"><Link href="/wallet" className="border-b-2 border-brand px-2 py-3 font-medium text-brand-light">Overview</Link><Link href="/portfolio" className="px-2 py-3 text-slate-400 transition hover:bg-surface-2 hover:text-white">Positions</Link><Link href="/portfolio#history" className="px-2 py-3 text-slate-400 transition hover:bg-surface-2 hover:text-white">History</Link></nav>

        <div className="mt-4 grid grid-cols-2 gap-3"><a href="https://faucet.circle.com/" target="_blank" rel="noreferrer" className="rounded-xl border border-brand/30 bg-brand-muted/30 p-4 text-center transition hover:border-brand/60"><span className="mx-auto grid h-7 w-7 place-items-center rounded-lg bg-brand/15 text-brand-light"><Icon name="download" className="h-4 w-4" /></span><span className="mt-2 block text-sm font-semibold text-slate-100">Get test USDC</span><span className="mt-1 block text-[11px] text-slate-500">Circle testnet faucet</span></a><Link href="/portfolio" className="rounded-xl border border-border bg-surface-1 p-4 text-center transition hover:bg-surface-2"><span className="mx-auto grid h-7 w-7 place-items-center rounded-lg bg-surface-3 text-slate-300"><Icon name="trend" className="h-4 w-4" /></span><span className="mt-2 block text-sm font-semibold text-slate-100">View portfolio</span><span className="mt-1 block text-[11px] text-slate-500">Positions and activity</span></Link></div>
        {loading && <p className="mt-4 text-center text-xs text-slate-500">Reading the wallet and indexed activity…</p>}
        {message && <p role="status" className="mt-4 rounded-lg border border-border bg-surface-1 px-3 py-2 text-xs leading-5 text-slate-400">{message}</p>}
        <p className="mt-4 text-center text-[11px] leading-5 text-slate-600">USDC remains in your connected wallet. Trading, proposal bonds, and exits are signed by that wallet on Base Sepolia.</p>
      </>}
    </section>
  </main>;
}
