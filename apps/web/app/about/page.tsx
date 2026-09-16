"use client";

import Link from "next/link";
import { useI18n } from "../i18n";

const steps = [
  { number: "01", title: "about.step1.title", body: "about.step1.body" },
  { number: "02", title: "about.step2.title", body: "about.step2.body" },
  { number: "03", title: "about.step3.title", body: "about.step3.body" },
  { number: "04", title: "about.step4.title", body: "about.step4.body" },
];

export default function AboutPage() {
  const { t } = useI18n();
  return <main className="flex-1 bg-surface-0 px-4 py-10 text-slate-100 sm:px-6 sm:py-14">
    <div className="mx-auto max-w-[620px]">
      <header className="mb-10 text-center">
        <span className="inline-flex rounded-full border border-brand/30 bg-brand-muted px-3 py-1 text-[11px] font-medium text-brand-light">✦ &nbsp;{t("about.badge")}</span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">{t("about.title")}</h1>
        <p className="mx-auto mt-3 max-w-[540px] text-sm leading-6 text-slate-400">{t("about.intro")}</p>
      </header>

      <ol className="relative space-y-4 before:absolute before:bottom-8 before:left-[17px] before:top-8 before:w-px before:bg-border">
        {steps.map((step) => <li key={step.number} className="relative flex gap-4">
          <span className="z-10 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand/30 bg-surface-2 text-[10px] font-bold text-brand-light">{step.number}</span>
          <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface-1 p-4">
            <h2 className="text-sm font-semibold text-slate-100">{t(step.title)}</h2>
            <p className="mt-1.5 text-xs leading-5 text-slate-400">{t(step.body)}</p>
          </div>
        </li>)}
      </ol>

      <section className="mt-10 overflow-hidden rounded-xl border border-border bg-surface-1">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-100">{t("about.glance")}</h2>
        <dl className="divide-y divide-border text-xs">
          <div className="grid grid-cols-[125px_1fr] gap-4 px-4 py-3"><dt className="text-slate-500">{t("about.network")}</dt><dd className="text-slate-200">Base Sepolia · USDC</dd></div>
          <div className="grid grid-cols-[125px_1fr] gap-4 px-4 py-3"><dt className="text-slate-500">{t("about.assessment")}</dt><dd className="text-slate-200">GenLayer finalized transactions</dd></div>
          <div className="grid grid-cols-[125px_1fr] gap-4 px-4 py-3"><dt className="text-slate-500">{t("about.wallets")}</dt><dd className="text-slate-200">User-owned embedded or linked EVM wallet</dd></div>
          <div className="grid grid-cols-[125px_1fr] gap-4 px-4 py-3"><dt className="text-slate-500">{t("about.outcomes")}</dt><dd className="text-slate-200">Bound to published terms, evidence policy, and finalized state</dd></div>
        </dl>
      </section>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/" className="rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-surface-3">{t("about.explore")}</Link>
        <Link href="/create" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark">{t("create.market")}</Link>
      </div>
    </div>
  </main>;
}
