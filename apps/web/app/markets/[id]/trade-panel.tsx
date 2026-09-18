"use client";

import { useState } from "react";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, type Address, type Hash } from "viem";
import { baseSepolia } from "viem/chains";
import { GenetiaClient, type Quote } from "@genetia/sdk";
import { getAccessToken, useWallets } from "@privy-io/react-auth";
import { useI18n } from "../../i18n";

const usdcAbi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";
const baseRpc = process.env.NEXT_PUBLIC_BASE_RPC ?? "https://base-sepolia-rpc.publicnode.com";

export default function TradePanel({ marketId, engine }: { marketId: string; engine: "POOL" | "LMSR" }) {
  const { t } = useI18n();
  const [address, setAddress] = useState<Address>();
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [action, setAction] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("1");
  const [slippageBps, setSlippageBps] = useState("100");
  const [quote, setQuote] = useState<Quote>();
  const [status, setStatus] = useState("");
  const [hash, setHash] = useState<Hash>();
  const { wallets } = useWallets();

  async function connectWallet() {
    const selected = wallets.find((wallet) => wallet.address.toLowerCase() === address?.toLowerCase()) ?? wallets[0];
    if (!selected) return setStatus(t("trade.connectHint"));
    if (selected.chainId !== `eip155:${baseSepolia.id}`) await selected.switchChain(baseSepolia.id);
    setAddress(selected.address as Address);
    setStatus(`Connected ${selected.address.slice(0, 6)}…${selected.address.slice(-4)} on Base Sepolia.`);
  }

  async function trade() {
    if (!address) return setStatus(t("trade.walletRequired"));
    const selected = wallets.find((wallet) => wallet.address.toLowerCase() === address.toLowerCase());
    if (!selected) return setStatus(t("trade.walletMissing"));
    const slippage = Number(slippageBps);
    if (!Number.isInteger(slippage) || slippage < 0 || slippage > 5000) return setStatus(t("trade.slippageInvalid"));
    try {
      setHash(undefined);
      setStatus(t("trade.quoteWait"));
      const token = await getAccessToken();
      if (!token) throw new Error(t("trade.login"));
      const api = new GenetiaClient({ baseUrl: apiBaseUrl, headers: { authorization: `Bearer ${token}`, "x-wallet-address": address } });
      const wallet = createWalletClient({ chain: baseSepolia, transport: custom(await selected.getEthereumProvider()) });
      if (await wallet.getChainId() !== baseSepolia.id) await wallet.switchChain({ id: baseSepolia.id });

      // LMSR share inventory uses the same six-decimal micro-unit scale as the
      // USDC-backed b/q state; the OutcomeTokens ERC-1155 intentionally has no
      // independent ERC-20 decimal convention.
      const amountBaseUnits = parseUnits(amount, 6).toString();
      const quoteRequest = { side, action: engine === "POOL" ? "BUY" as const : action, amount: amountBaseUnits };
      const liveQuote = await api.quote(marketId, quoteRequest);
      setQuote(liveQuote);
      const quoted = BigInt(liveQuote.total);
      const preparedRequest = engine === "LMSR"
        ? action === "BUY"
          ? { ...quoteRequest, maxTotal: ((quoted * (10_000n + BigInt(slippage)) + 9_999n) / 10_000n).toString() }
          : { ...quoteRequest, minNet: (quoted * (10_000n - BigInt(slippage)) / 10_000n).toString() }
        : quoteRequest;
      const prepared = await api.prepareTrade(marketId, preparedRequest);
      const reader = createPublicClient({ chain: baseSepolia, transport: http(baseRpc) });

      if (prepared.approval && BigInt(prepared.approval.amount) > 0n) {
        const allowance = await reader.readContract({ address: prepared.approval.token as Address, abi: usdcAbi, functionName: "allowance", args: [address, prepared.approval.spender as Address] });
        if (allowance < BigInt(prepared.approval.amount)) {
          setStatus(t("trade.approval"));
          const approvalHash = await wallet.sendTransaction({
            account: address,
            to: prepared.approval.token as Address,
            data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [prepared.approval.spender as Address, BigInt(prepared.approval.amount)] }),
            value: 0n,
            chain: baseSepolia,
          });
          const approvalReceipt = await reader.waitForTransactionReceipt({ hash: approvalHash });
          if (approvalReceipt.status !== "success") throw new Error(t("trade.confirmApproval"));
        }
      }

      setStatus(t("trade.confirmTrade"));
      const submitted = await wallet.sendTransaction({ account: address, to: prepared.to as Address, data: prepared.data as `0x${string}`, value: BigInt(prepared.value), chain: baseSepolia });
      setHash(submitted);
      setStatus(t("trade.waitReceipt"));
      const receipt = await reader.waitForTransactionReceipt({ hash: submitted });
      if (receipt.status !== "success") throw new Error(t("trade.failed"));
      setStatus(t("trade.refreshing"));
      window.dispatchEvent(new CustomEvent("genetia:transaction-confirmed", { detail: { marketId, hash: submitted } }));
      setStatus(t("trade.confirmed"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Transaction could not be completed.");
    }
  }

  const amountLabel = engine === "POOL"
    ? t("trade.amountPool")
    : action === "SELL" ? t("trade.amountSell") : t("trade.amountBuy");
  return <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-4">
    {!address ? <button onClick={connectWallet} className="w-full rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950">{t("trade.connect")}</button> : <>
      <div className="flex items-center justify-between text-xs text-slate-500"><span>Base Sepolia · {address.slice(0, 6)}…{address.slice(-4)}</span><button onClick={() => { setAddress(undefined); setQuote(undefined); setHash(undefined); }} className="text-cyan-400">Change wallet</button></div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-400">{t("trade.outcome")}<select aria-label={t("trade.outcome")} value={side} onChange={(event) => setSide(event.target.value as "YES" | "NO")} className="mt-1 w-full rounded-lg bg-slate-900 p-3 text-sm text-slate-100"><option>YES</option><option>NO</option></select></label>
        {engine === "LMSR" && <label className="text-xs text-slate-400">{t("trade.action")}<select aria-label={t("trade.action")} value={action} onChange={(event) => setAction(event.target.value as "BUY" | "SELL")} className="mt-1 w-full rounded-lg bg-slate-900 p-3 text-sm text-slate-100"><option value="BUY">{t("trade.buy")}</option><option value="SELL">{t("trade.sell")}</option></select></label>}
        <label className="col-span-2 text-xs text-slate-400">{amountLabel}<input aria-label={amountLabel} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,18})?" className="mt-1 w-full rounded-lg bg-slate-900 p-3 text-sm text-slate-100" /></label>
        {engine === "LMSR" && <label className="col-span-2 text-xs text-slate-400">{t("trade.slippage")}<input aria-label={t("trade.slippage")} value={slippageBps} onChange={(event) => setSlippageBps(event.target.value)} inputMode="numeric" pattern="[0-9]+" className="mt-1 w-full rounded-lg bg-slate-900 p-3 text-sm text-slate-100" /></label>}
      </div>
      <button onClick={trade} className="mt-4 w-full rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950">{t("trade.getQuote")} {engine === "POOL" ? "stake" : action === "BUY" ? t("trade.buy").toLowerCase() : t("trade.sell").toLowerCase()}</button>
    </>}
    {quote && <div aria-live="polite" className="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm">
      <p className="font-semibold text-slate-200">{t("trade.fresh")} {quote.engine ?? engine} · {quote.side ?? side} {quote.action ?? action}</p>
      <p className="mt-2 text-slate-400">{t("trade.notional")} {formatUnits(BigInt(quote.notional), 6)} USDC · {t("trade.fee")} {formatUnits(BigInt(quote.fee), 6)} USDC</p>
      <p className="mt-1 text-cyan-200">{action === "SELL" ? t("trade.proceeds") : t("trade.total")}: {formatUnits(BigInt(quote.total), 6)} USDC</p>
      {quote.shares && <p className="mt-1 text-slate-400">{t("trade.shares")} {formatUnits(BigInt(quote.shares), 6)}</p>}
    </div>}
    {status && <p role="status" className="mt-3 text-sm text-cyan-300">{status}</p>}
    {hash && <p className="mt-2 break-all text-xs text-slate-500">{t("trade.confirmedReceipt")} {hash}</p>}
    <p className="mt-3 text-xs text-slate-600">{t("trade.walletSigns")}</p>
  </div>;
}
