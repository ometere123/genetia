"use client";
import { useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, http, type Address, type Hash } from "viem";
import { baseSepolia } from "viem/chains";
import { GenetiaClient } from "@genetia/sdk";

export default function TradePanel({ marketId, engine }: { marketId: string; engine: "POOL" | "LMSR" }) {
  const api = useMemo(() => new GenetiaClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "", headers: {} }), []);
  const [address, setAddress] = useState<Address>();
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("1000000");
  const [status, setStatus] = useState("");
  const [hash, setHash] = useState<Hash>();

  async function connectWallet() {
    if (!window.ethereum) return setStatus("No injected wallet detected. Install a user-owned EVM wallet.");
    const wallet = createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum) });
    const [account] = await wallet.requestAddresses();
    setAddress(account);
    const chain = await wallet.getChainId();
    if (chain !== baseSepolia.id) setStatus("Wallet connected. Switch to Base Sepolia before trading.");
  }

  async function trade() {
    if (!address || !window.ethereum) return setStatus("Connect a user-owned wallet first.");
    try {
      setStatus("Checking live market state…");
      const wallet = createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum) });
      if (await wallet.getChainId() !== baseSepolia.id) { await wallet.switchChain({ id: baseSepolia.id }); }
      const request = { side, action: "BUY" as const, amount, ...(engine === "LMSR" ? { maxTotal: amount } : {}) };
      const quote = await api.quote(marketId, request);
      const prepared = await api.prepareTrade(marketId, request);
      const submitted = await wallet.sendTransaction({ account: address, to: prepared.to as Address, data: prepared.data as `0x${string}`, value: BigInt(prepared.value), chain: baseSepolia });
      setHash(submitted);
      setStatus(`Submitted. Waiting for Base Sepolia confirmation… Quote total: ${quote.total}`);
      const reader = createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_RPC ?? "https://sepolia.base.org") });
      await reader.waitForTransactionReceipt({ hash: submitted });
      setStatus("Confirmed on Base Sepolia. Indexed state will refresh shortly.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Transaction could not be completed."); }
  }

  return <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-4">
    {!address ? <button onClick={connectWallet} className="w-full rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950">Connect wallet</button> : <>
      <div className="flex items-center justify-between text-xs text-slate-500"><span>{address.slice(0, 6)}…{address.slice(-4)}</span><button onClick={() => setAddress(undefined)} className="text-cyan-400">Disconnect</button></div>
      <div className="mt-4 grid grid-cols-2 gap-2"><select value={side} onChange={(event) => setSide(event.target.value as "YES" | "NO")} className="rounded-lg bg-slate-900 p-3"><option>YES</option><option>NO</option></select><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" pattern="[0-9]+" className="rounded-lg bg-slate-900 p-3" aria-label="USDC base units" /></div>
      <button onClick={trade} className="mt-4 w-full rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950">Quote and {engine === "POOL" ? "stake" : "buy"}</button>
    </>}
    {status && <p className="mt-3 text-sm text-cyan-300">{status}</p>}
    {hash && <p className="mt-2 break-all text-xs text-slate-500">Transaction: {hash}</p>}
  </div>;
}
