"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GenetiaClient, type ProposalStatus } from "@genetia/sdk";

const api = () => new GenetiaClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "" });

export default function ProposalStatusPage({ params }: { params: { id: string } }) {
  const [state, setState] = useState<ProposalStatus>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    api().proposal(params.id).then((value) => { if (active) setState(value); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Proposal status unavailable"); });
    return () => { active = false; };
  }, [params.id]);
  return <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100"><section className="mx-auto max-w-2xl"><Link href="/create" className="text-cyan-400">← Create market</Link><h1 className="mt-8 text-3xl font-bold">Proposal status</h1>{error && <p className="mt-6 rounded-lg border border-rose-800 bg-rose-950/30 p-4 text-rose-200">{error}</p>}{state && <div className="mt-6 space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6"><div><p className="text-sm text-slate-400">Proposal ID</p><p className="break-all font-mono text-sm">{state.proposalId}</p></div><div className="grid gap-4 sm:grid-cols-2"><Status label="Bond" value={state.bondStatus} /><Status label="Admissibility" value={state.status} /><Status label="Workflow" value={state.workflowStatus} /><Status label="Revisions" value={`${state.revisionCount} / 2`} /></div>{state.issues?.length ? <div><p className="text-sm text-slate-400">Revision issues</p><ul className="mt-2 list-disc pl-5 text-amber-200">{state.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}<p className="text-sm text-slate-400">This page reads durable proposal state from the API. Reloading does not reset the workflow or infer a decision from browser state.</p></div>}</section></main>;
}

function Status({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-950 p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-semibold text-cyan-200">{value}</p></div>; }
