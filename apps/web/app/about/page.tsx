import Link from "next/link";

const steps = [
  { number: "01", title: "Propose a clear market", body: "Write an objective YES/NO question, define both outcomes, choose the close and resolution times, and attach authoritative sources. The API validates the proposal and prepares the fixed 2 USDC bond." },
  { number: "02", title: "Admissibility is decided", body: "After the bond is confirmed on Base Sepolia, the proposal enters a durable workflow. A GenLayer assessment is provisional until finality; only a finalized, successful result advances the proposal." },
  { number: "03", title: "Trade from your wallet", body: "Approved markets are activated with their published Pool or LMSR terms. Your Privy embedded wallet or linked external wallet signs transactions; Genetia does not custody your funds." },
  { number: "04", title: "Evidence drives resolution", body: "The market’s locked source and evidence policy guides resolution. Unresolved evidence gets its scheduled retry; technical failures are handled separately. Watchers verify finalized resolver state before Base settlement." },
];

export default function AboutPage() {
  return <main className="flex-1 bg-surface-0 px-4 py-10 text-slate-100 sm:px-6 sm:py-14">
    <div className="mx-auto max-w-[620px]">
      <header className="mb-10 text-center">
        <span className="inline-flex rounded-full border border-brand/30 bg-brand-muted px-3 py-1 text-[11px] font-medium text-brand-light">✦ &nbsp;Evidence-led prediction markets</span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">How Genetia works</h1>
        <p className="mx-auto mt-3 max-w-[540px] text-sm leading-6 text-slate-400">Markets trade on Base Sepolia and use GenLayer for admissibility and evidence-led resolution. Finality and settlement depend on the relevant network and protocol stages.</p>
      </header>

      <ol className="relative space-y-4 before:absolute before:bottom-8 before:left-[17px] before:top-8 before:w-px before:bg-border">
        {steps.map((step) => <li key={step.number} className="relative flex gap-4">
          <span className="z-10 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand/30 bg-surface-2 text-[10px] font-bold text-brand-light">{step.number}</span>
          <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface-1 p-4">
            <h2 className="text-sm font-semibold text-slate-100">{step.title}</h2>
            <p className="mt-1.5 text-xs leading-5 text-slate-400">{step.body}</p>
          </div>
        </li>)}
      </ol>

      <section className="mt-10 overflow-hidden rounded-xl border border-border bg-surface-1">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-slate-100">Protocol at a glance</h2>
        <dl className="divide-y divide-border text-xs">
          <div className="grid grid-cols-[125px_1fr] gap-4 px-4 py-3"><dt className="text-slate-500">Trading network</dt><dd className="text-slate-200">Base Sepolia · USDC</dd></div>
          <div className="grid grid-cols-[125px_1fr] gap-4 px-4 py-3"><dt className="text-slate-500">Assessment & resolution</dt><dd className="text-slate-200">GenLayer finalized transactions</dd></div>
          <div className="grid grid-cols-[125px_1fr] gap-4 px-4 py-3"><dt className="text-slate-500">Wallets</dt><dd className="text-slate-200">User-owned embedded or linked EVM wallet</dd></div>
          <div className="grid grid-cols-[125px_1fr] gap-4 px-4 py-3"><dt className="text-slate-500">Market outcomes</dt><dd className="text-slate-200">Bound to published terms, evidence policy, and finalized state</dd></div>
        </dl>
      </section>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/" className="rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-surface-3">Explore markets</Link>
        <Link href="/create" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark">Suggest a market</Link>
      </div>
    </div>
  </main>;
}
