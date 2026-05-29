import Link from "next/link";
import {
  Zap, Shield, Globe, ArrowRight,
  LayoutGrid, LineChart, Brain, Banknote,
  type LucideIcon,
} from "lucide-react";

const STEPS: Array<{ n: string; title: string; desc: string; Icon: LucideIcon }> = [
  {
    n: "01",
    title: "Suggest a market",
    desc: "Submit a yes/no question, resolution date, and the criteria GenLayer's AI will use to determine the outcome. Admins approve and publish it.",
    Icon: LayoutGrid,
  },
  {
    n: "02",
    title: "Trade YES or NO",
    desc: "Buy shares with USDC on Arc. Price discovery happens in real-time as traders take positions. Arc settles every trade in under a second.",
    Icon: LineChart,
  },
  {
    n: "03",
    title: "GenLayer resolves",
    desc: "When the market closes, a GenLayer Intelligent Contract fetches live data from the specified sources and uses an LLM to determine the outcome via Optimistic Democracy consensus.",
    Icon: Brain,
  },
  {
    n: "04",
    title: "Winners paid instantly",
    desc: "The outcome is bridged to Arc. Winners claim their proportional USDC share. No UMA voting, no challenge period - just atomic settlement.",
    Icon: Banknote,
  },
];

const COMPARE = [
  { feature: "Resolution",   genetia: "GenLayer AI validators",     poly: "UMA token holders"    },
  { feature: "Disputes",     genetia: "None - AI consensus",        poly: "Challenge periods"    },
  { feature: "Settlement",   genetia: "< 1 second (Arc)",           poly: "Hours (Polygon)"      },
  { feature: "Gas token",    genetia: "USDC (stable fees)",         poly: "MATIC (volatile)"     },
  { feature: "Finality",     genetia: "Deterministic",              poly: "Probabilistic"        },
  { feature: "Resolution $", genetia: "< $1 per market",           poly: "$50–$500+ in UMA"     },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      {/* Hero */}
      <div className="text-center mb-14">
        <div className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs text-brand-light mb-5">
          <Zap size={11} />
          AI-resolved prediction markets
        </div>
        <h1 className="text-4xl font-bold text-white mb-4 leading-tight">
          How Genetia works
        </h1>
        <p className="text-slate-400 text-base leading-relaxed max-w-xl mx-auto">
          Prediction markets with GenLayer AI resolution and Arc&apos;s USDC-native settlement - faster, cheaper, and smarter than anything that came before.
        </p>
      </div>

      {/* Steps */}
      <div className="relative mb-16">
        <div className="absolute left-[22px] top-8 bottom-8 w-px bg-gradient-to-b from-brand/40 via-brand/20 to-transparent" />
        <div className="space-y-6">
          {STEPS.map((s, i) => (
            <div key={i} className="flex gap-5 group">
              <div className="flex-none h-11 w-11 rounded-xl border border-brand/30 bg-brand/10 flex items-center justify-center z-10 shrink-0 group-hover:border-brand/60 transition-colors text-brand-light">
                <s.Icon size={18} />
              </div>
              <div className="rounded-2xl border border-border bg-surface-1 flex-1 px-5 py-4 group-hover:border-border-strong transition-colors">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-mono text-brand-light">{s.n}</span>
                  <h3 className="font-semibold text-white">{s.title}</h3>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* vs Polymarket comparison */}
      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden mb-10">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-bold text-white">Genetia vs. Polymarket</h2>
        </div>
        <div className="divide-y divide-border">
          <div className="grid grid-cols-3 px-5 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            <span>Feature</span>
            <span className="text-brand-light">Genetia</span>
            <span>Polymarket</span>
          </div>
          {COMPARE.map(({ feature, genetia, poly }) => (
            <div key={feature} className="grid grid-cols-3 px-5 py-3 text-sm">
              <span className="text-slate-400">{feature}</span>
              <span className="text-white font-medium">{genetia}</span>
              <span className="text-slate-500">{poly}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stack */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
        {[
          { icon: <Globe size={18} />, title: "Arc Network", desc: "EVM-compatible L1. USDC native gas. Sub-second deterministic finality. 30k+ TPS.", color: "text-blue-400 bg-blue-400/10 border-blue-400/20" },
          { icon: <Zap size={18} />,   title: "GenLayer",    desc: "Python Intelligent Contracts. Fetch live web data. LLM consensus via Optimistic Democracy.", color: "text-brand-light bg-brand/10 border-brand/20" },
          { icon: <Shield size={18} />, title: "Security",  desc: "Parimutuel pool. 2% protocol fee. Trusted resolver bridge (multisig upgrade planned).", color: "text-yes bg-yes/10 border-yes/20" },
        ].map(({ icon, title, desc, color }) => (
          <div key={title} className="rounded-2xl border border-border bg-surface-1 p-4">
            <div className={`h-9 w-9 rounded-xl border flex items-center justify-center mb-3 ${color}`}>
              {icon}
            </div>
            <h3 className="font-semibold text-white text-sm mb-1">{title}</h3>
            <p className="text-[12px] text-slate-500 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark transition-all shadow-lg shadow-brand/20"
        >
          Explore markets
          <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}
