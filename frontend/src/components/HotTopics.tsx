"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatUsdc } from "../lib/format";
import type { MarketData } from "./MarketCard";
import { Flame } from "lucide-react";
import clsx from "clsx";

interface HotTopicsProps {
  markets: MarketData[];
}

export default function HotTopics({ markets }: HotTopicsProps) {
  const t = useTranslations("hotTopics");

  const top = [...markets]
    .sort((a, b) => Number(b.yesPool + b.noPool) - Number(a.yesPool + a.noPool))
    .slice(0, 5);

  const breaking = markets
    .filter((m) => !m.resolved)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);

  return (
    <div className="space-y-4">
      {/* Breaking */}
      {breaking.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400 live-dot" />
              {t("breaking")}
            </h3>
            <Link href="/" className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
              {t("exploreAll")}
            </Link>
          </div>
          <div className="space-y-1">
            {breaking.map((m, i) => {
              const prob = Number(m.yesProbBps) / 100;
              return (
                <Link key={m.address} href={`/markets/${m.address}`}>
                  <div className="flex items-start gap-2.5 py-2 rounded-lg hover:bg-surface-2 px-2 -mx-2 transition-colors group cursor-pointer">
                    <span className="text-xs text-slate-600 font-mono mt-0.5 shrink-0">{i + 1}</span>
                    <p className="flex-1 text-xs text-slate-300 leading-snug line-clamp-2 group-hover:text-white transition-colors">
                      {m.question}
                    </p>
                    <span className={clsx("text-xs font-bold shrink-0 mt-0.5", prob >= 50 ? "text-yes" : "text-no")}>
                      {prob.toFixed(0)}%
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Hot by volume */}
      {top.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-1.5 mb-3">
            <Flame size={13} className="text-orange-400" />
            {t("hotTopics")}
          </h3>
          <div className="space-y-1">
            {top.map((m, i) => {
              const total = m.yesPool + m.noPool;
              const label = m.question.split(" ").slice(0, 3).join(" ") + "…";
              return (
                <Link key={m.address} href={`/markets/${m.address}`}>
                  <div className="flex items-center gap-2.5 py-2 rounded-lg hover:bg-surface-2 px-2 -mx-2 transition-colors cursor-pointer group">
                    <span className="text-xs text-slate-600 font-mono shrink-0 w-4">{i + 1}</span>
                    <p className="flex-1 text-xs text-slate-400 group-hover:text-slate-200 transition-colors truncate">{label}</p>
                    <span className="text-[11px] text-slate-500 shrink-0">${formatUsdc(total)}</span>
                    <Flame size={10} className="text-orange-400 shrink-0" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* GenLayer badge */}
      <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-brand/20 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-sm">🤖</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-brand-light mb-1">{t("aiResolved")}</p>
            <p className="text-[11px] text-slate-500 leading-relaxed">{t("aiResolvedDesc")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
