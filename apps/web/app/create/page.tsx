"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createPublicClient, createWalletClient, custom, http, encodeFunctionData, parseAbi, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { GenetiaClient, type Proposal } from "@genetia/sdk";
import { getAccessToken, useWallets } from "@privy-io/react-auth";

const categories = ["crypto", "sports", "politics", "macro", "tech/AI", "science", "business", "entertainment", "culture", "geopolitics", "internet/social"];
const usdcAbi = parseAbi(["function approve(address spender, uint256 amount)"]);

export default function CreateMarketPage() {
  const router = useRouter();
  const [address, setAddress] = useState<Address>();
  const [status, setStatus] = useState("");
  const [bondTx, setBondTx] = useState<string>();
  const { wallets } = useWallets();

  async function connect() {
    const selected = wallets[0];
    if (!selected) return setStatus("Connect an embedded or external wallet with Privy first.");
    if (selected.chainId !== `eip155:${baseSepolia.id}`) await selected.switchChain(baseSepolia.id);
    setAddress(selected.address as Address);
    setStatus(`Connected ${selected.address.slice(0, 6)}…${selected.address.slice(-4)} on Base Sepolia.`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address) return setStatus("Connect a wallet first.");
    const selected = wallets.find((wallet) => wallet.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
    if (!selected) return setStatus("Connect an embedded or external wallet with Privy first.");
    const form = new FormData(event.currentTarget);
    const close = Math.floor(new Date(String(form.get("closeTime"))).getTime() / 1000);
    const resolution = Math.floor(new Date(String(form.get("resolutionTime"))).getTime() / 1000);
    if (!Number.isSafeInteger(close) || !Number.isSafeInteger(resolution) || resolution <= close) return setStatus("Resolution must be after close time.");
    const proposal: Proposal = {
      idempotencyKey: crypto.randomUUID(), market_id: crypto.randomUUID(), base_chain_id: 84532, genlayer_chain_id: 61997,
      question: String(form.get("question")), yes_definition: String(form.get("yesDefinition")), no_definition: String(form.get("noDefinition")),
      close_time: close, resolution_available_time: resolution, absolute_terminal_deadline: resolution + 345600,
      evidence_attempt_schedule_seconds: [0, 1800, 14400, 86400, 259200], void_conditions: ["insufficient authoritative evidence by terminal deadline"],
      resolution_profile: "MULTI_SOURCE", authoritative_sources: [{ identity: "creator-declared source", exact_url: String(form.get("source")), source_type: "official", priority: 0, required: true }], fallback_sources: [],
      corroboration_rule: "independent corroboration", minimum_corroborating_sources: 1, freshness_rule: "current at resolution", discovery_rule: "locked exact source or policy-compliant future page",
      official_source_required: true, arbitrary_caller_urls_forbidden: true, prompt_release_id: "pending", manifest_release_id: "pending", resolver_release_id: "pending", engine: String(form.get("engine")) as "POOL" | "LMSR",
      lmsrB: String(form.get("engine")) === "LMSR" ? "100000000" : undefined,
    };
    try {
      setStatus("Preparing the exact 2 USDC bond transaction…");
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Log in with Privy before creating a market.");
      const api = new GenetiaClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "", headers: { authorization: `Bearer ${accessToken}`, "x-wallet-address": address } });
      const prepared = await api.prepareProposalBond(proposal, address);
      const wallet = createWalletClient({ chain: baseSepolia, transport: custom(await selected.getEthereumProvider()) });
      if (prepared.approval) {
        setStatus("USDC approval required. Confirm it in your wallet…");
        const approvalHash = await wallet.sendTransaction({ account: address, to: prepared.approval.token as Address, data: encodeFunctionData({ abi: usdcAbi, functionName: "approve", args: [prepared.approval.spender as Address, BigInt(prepared.approval.amount)] }), value: 0n, chain: baseSepolia });
        await createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_RPC ?? "https://sepolia.base.org") }).waitForTransactionReceipt({ hash: approvalHash });
      }
      setStatus("Confirm the 2 USDC proposal bond in your wallet…");
      const hash = await wallet.sendTransaction({ account: address, to: prepared.lock.to as Address, data: prepared.lock.data as `0x${string}`, value: 0n, chain: baseSepolia });
      setBondTx(hash);
      await createPublicClient({ chain: baseSepolia, transport: http(process.env.NEXT_PUBLIC_BASE_RPC ?? "https://sepolia.base.org") }).waitForTransactionReceipt({ hash });
      setStatus("Bond confirmed. Starting GenLayer admissibility…");
      const result = await api.submitProposal(proposal, hash, address);
      router.push(`/create/status/${encodeURIComponent(result.proposalId)}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Proposal could not be submitted."); }
  }

  const fieldClass = "mt-2 w-full rounded-xl border border-border bg-surface-0 px-3.5 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-brand/70 focus:ring-2 focus:ring-brand/15";
  const labelClass = "block text-xs font-medium text-slate-400";
  return <main className="flex-1 bg-surface-0 px-4 py-8 text-slate-100 sm:px-6 sm:py-12">
    <section className="mx-auto max-w-4xl">
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-brand-light transition hover:text-white">← <span>Markets</span></Link>
      <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-surface-1 shadow-2xl shadow-black/10">
        <div className="border-b border-border bg-[radial-gradient(ellipse_at_top_left,rgba(99,102,241,0.16),transparent_65%)] px-5 py-7 sm:px-8 sm:py-9">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-light">Creator studio · Base Sepolia</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Create a market</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Write a question with precise YES/NO terms and verifiable sources. Your wallet signs the fixed 2 USDC proposal bond; Genetia never takes custody.</p>
          <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-medium text-slate-300"><span className="rounded-full border border-border bg-surface-1/80 px-3 py-1.5">01 · Define terms</span><span className="rounded-full border border-border bg-surface-1/80 px-3 py-1.5">02 · Lock bond</span><span className="rounded-full border border-border bg-surface-1/80 px-3 py-1.5">03 · Admissibility review</span></div>
        </div>
        <form onSubmit={submit} className="space-y-6 p-5 sm:p-8">
          <section className="space-y-4"><div><h2 className="text-sm font-semibold text-slate-100">The question</h2><p className="mt-1 text-xs text-slate-500">Keep it objective, time-bounded, and resolvable from public evidence.</p></div>
            <label className={labelClass}>Market question<input required minLength={8} name="question" placeholder="Will … by …?" className={fieldClass} /></label>
            <div className="grid gap-4 md:grid-cols-2"><label className={labelClass}>YES resolves when<textarea required minLength={8} name="yesDefinition" placeholder="State the exact condition for YES." className={`${fieldClass} h-28 resize-y`} /></label><label className={labelClass}>NO resolves when<textarea required minLength={8} name="noDefinition" placeholder="State the exact condition for NO." className={`${fieldClass} h-28 resize-y`} /></label></div>
          </section>
          <section className="space-y-4 border-t border-border pt-6"><div><h2 className="text-sm font-semibold text-slate-100">Market setup</h2><p className="mt-1 text-xs text-slate-500">Choose the trading engine and an authoritative source.</p></div>
            <div className="grid gap-4 sm:grid-cols-2"><label className={labelClass}>Category<select name="category" className={fieldClass}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label className={labelClass}>Trading engine<select name="engine" className={fieldClass}><option value="POOL">Pool · peer liquidity</option><option value="LMSR">LMSR · continuous pricing</option></select></label></div>
            <label className={labelClass}>Authoritative source URL<input required type="url" name="source" placeholder="https://…" className={fieldClass} /></label>
            <div className="grid gap-4 sm:grid-cols-2"><label className={labelClass}>Market closes<input required type="datetime-local" name="closeTime" className={fieldClass} /></label><label className={labelClass}>Resolution begins<input required type="datetime-local" name="resolutionTime" className={fieldClass} /></label></div>
          </section>
          <section className="rounded-2xl border border-brand/25 bg-brand-muted/40 p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/20 text-brand-light" aria-hidden="true">◈</span><div><h2 className="text-sm font-semibold text-white">Proposal bond · 2 USDC</h2><p className="mt-1 text-xs leading-5 text-slate-400">The API prepares the exact escrow transaction. The connected wallet checks allowance, approves if needed, then signs the bond. No proposal is marked paid until Base confirms the receipt.</p></div></div></section>
          <div className="grid gap-3 sm:grid-cols-2"><button type="button" onClick={connect} className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-brand/50 hover:bg-surface-3">{address ? `Wallet ${address.slice(0, 6)}…${address.slice(-4)}` : "Connect wallet"}</button><button className="rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-dark">Prepare bond and submit</button></div>
          {status && <p role="status" className="rounded-xl border border-brand/20 bg-brand-muted/40 p-3 text-sm text-brand-light">{status}</p>}{bondTx && <p className="break-all font-mono text-xs text-slate-500">Bond transaction: {bondTx}</p>}
          <p className="text-center text-[11px] text-slate-600">Your selected user-owned wallet signs every transaction. Genetia does not hold your keys or betting balance.</p>
        </form>
      </div>
    </section>
  </main>;
}
