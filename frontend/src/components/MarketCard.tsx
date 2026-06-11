"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatUsdc } from "../lib/format";
import { categoryMeta } from "../lib/category-icons";
import clsx from "clsx";

export interface MarketData {
  address: string;
  question: string;
  category: string;
  endDate: bigint;
  yesPool: bigint;
  noPool: bigint;
  usdcVolume: number;   // actual USDC traded (sum of buy amounts)
  isFeatured: boolean;
  resolved: boolean;
  outcome: boolean;
  yesProbBps: bigint;
}

function timeUntilLocal(unix: bigint, t: ReturnType<typeof useTranslations<"time">>): string {
  const ms = Number(unix) * 1000 - Date.now();
  if (ms <= 0) return t("ended");
  const days = Math.floor(ms / 86_400_000);
  const hrs  = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 1) return t("daysLeft", { days });
  if (days === 1) return t("dayHoursLeft", { hrs });
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hrs > 0) return t("hoursLeft", { hrs, mins });
  return t("minsLeft", { mins });
}

export default function MarketCard({
  address, question, category, endDate,
  usdcVolume, resolved, outcome, yesProbBps,
}: MarketData) {
  const t     = useTranslations("marketCard");
  const tTime = useTranslations("time");
  const tCats = useTranslations("categories");

  const yesPct = Number(yesProbBps) / 100;
  const noPct  = 100 - yesPct;
  const meta   = categoryMeta(category);
  const isLive = !resolved && Number(endDate) * 1000 > Date.now();

  const categoryLabel = tCats(category as any) ?? category;

  return (
    <Link href={`/markets/${address}`} className="block group">
      <div className="rounded-2xl border border-border bg-surface-1 hover:border-border-strong hover:bg-surface-2 transition-all duration-200 overflow-hidden cursor-pointer">
        {/* Top row */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium", meta.color)}>
            <meta.Icon size={11} />
            {categoryLabel}
          </span>
          <div className="flex items-center gap-1.5">
            {isLive && (
              <span className="flex items-center gap-1 text-[11px] text-yes font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-yes live-dot" />
                {t("live")}
              </span>
            )}
            {resolved ? (
              <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", outcome ? "bg-yes/10 text-yes" : "bg-no/10 text-no")}>
                {outcome ? t("yes") : t("no")}
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">{timeUntilLocal(endDate, tTime)}</span>
            )}
          </div>
        </div>

        {/* Question */}
        <div className="px-4 pb-3">
          <p className="text-sm font-medium text-slate-100 leading-snug line-clamp-2 group-hover:text-white transition-colors">
            {question}
          </p>
        </div>

        {/* YES / NO boxes */}
        <div className="px-4 pb-3">
          <div className="flex gap-2">
            <div className={clsx(
              "flex-1 flex items-center justify-between rounded-xl px-3 py-2.5 border transition-colors",
              resolved && outcome
                ? "border-yes/40 bg-yes/10"
                : "border-border bg-surface-3 group-hover:border-yes/30"
            )}>
              <span className="text-xs font-medium text-slate-400">{t("yes")}</span>
              <span className="text-base font-bold text-yes">{yesPct.toFixed(0)}%</span>
            </div>
            <div className={clsx(
              "flex-1 flex items-center justify-between rounded-xl px-3 py-2.5 border transition-colors",
              resolved && !outcome
                ? "border-no/40 bg-no/10"
                : "border-border bg-surface-3 group-hover:border-no/30"
            )}>
              <span className="text-xs font-medium text-slate-400">{t("no")}</span>
              <span className="text-base font-bold text-no">{noPct.toFixed(0)}%</span>
            </div>
          </div>
        </div>

        {/* Bar */}
        <div className="px-4 pb-1">
          <div className="h-1 rounded-full bg-surface-4 overflow-hidden">
            <div className="h-full rounded-full prob-bar-yes transition-all duration-500" style={{ width: `${yesPct}%` }} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border mt-2">
          <span className="text-[11px] text-slate-500">${usdcVolume.toFixed(2)} {t("volume")}</span>
          <span className="text-[11px] text-slate-600 group-hover:text-slate-400 transition-colors font-medium">
            {t("trade")} →
          </span>
        </div>
      </div>
    </Link>
  );
}
