"use client";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { GenetiaClient } from "@genetia/sdk";

const categories = ["crypto", "sports", "politics", "macro", "tech/AI", "science", "business", "entertainment", "culture", "geopolitics", "internet/social"];

export default function CreateMarketPage() {
  const client = useMemo(() => new GenetiaClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "" }), []);
  const [status, setStatus] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const close = Math.floor(new Date(String(form.get("closeTime"))).getTime() / 1000);
    const resolution = Math.floor(new Date(String(form.get("resolutionTime"))).getTime() / 1000);
    if (!Number.isSafeInteger(close) || !Number.isSafeInteger(resolution) || resolution <= close) { setStatus("Resolution must be after close time."); return; }
    setStatus("Submitting the proposal and its 2 USDC bond…");
    try {
      await client.submitProposal({
        idempotencyKey: crypto.randomUUID(), market_id: crypto.randomUUID(), base_chain_id: 84532, genlayer_chain_id: 61997,
        question: String(form.get("question")), yes_definition: String(form.get("yesDefinition")), no_definition: String(form.get("noDefinition")),
        close_time: close, resolution_available_time: resolution, absolute_terminal_deadline: resolution + 345600,
        evidence_attempt_schedule_seconds: [0, 1800, 14400, 86400, 259200], void_conditions: ["insufficient authoritative evidence by terminal deadline"],
        resolution_profile: "MULTI_SOURCE", authoritative_sources: [{ identity: "creator-declared source", exact_url: String(form.get("source")), source_type: "official", priority: 0, required: true }],
        fallback_sources: [], corroboration_rule: "independent corroboration", minimum_corroborating_sources: 1, freshness_rule: "current at resolution",
        discovery_rule: "locked exact source or policy-compliant future page", official_source_required: true, arbitrary_caller_urls_forbidden: true,
        prompt_release_id: "pending", manifest_release_id: "pending", resolver_release_id: "pending", engine: String(form.get("engine")) as "POOL" | "LMSR",
        lmsrB: String(form.get("engine")) === "LMSR" ? "100000000" : undefined,
      });
      setStatus("Proposal submitted. Follow admissibility and bond status from the proposal record.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Proposal could not be submitted."); }
  }
  return <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100"><section className="mx-auto max-w-3xl"><Link href="/" className="text-cyan-400">← Markets</Link><h1 className="mt-8 text-3xl font-bold">Create a market</h1><p className="mt-3 text-slate-400">Submit precise YES/NO terms and a locked evidence policy. A 2 USDC proposal bond is handled by the Base escrow.</p><form onSubmit={submit} className="mt-8 space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-6"><label className="block">Question<input required minLength={8} name="question" className="mt-2 w-full rounded-lg bg-slate-950 p-3" /></label><div className="grid gap-5 md:grid-cols-2"><label className="block">YES definition<textarea required minLength={8} name="yesDefinition" className="mt-2 h-28 w-full rounded-lg bg-slate-950 p-3" /></label><label className="block">NO definition<textarea required minLength={8} name="noDefinition" className="mt-2 h-28 w-full rounded-lg bg-slate-950 p-3" /></label></div><div className="grid gap-5 md:grid-cols-2"><label className="block">Category<select name="category" className="mt-2 w-full rounded-lg bg-slate-950 p-3">{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label className="block">Engine<select name="engine" className="mt-2 w-full rounded-lg bg-slate-950 p-3"><option value="POOL">Pool</option><option value="LMSR">Live Price / LMSR</option></select></label></div><label className="block">Authoritative source URL<input required type="url" name="source" className="mt-2 w-full rounded-lg bg-slate-950 p-3" /></label><div className="grid gap-5 md:grid-cols-2"><label className="block">Close time<input required type="datetime-local" name="closeTime" className="mt-2 w-full rounded-lg bg-slate-950 p-3" /></label><label className="block">Resolution available<input required type="datetime-local" name="resolutionTime" className="mt-2 w-full rounded-lg bg-slate-950 p-3" /></label></div><button className="w-full rounded-lg bg-cyan-400 px-4 py-3 font-semibold text-slate-950">Connect wallet and submit proposal</button>{status && <p className="text-sm text-cyan-300">{status}</p>}<p className="text-xs text-slate-500">The user-owned wallet signs the bond and future market transactions. Genetia never holds a betting balance.</p></form></section></main>;
}
