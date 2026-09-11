"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createPublicClient, createWalletClient, custom, http, encodeFunctionData, parseAbi, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { GenetiaClient, type Proposal } from "@genetia/sdk";

const categories = ["crypto", "sports", "politics", "macro", "tech/AI", "science", "business", "entertainment", "culture", "geopolitics", "internet/social"];
const usdcAbi = parseAbi(["function approve(address spender, uint256 amount)"]);

export default function CreateMarketPage() {
  const router = useRouter();
  const [address, setAddress] = useState<Address>();
  const [status, setStatus] = useState("");
  const [bondTx, setBondTx] = useState<string>();

  async function connect() {
    if (!window.ethereum) return setStatus("Install a user-owned EVM wallet to create a market.");
    const wallet = createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum) });
    const [account] = await wallet.requestAddresses();
    if ((await wallet.getChainId()) !== baseSepolia.id) await wallet.switchChain({ id: baseSepolia.id });
    setAddress(account);
    setStatus(`Connected ${account.slice(0, 6)}…${account.slice(-4)} on Base Sepolia.`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address || !window.ethereum) return setStatus("Connect a wallet first.");
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
      const api = new GenetiaClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "", headers: { authorization: `Bearer ${address}`, "x-wallet-address": address } });
      const prepared = await api.prepareProposalBond(proposal, address);
      const wallet = createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum) });
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

  return <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100"><section className="mx-auto max-w-3xl"><Link href="/" className="text-cyan-400">← Markets</Link><h1 className="mt-8 text-3xl font-bold">Create a market</h1><p className="mt-3 text-slate-400">Submit precise terms. The user-owned wallet signs the fixed 2 USDC proposal bond on Base Sepolia.</p><form onSubmit={submit} className="mt-8 space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-6"><label className="block">Question<input required minLength={8} name="question" className="mt-2 w-full rounded-lg bg-slate-950 p-3" /></label><div className="grid gap-5 md:grid-cols-2"><label className="block">YES definition<textarea required minLength={8} name="yesDefinition" className="mt-2 h-28 w-full rounded-lg bg-slate-950 p-3" /></label><label className="block">NO definition<textarea required minLength={8} name="noDefinition" className="mt-2 h-28 w-full rounded-lg bg-slate-950 p-3" /></label></div><div className="grid gap-5 md:grid-cols-2"><label className="block">Category<select name="category" className="mt-2 w-full rounded-lg bg-slate-950 p-3">{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label className="block">Engine<select name="engine" className="mt-2 w-full rounded-lg bg-slate-950 p-3"><option value="POOL">Pool</option><option value="LMSR">Live Price / LMSR</option></select></label></div><label className="block">Authoritative source URL<input required type="url" name="source" className="mt-2 w-full rounded-lg bg-slate-950 p-3" /></label><div className="grid gap-5 md:grid-cols-2"><label className="block">Close time<input required type="datetime-local" name="closeTime" className="mt-2 w-full rounded-lg bg-slate-950 p-3" /></label><label className="block">Resolution available<input required type="datetime-local" name="resolutionTime" className="mt-2 w-full rounded-lg bg-slate-950 p-3" /></label></div><button type="button" onClick={connect} className="w-full rounded-lg border border-cyan-400 px-4 py-3 font-semibold text-cyan-300">{address ? "Wallet connected" : "Connect wallet"}</button><button className="w-full rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950">Prepare bond and submit proposal</button>{status && <p className="text-sm text-cyan-300">{status}</p>}{bondTx && <p className="break-all text-xs text-slate-500">Bond transaction: {bondTx}</p>}<p className="text-xs text-slate-500">Genetia never holds a betting balance or user signing key.</p></form></section></main>;
}
