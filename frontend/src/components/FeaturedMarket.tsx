"use client";

import Link from "next/link";
import { formatUsdc, timeUntil } from "../lib/format";
import type { MarketData } from "./MarketCard";
import { ArrowUpRight, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import clsx from "clsx";

interface FeaturedMarketProps {
  market: MarketData;
}

// Simple sparkline built from fake history — replace with real data later.
function ProbSparkline({ yesPct }: { yesPct: number }) {
  const pts = generateSparkPoints(yesPct);
  const w = 240, h = 56;
  const minV = Math.min(...pts) - 5;
  const maxV = Math.max(...pts) + 5;
  const range = maxV - minV || 1;

  const pathD = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - ((v - minV) / range) * h;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const fillD = `${pathD} L${w},${h} L0,${h} Z`;
  const isUp = pts[pts.length - 1] >= pts[0];

  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={isUp ? "#22c55e" : "#ef4444"} stopOpacity="0.25" />
          <stop offset="100%" stopColor={isUp ? "#22c55e" : "#ef4444"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill="url(#sparkFill)" />
      <path d={pathD} stroke={isUp ? "#22c55e" : "#ef4444"} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function generateSparkPoints(end: number): number[] {
  const n = 24;
  const pts: number[] = [];
  let v = 50;
  for (let i = 0; i < n; i++) {
    v += (Math.random() - 0.5) * 6;
    v = Math.max(5, Math.min(95, v));
    pts.push(v);
  }
  pts[n - 1] = end;
  return pts;
}

export default function FeaturedMarket({ market }: FeaturedMarketProps) {
  const t      = useTranslations("featured");
  const tm     = useTranslations("marketCard");
  const total  = market.yesPool + market.noPool;
  const yesPct = Number(market.yesProbBps) / 100;
  const noPct  = 100 - yesPct;

  return (
    <Link href={`/markets/${market.address}`}>
      <div className="relative rounded-2xl border border-border bg-surface-1 hover:border-border-strong transition-all overflow-hidden cursor-pointer group">
        {/* Background glow */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand/5 via-transparent to-transparent pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row gap-6 p-6">
          {/* Left — content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-3">
              <span className="flex items-center gap-1 text-xs font-medium text-yes">
                <span className="h-1.5 w-1.5 rounded-full bg-yes live-dot" />
                {t("live")}
              </span>
              <span className="text-xs text-slate-500">·</span>
              <span className="text-xs text-slate-500 capitalize">{market.category}</span>
              <span className="text-xs text-slate-500">·</span>
              <span className="text-xs text-slate-500">{timeUntil(market.endDate)}</span>
            </div>

            <h2 className="text-xl font-bold text-white mb-4 leading-snug group-hover:text-brand-light transition-colors line-clamp-2">
              {market.question}
            </h2>

            {/* YES / NO outcome blocks */}
            <div className="flex gap-3 mb-5">
              <div className="flex items-center gap-3 rounded-xl border border-yes/25 bg-yes/5 px-4 py-3">
                <div>
                  <p className="text-[11px] text-slate-400 mb-0.5">{tm("yes")}</p>
                  <p className="text-2xl font-bold text-yes leading-none">{yesPct.toFixed(1)}%</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-no/25 bg-no/5 px-4 py-3">
                <div>
                  <p className="text-[11px] text-slate-400 mb-0.5">{tm("no")}</p>
                  <p className="text-2xl font-bold text-no leading-none">{noPct.toFixed(1)}%</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
                <div>
                  <p className="text-[11px] text-slate-400 mb-0.5">{t("volume")}</p>
                  <p className="text-lg font-bold text-white leading-none">${formatUsdc(total)}</p>
                </div>
              </div>
            </div>

            {/* Prob bar */}
            <div className="h-2 rounded-full bg-surface-4 overflow-hidden mb-2">
              <div className="h-full rounded-full prob-bar-yes transition-all" style={{ width: `${yesPct}%` }} />
            </div>

            {/* Resolution info */}
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Zap size={11} className="text-brand-light" />
                {t("resolvedBy")}
              </span>
              <span>{t("settles")}</span>
            </div>
          </div>

          {/* Right — sparkline */}
          <div className="flex flex-col items-end justify-between shrink-0">
            <div className="opacity-70 group-hover:opacity-100 transition-opacity">
              <ProbSparkline yesPct={yesPct} />
            </div>
            <div className="flex items-center gap-1 text-sm font-medium text-brand-light group-hover:gap-2 transition-all">
              {t("trade")}
              <ArrowUpRight size={16} />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
