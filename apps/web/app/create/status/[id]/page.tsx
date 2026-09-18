"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GenetiaClient, type ProposalStatus } from "@genetia/sdk";
import { useI18n } from "../../../i18n";

const api = () => new GenetiaClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "" });

export default function ProposalStatusPage({ params }: { params: { id: string } }) {
  const { t } = useI18n();
  const [state, setState] = useState<ProposalStatus>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => api().proposal(params.id).then((value) => {
      if (!active) return;
      setState(value);
      if (!value.marketId && value.workflowStatus === "RUNNING") timer = setTimeout(load, 5000);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Proposal status unavailable");
    });
    load();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [params.id]);

  return <main className="min-h-screen bg-surface-0 px-4 py-8 text-slate-100 sm:px-6 sm:py-12">
    <section className="mx-auto max-w-3xl">
      <Link href="/create" className="inline-flex items-center gap-2 text-sm font-medium text-brand-light transition hover:text-white">&lt;- <span>{t("proposalStatus.back")}</span></Link>
      <div className="mt-6 overflow-hidden rounded-3xl border border-border bg-surface-1">
        <div className="border-b border-border bg-[radial-gradient(ellipse_at_top_left,rgba(99,102,241,0.15),transparent_65%)] p-5 sm:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-light">{t("proposalStatus.workflow")}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{t("proposalStatus.title")}</h1>
          <p className="mt-2 text-sm text-slate-400">{t("proposalStatus.restored")}</p>
        </div>
        {error && <p role="alert" className="m-5 rounded-xl border border-rose-900/70 bg-rose-950/30 p-4 text-sm text-rose-200">{error}</p>}
        {!state && !error && <div className="p-6"><div className="h-4 w-40 animate-pulse rounded bg-surface-3" /><div className="mt-5 h-20 rounded-2xl bg-surface-0" /></div>}
        {state && <div className="space-y-5 p-5 sm:p-8">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t("proposalStatus.id")}</p><p className="mt-1 break-all font-mono text-sm text-slate-300">{state.proposalId}</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Status label={t("proposalStatus.bond")} value={state.bondStatus} />
            <Status label={t("proposalStatus.admissibility")} value={state.status} />
            <Status label={t("proposalStatus.workflowLabel")} value={state.workflowStatus} />
            <Status label={t("proposalStatus.revisions")} value={`${state.revisionCount} / 2`} />
          </div>
          {state.marketId
            ? <Link href={`/markets/${encodeURIComponent(state.marketId)}`} className="block rounded-xl border border-emerald-800/70 bg-emerald-950/30 p-4 text-sm font-semibold text-emerald-200 transition hover:border-emerald-500">Open created market -&gt;</Link>
            : <div className="rounded-xl border border-border bg-surface-0 p-4 text-xs leading-5 text-slate-400">Admissibility is still running. The market will appear here after the workflow creates it.</div>}
          {state.issues?.length ? <div className="rounded-2xl border border-amber-900/60 bg-amber-950/20 p-4"><p className="text-sm font-semibold text-amber-200">{t("proposalStatus.issues")}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100/80">{state.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-0 p-4"><span className="mt-0.5 text-brand-light" aria-hidden="true">[ ]</span><p className="text-xs leading-5 text-slate-400">{t("proposalStatus.finality")}</p></div>
        </div>}
      </div>
    </section>
  </main>;
}

function Status({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-surface-0 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</p><p className="mt-1.5 font-semibold text-brand-light">{value}</p></div>;
}
