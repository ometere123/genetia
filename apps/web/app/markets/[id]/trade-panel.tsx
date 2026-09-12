"use client";
import { useState } from "react";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, http, parseAbi, type Address, type Hash } from "viem";
import { baseSepolia } from "viem/chains";
import { GenetiaClient } from "@genetia/sdk";
import { getAccessToken, useWallets } from "@privy-io/react-auth";

const erc20Abi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

export default function TradePanel({ marketId, engine }: { marketId: string; engine: "POOL" | "LMSR" }) {
  const [address, setAddress] = useState<Address>();
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [action, setAction] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("1000000");
  const [status, setStatus] = useState("");
  const [hash, setHash] = useState<Hash>();
  const { wallets } = useWallets();

  async function connectWallet() {
    const selected = wallets[0];
    if (!selected) return setStatus("Connect an embedded or external wallet with Privy first.");
    if (selected.chainId !== `eip155:${baseSepolia.id}`) await selected.switchChain(baseSepolia.id);
    setAddress(selected.address as Address);
  }

  async function trade() {
    if (!address) return setStatus("Connect a user-owned wallet first.");
    const selected = wallets.find((wallet) => wallet.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
    if (!selected) return setStatus("Connect an embedded or external wallet with Privy first.");
    try {
      setStatus("Checking live market state…");
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Log in with Privy before preparing a trade.");
      const api = new GenetiaClient({ baseUrl: apiBaseUrl, headers: { authorization: `Bearer ${accessToken}`, "x-wallet-address": address } });
      const wallet = createWalletClient({ chain: baseSepolia, transport: custom(await selected.getEthereumProvider()) });
      if (await wallet.getChainId() !== baseSepolia.id) { await wallet.switchChain({ id: baseSepolia.id }); }
      const quoteRequest = { side, action: engine === "POOL" ? "BUY" as const : action, amount };
      const quote = await api.quote(marketId, quoteRequest);
      const slippageBps = 100n;
      const quoteTotal = BigInt(quote.total);
      const preparedRequest = engine === "LMSR"
        ? action === "BUY"
          ? { ...quoteRequest, maxTotal: ((quoteTotal * (10_000n + slippageBps) + 9_999n) / 10_000n).toString() }
          : { ...quoteRequest, minNet: (quoteTotal * (10_000n - slippageBps) / 10_000n).toString() }
        : quoteRequest;
      const prepared = await api.prepareTrade(marketId, preparedRequest);
      if (prepared.approval && BigInt(prepared.approval.amount) > 0n) {
        const allowance = await createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_RPC ?? "https://sepolia.base.org") })
          .readContract({ address: prepared.approval.token as Address, abi: erc20Abi, functionName: "allowance", args: [address, prepared.approval.spender as Address] });
        if (allowance < BigInt(prepared.approval.amount)) {
          setStatus("USDC approval required. Confirm the approval in your wallet…");
          const approvalHash = await wallet.sendTransaction({
            account: address,
            to: prepared.approval.token as Address,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [prepared.approval.spender as Address, BigInt(prepared.approval.amount)] }),
            value: 0n,
            chain: baseSepolia,
          });
          const approvalReceipt = await createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_RPC ?? "https://sepolia.base.org") }).waitForTransactionReceipt({ hash: approvalHash });
          if (approvalReceipt.status !== "success") throw new Error("USDC approval transaction failed.");
        }
      }
      const submitted = await wallet.sendTransaction({ account: address, to: prepared.to as Address, data: prepared.data as `0x${string}`, value: BigInt(prepared.value), chain: baseSepolia });
      setHash(submitted);
      setStatus(`Submitted. Waiting for Base Sepolia confirmation… Quote total: ${quote.total}`);
      const reader = createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_RPC ?? "https://sepolia.base.org") });
      const receipt = await reader.waitForTransactionReceipt({ hash: submitted });
      if (receipt.status !== "success") throw new Error("Base Sepolia transaction failed.");
      setStatus("Confirmed on Base Sepolia. Indexed state will refresh shortly.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Transaction could not be completed."); }
  }

  return <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-4">
    {!address ? <button onClick={connectWallet} className="w-full rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950">Connect wallet</button> : <>
      <div className="flex items-center justify-between text-xs text-slate-500"><span>{address.slice(0, 6)}…{address.slice(-4)}</span><button onClick={() => setAddress(undefined)} className="text-cyan-400">Disconnect</button></div>
      <div className="mt-4 grid grid-cols-2 gap-2"><select value={side} onChange={(event) => setSide(event.target.value as "YES" | "NO")} className="rounded-lg bg-slate-900 p-3"><option>YES</option><option>NO</option></select>{engine === "LMSR" && <select value={action} onChange={(event) => setAction(event.target.value as "BUY" | "SELL")} className="rounded-lg bg-slate-900 p-3"><option value="BUY">Buy</option><option value="SELL">Sell</option></select>}<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" pattern="[0-9]+" className="rounded-lg bg-slate-900 p-3" aria-label={action === "SELL" ? "shares in base units" : "USDC base units"} /></div>
      <button onClick={trade} className="mt-4 w-full rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950">Quote and {engine === "POOL" ? "stake" : action.toLowerCase()}</button>
    </>}
    {status && <p className="mt-3 text-sm text-cyan-300">{status}</p>}
    {hash && <p className="mt-2 break-all text-xs text-slate-500">Transaction: {hash}</p>}
  </div>;
}
