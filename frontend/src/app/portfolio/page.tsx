"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Wallet, TrendingUp, Trophy, ArrowUpRight, Loader2,
  CheckCircle2, Clock, Activity, CreditCard,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useTranslations } from "next-intl";
import clsx from "clsx";

interface BetRecord {
  id: string;
  side: "YES" | "NO";
  amount: string;
  odds: string;
  status: string;
  createdAt: string;
  settledAt?: string;
  market: {
    id: string;
    title: string;
    category: string;
    status: string;
    expiry: string;
    yesPool: string;
    noPool: string;
    settlement?: { resolution: string } | null;
  };
}

function fmt(n: string | number, decimals = 2): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  return isNaN(v) ? "0.00" : v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function timeUntil(dateStr: string): string {
  const ms = new Date(dateStr).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h`;
}

function betStatusBadge(bet: BetRecord) {
  if (bet.status === "won") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yes/15 px-2 py-0.5 text-[10px] font-semibold text-yes">
        <CheckCircle2 size={9} /> Won
      </span>
    );
  }
  if (bet.status === "lost") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-no/15 px-2 py-0.5 text-[10px] font-semibold text-no">
        ✗ Lost
      </span>
    );
  }
  if (bet.status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand-light">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-light live-dot" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-slate-400">
      {bet.status}
    </span>
  );
}

function computeCurrentOdds(bet: BetRecord): number {
  const yesPool = parseFloat(bet.market.yesPool);
  const noPool  = parseFloat(bet.market.noPool);
  const total   = yesPool + noPool;
  if (total === 0) return 50;
  return bet.side === "YES"
    ? (yesPool / total) * 100
    : (noPool / total) * 100;
}

function computePotentialPayout(bet: BetRecord): number {
  const amount   = parseFloat(bet.amount);
  const yesPool  = parseFloat(bet.market.yesPool);
  const noPool   = parseFloat(bet.market.noPool);
  const total    = yesPool + noPool;
  const myPool   = bet.side === "YES" ? yesPool : noPool;
  if (myPool === 0) return 0;
  return (amount / myPool) * total * 0.98;
}

export default function PortfolioPage() {
  const t = useTranslations("portfolio");
  const {
    isConnected, login, authenticated, authedFetch,
    genetiaWallet, genetiaWalletLoading, balance,
  } = useAuth();

  const [bets, setBets]         = useState<BetRecord[]>([]);
  const [loading, setLoading]   = useState(false);
  const [activeTab, setActiveTab] = useState<"active" | "closed">("active");

  const fetchBets = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    try {
      const res = await authedFetch("/api/bets/place");
      if (res.ok) {
        const data = await res.json();
        setBets(data.bets ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [authenticated, authedFetch]);

  useEffect(() => { fetchBets(); }, [fetchBets]);

  const active   = bets.filter((b) => b.status === "active");
  const closed   = bets.filter((b) => b.status !== "active");

  const totalLocked      = active.reduce((s, b) => s + parseFloat(b.amount), 0);
  const totalWon         = closed.filter((b) => b.status === "won").reduce((s, b) => s + computePotentialPayout(b), 0);
  const totalLost        = closed.filter((b) => b.status === "lost").reduce((s, b) => s + parseFloat(b.amount), 0);
  const totalPnl         = totalWon - totalLost;

  const available = parseFloat(balance.available ?? "0");

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <div className="h-16 w-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center mx-auto mb-4">
          <Wallet size={28} className="text-slate-500" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Your Portfolio</h2>
        <p className="text-sm text-slate-500 mb-6">
          Sign in to view your positions, bets, and Genetia Wallet balance.
        </p>
        <button
          onClick={login}
          className="rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark transition-all shadow-lg shadow-brand/20"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 space-y-6">
      {/* Profile header */}
      <div className="rounded-2xl border border-border bg-surface-1 p-6">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand to-indigo-400 flex items-center justify-center shrink-0">
              <span className="text-xl font-bold text-white">
                {(genetiaWallet?.address?.[2] ?? "G").toUpperCase()}
              </span>
            </div>
            <div>
              <p className="font-bold text-white text-lg">My Portfolio</p>
              {genetiaWallet?.address && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <CreditCard size={11} className="text-brand-light" />
                  <p className="text-xs text-slate-500 font-mono" title="Genetia Wallet">
                    {genetiaWallet.address.slice(0, 12)}…
                    {genetiaWallet.address.slice(-8)}
                  </p>
                </div>
              )}
            </div>
          </div>
          <Link
            href="/wallet"
            className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs text-slate-400 hover:text-white hover:border-border-strong transition-all"
          >
            Manage Wallet
            <ArrowUpRight size={12} />
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              icon: <Wallet size={14} />,
              label: t("usdcBalance"),
              value: genetiaWalletLoading && !genetiaWallet
                ? <Loader2 size={14} className="animate-spin text-slate-400" />
                : `$${fmt(available)}`,
              sub: "USDC · Genetia Wallet",
            },
            {
              icon: <Activity size={14} />,
              label: t("positionsValue"),
              value: `$${fmt(totalLocked)}`,
              sub: `${active.length} active position${active.length !== 1 ? "s" : ""}`,
            },
            {
              icon: <TrendingUp size={14} />,
              label: "Realised P&L",
              value: (
                <span className={totalPnl >= 0 ? "text-yes" : "text-no"}>
                  {totalPnl >= 0 ? "+" : ""}${fmt(Math.abs(totalPnl))}
                </span>
              ),
              sub: `${closed.length} settled bet${closed.length !== 1 ? "s" : ""}`,
            },
            {
              icon: <Trophy size={14} />,
              label: "Total Bets",
              value: bets.length,
              sub: `${closed.filter((b) => b.status === "won").length} won`,
            },
          ].map(({ icon, label, value, sub }) => (
            <div key={label} className="rounded-xl bg-surface-2 border border-border px-4 py-3">
              <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
                {icon}
                {label}
              </div>
              <p className="text-lg font-bold text-white">{value}</p>
              {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Bets table */}
      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        <div className="flex border-b border-border">
          {[
            { key: "active", label: t("active", { count: active.length }) },
            { key: "closed", label: t("closed", { count: closed.length }) },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as "active" | "closed")}
              className={clsx(
                "px-5 py-3.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                activeTab === key
                  ? "border-brand text-brand-light"
                  : "border-transparent text-slate-500 hover:text-white"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-slate-500 text-sm">
            <Loader2 size={14} className="animate-spin" /> {t("loading")}
          </div>
        ) : (activeTab === "active" ? active : closed).length === 0 ? (
          <div className="p-16 text-center">
            <p className="text-sm text-slate-500 mb-4">
              {activeTab === "active" ? t("noPositions") : t("closed", { count: 0 })}
            </p>
            {activeTab === "active" && (
              <Link
                href="/"
                className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark transition-colors"
              >
                {t("browseMarkets")}
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_60px_70px_80px_90px_70px] gap-3 px-5 py-3 text-[11px] font-medium text-slate-500 border-b border-border">
              <span>{t("market")}</span>
              <span className="text-center">{t("side")}</span>
              <span className="text-right">Staked</span>
              <span className="text-right">Potential</span>
              <span className="text-center">Status</span>
              <span className="text-right">
                {activeTab === "active" ? t("closes") : t("current")}
              </span>
            </div>

            {(activeTab === "active" ? active : closed).map((bet) => {
              const currentOdds  = computeCurrentOdds(bet);
              const potentialPay = computePotentialPayout(bet);

              return (
                <Link key={bet.id} href={`/markets/${bet.market.id}`}>
                  <div className="grid grid-cols-[1fr_60px_70px_80px_90px_70px] gap-3 px-5 py-4 border-b border-border hover:bg-surface-2/50 transition-colors cursor-pointer items-center">
                    <div>
                      <p className="text-sm text-slate-200 truncate pr-2">{bet.market.title}</p>
                      <span className="text-[10px] text-slate-600 bg-surface-3 rounded-full px-1.5 py-0.5">
                        {bet.market.category}
                      </span>
                    </div>

                    <div className="text-center">
                      <span className={clsx(
                        "rounded-full px-2 py-0.5 text-[11px] font-bold",
                        bet.side === "YES" ? "bg-yes/15 text-yes" : "bg-no/15 text-no"
                      )}>
                        {bet.side}
                      </span>
                    </div>

                    <p className="text-sm text-white font-semibold text-right">
                      ${fmt(bet.amount)}
                    </p>

                    <div className="text-right">
                      <p className={clsx(
                        "text-sm font-semibold",
                        bet.status === "won" ? "text-yes" : "text-slate-300"
                      )}>
                        ${fmt(potentialPay)}
                      </p>
                      <p className="text-[10px] text-slate-600">{currentOdds.toFixed(0)}% odds</p>
                    </div>

                    <div className="flex justify-center">
                      {betStatusBadge(bet)}
                    </div>

                    <p className="text-xs text-slate-500 text-right whitespace-nowrap">
                      {activeTab === "active"
                        ? timeUntil(bet.market.expiry)
                        : bet.settledAt
                          ? new Date(bet.settledAt).toLocaleDateString("en-US", {
                              month: "short", day: "numeric",
                            })
                          : "—"}
                    </p>
                  </div>
                </Link>
              );
            })}
          </>
        )}
      </div>

      {/* Empty state CTA */}
      {!loading && bets.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface-1 p-12 text-center">
          <div className="h-12 w-12 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto mb-4">
            <TrendingUp size={22} className="text-brand-light" />
          </div>
          <p className="text-white font-semibold mb-2">No bets yet</p>
          <p className="text-sm text-slate-500 mb-5">
            Browse prediction markets and place your first trade using your Circle Smart Wallet.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/"
              className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark transition-colors shadow-lg shadow-brand/20"
            >
              Browse markets
            </Link>
            <Link
              href="/wallet"
              className="rounded-xl border border-border bg-surface-2 px-5 py-2.5 text-sm font-medium text-slate-300 hover:text-white hover:border-border-strong transition-all"
            >
              Add funds
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
