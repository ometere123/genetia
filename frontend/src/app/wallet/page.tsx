"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Wallet, ArrowDownToLine, ArrowUpFromLine, Copy, Check,
  ExternalLink, RefreshCw, Loader2, AlertCircle, CheckCircle2,
  Clock, TrendingUp, CreditCard, Shield, LayoutGrid,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "../../contexts/AuthContext";
import { useWithdraw } from "../../hooks/useCircleWallet";
import { QRCodeSVG } from "qrcode.react";
import clsx from "clsx";

type Tab = "overview" | "positions" | "deposit" | "withdraw" | "history";

interface PositionRow {
  marketId: string;
  marketTitle: string;
  marketStatus: string;
  lmsrStatus: string | null;
  arcAddress: string;
  yesShares: string;
  noShares: string;
  priceYes: number;
  estimatedValue: string;
  resolution: string | null;
}

interface TxRecord {
  id: string;
  type: string;
  amount: string;
  status: string;
  txHash?: string;
  createdAt: string;
  metadata?: Record<string, string>;
}

function formatUSDC(val: string | number | undefined): string {
  const n = typeof val === "string" ? parseFloat(val) : (val ?? 0);
  return isNaN(n) ? "0.00" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function txTypeLabel(type: string): string {
  const map: Record<string, string> = {
    DEPOSIT: "Deposit",
    WITHDRAWAL: "Withdrawal",
    BET_LOCK: "Bet placed",
    BET_RELEASE: "Bet released",
    PAYOUT: "Bet won",
    BET_LOSS: "Bet lost",
    FEE: "Fee",
  };
  return map[type] ?? type;
}

function txTypeColor(type: string): string {
  if (type === "DEPOSIT" || type === "PAYOUT" || type === "BET_RELEASE") return "text-yes";
  if (type === "WITHDRAWAL" || type === "BET_LOSS") return "text-no";
  if (type === "BET_LOCK") return "text-yellow-400";
  return "text-slate-400";
}

function txTypeSign(type: string): string {
  if (type === "DEPOSIT" || type === "PAYOUT" || type === "BET_RELEASE") return "+";
  if (type === "WITHDRAWAL" || type === "BET_LOCK" || type === "BET_LOSS") return "−";
  return "";
}

function statusBadge(status: string) {
  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yes/10 px-2 py-0.5 text-[10px] font-medium text-yes">
        <CheckCircle2 size={9} /> Confirmed
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
        <AlertCircle size={9} /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-400">
      <Clock size={9} /> Pending
    </span>
  );
}

// ── Deposit tab ──────────────────────────────────────────────────────────────

function DepositTab() {
  const { genetiaWallet } = useAuth();
  const [copied, setCopied] = useState(false);

  const addr = genetiaWallet?.address;

  async function handleCopy() {
    if (!addr) return;
    await navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!addr) {
    return (
      <div className="rounded-xl bg-surface-2 border border-border p-8 text-center text-slate-500 text-sm">
        Wallet not yet provisioned. Sign in to create your Genetia Wallet.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-surface-2 border border-border p-5 text-center">
        <div className="inline-block rounded-2xl bg-white p-4 shadow-lg mb-4">
          <QRCodeSVG value={addr} size={140} level="M" bgColor="#ffffff" fgColor="#000000" />
        </div>
        <p className="text-xs text-slate-500 mb-3">Scan with your wallet app to deposit</p>

        <div className="flex items-center gap-2 rounded-xl bg-surface-3 border border-border px-3.5 py-3 text-left">
          <code className="flex-1 text-[11px] text-slate-300 font-mono break-all">{addr}</code>
          <button
            onClick={handleCopy}
            className={clsx(
              "shrink-0 h-8 w-8 flex items-center justify-center rounded-lg transition-all",
              copied ? "bg-yes/20 text-yes" : "bg-surface-4 text-slate-400 hover:text-white"
            )}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-surface-2 border border-border divide-y divide-border overflow-hidden text-sm">
        {[
          { label: "Network",     value: `${genetiaWallet?.blockchain ?? "ARC-TESTNET"}` },
          { label: "Asset",       value: "USDC (6 decimals)" },
          { label: "Wallet type", value: `Circle Developer-Controlled ${genetiaWallet?.accountType ?? "SCA"} Wallet` },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between px-4 py-3">
            <span className="text-slate-500 text-xs">{label}</span>
            <span className="text-slate-200 text-xs font-medium">{value}</span>
          </div>
        ))}
      </div>

      <a
        href="https://faucet.circle.com"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full rounded-xl border border-brand/30 bg-brand/5 py-3 text-sm font-medium text-brand-light hover:bg-brand/10 transition-all"
      >
        Get testnet USDC from Circle Faucet
        <ExternalLink size={13} />
      </a>

      <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 px-4 py-3 flex items-start gap-2.5">
        <AlertCircle size={13} className="text-yellow-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-yellow-300/80 leading-relaxed">
          Only send <strong>USDC on Arc Testnet</strong> to this address. Funds sent on other networks will be permanently lost.
        </p>
      </div>
    </div>
  );
}

// ── Withdraw tab ─────────────────────────────────────────────────────────────

function WithdrawTab() {
  const { genetiaWallet, balance, connectedWalletAddress } = useAuth();
  const { withdraw, isPending, error, success, reset } = useWithdraw();
  const [destination, setDestination] = useState(connectedWalletAddress ?? "");
  const [amount, setAmount]           = useState("");

  const available = parseFloat(balance.available ?? "0");

  // Silence unused-var warning while keeping the value accessible for future UI.
  void genetiaWallet;

  async function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    if (!destination || !amount) return;
    reset();
    await withdraw(destination, amount);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-surface-2 border border-border p-4 space-y-1">
        <p className="text-xs text-slate-500">Available to withdraw</p>
        <p className="text-2xl font-bold text-white">${formatUSDC(available)}</p>
        <p className="text-[11px] text-slate-500">USDC · Circle Smart Wallet</p>
      </div>

      <form onSubmit={handleWithdraw} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">
            Destination address (Arc Testnet)
          </label>
          <input
            type="text"
            placeholder="0x..."
            value={destination}
            onChange={(e) => { setDestination(e.target.value); reset(); }}
            className="w-full rounded-xl bg-surface-2 border border-border px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-brand/50 focus:outline-none transition-colors font-mono"
            required
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-400">Amount (USDC)</label>
            <button
              type="button"
              onClick={() => { setAmount(available.toFixed(2)); reset(); }}
              className="text-[11px] text-slate-500 hover:text-brand-light transition-colors"
            >
              Max: ${formatUSDC(available)}
            </button>
          </div>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
            <input
              type="number"
              min="0.01"
              max={available}
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); reset(); }}
              className="w-full rounded-xl bg-surface-2 border border-border pl-8 pr-16 py-3 text-sm text-white placeholder:text-slate-600 focus:border-brand/50 focus:outline-none transition-colors"
              required
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">USDC</span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2.5 flex items-center gap-2">
            <AlertCircle size={13} className="text-red-400 shrink-0" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {success && (
          <div className="rounded-xl bg-yes/10 border border-yes/30 px-3 py-2.5 flex items-center gap-2">
            <CheckCircle2 size={13} className="text-yes shrink-0" />
            <p className="text-xs text-yes">Withdrawal submitted successfully.</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isPending || !destination || !amount || parseFloat(amount) > available}
          className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand/20"
        >
          {isPending && <Loader2 size={14} className="animate-spin" />}
          {isPending ? "Processing…" : "Withdraw USDC"}
        </button>
      </form>

      <p className="text-[11px] text-slate-600 text-center">
        Withdrawals are processed via Circle&apos;s secure transfer infrastructure.
        Processing time: 1–5 minutes.
      </p>
    </div>
  );
}

// ── Connected Wallet panel ───────────────────────────────────────────────────

/**
 * Displays the user's external (Privy-linked) wallet, clearly marked as
 * NOT the betting wallet. Used for login, account linking, funding,
 * and as a withdrawal destination only.
 */
function ConnectedWalletPanel() {
  const { connectedWalletAddress } = useAuth();
  if (!connectedWalletAddress) return null;
  return (
    <div className="rounded-xl bg-surface-2 border border-border p-4 space-y-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-300">Connected Wallet</span>
        <span className="text-[10px] text-slate-600 uppercase tracking-wider">
          login · funding · withdrawal
        </span>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Used for login, account linking, funding, and withdrawal destination. It is not your betting wallet.
      </p>
      <div className="flex items-center gap-2 rounded-lg bg-surface-3 px-3 py-2">
        <code className="flex-1 text-[11px] font-mono text-slate-400 break-all">
          {connectedWalletAddress}
        </code>
      </div>
    </div>
  );
}

// ── History tab ──────────────────────────────────────────────────────────────

function HistoryTab() {
  const { authenticated, authedFetch } = useAuth();
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [loading, setLoading]           = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    try {
      const res = await authedFetch("/api/wallets/transactions");
      if (!res.ok) return;
      const data = await res.json();
      setTransactions(data.transactions ?? []);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, [authenticated, authedFetch]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-slate-500 text-sm">
        <Loader2 size={14} className="animate-spin" />
        Loading history…
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="rounded-xl bg-surface-2 border border-border p-12 text-center text-slate-500 text-sm">
        No transactions yet. Deposit USDC to get started.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="grid grid-cols-[1fr_100px_90px_80px] gap-3 px-4 py-2.5 text-[11px] font-medium text-slate-500 border-b border-border bg-surface-2">
        <span>Type</span>
        <span className="text-right">Amount</span>
        <span className="text-center">Status</span>
        <span className="text-right">Date</span>
      </div>
      <div className="divide-y divide-border">
        {transactions.map((tx) => (
          <div
            key={tx.id}
            className="grid grid-cols-[1fr_100px_90px_80px] gap-3 px-4 py-3 items-center hover:bg-surface-2/50 transition-colors"
          >
            <div>
              <p className="text-sm text-slate-200">{txTypeLabel(tx.type)}</p>
              {tx.txHash && (
                <p className="text-[10px] text-slate-600 font-mono mt-0.5">
                  {tx.txHash.slice(0, 10)}…
                </p>
              )}
            </div>
            <p className={clsx("text-sm font-semibold text-right", txTypeColor(tx.type))}>
              {txTypeSign(tx.type)}${formatUSDC(tx.amount)}
            </p>
            <div className="flex justify-center">{statusBadge(tx.status)}</div>
            <p className="text-[11px] text-slate-500 text-right">
              {new Date(tx.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Positions tab ────────────────────────────────────────────────────────────

function PositionsTab() {
  const { authedFetch } = useAuth();
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/wallet/positions");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPositions(data.positions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load positions");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-slate-500 text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading positions…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg bg-no/10 border border-no/30 px-3 py-2 text-xs text-no flex items-start gap-2">
        <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
      </div>
    );
  }
  if (positions.length === 0) {
    return (
      <div className="rounded-xl bg-surface-2 border border-border p-10 text-center text-slate-500 text-sm">
        No open positions yet. Place a bet on a market to see it here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-slate-500">
          Live on-chain balances — sampled per request.
        </p>
        <button
          onClick={load}
          className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1"
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {positions.map((p) => {
        const yes = parseFloat(p.yesShares);
        const no  = parseFloat(p.noShares);
        const value = parseFloat(p.estimatedValue);
        const isFinalized = p.lmsrStatus === "Finalized";
        const isPending   = p.lmsrStatus === "Pending" || p.lmsrStatus === "Disputed";
        const winningSide = p.resolution; // "YES" | "NO" | "INVALID" | null

        return (
          <div key={p.marketId} className="rounded-2xl border border-border bg-surface-1 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <Link
                href={`/markets/${p.marketId}`}
                className="text-sm text-slate-100 hover:text-white leading-snug flex-1"
              >
                {p.marketTitle}
              </Link>
              <StatusChip status={p.lmsrStatus ?? "Active"} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <SideHolding side="YES" shares={yes} price={p.priceYes}     winning={winningSide === "YES"} />
              <SideHolding side="NO"  shares={no}  price={1 - p.priceYes} winning={winningSide === "NO"} />
            </div>

            <div className="rounded-lg bg-surface-2 border border-border px-3 py-2 flex items-center justify-between text-xs">
              <span className="text-slate-500">
                {isFinalized ? "Redeemable now" : "Estimated value"}
              </span>
              <span className="text-slate-100 font-semibold tabular-nums">
                ${value.toFixed(2)}
              </span>
            </div>

            {isFinalized && (
              <Link
                href={`/markets/${p.marketId}`}
                className="block w-full text-center rounded-lg bg-primary-500 hover:bg-primary-400 text-white text-xs font-semibold py-2"
              >
                Go to market to redeem
              </Link>
            )}
            {isPending && (
              <p className="text-[11px] text-slate-500 text-center">
                Resolution {p.lmsrStatus?.toLowerCase()} — redemption opens once finalized.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SideHolding({
  side, shares, price, winning,
}: {
  side: "YES" | "NO"; shares: number; price: number; winning: boolean;
}) {
  if (shares <= 0) {
    return (
      <div className="rounded-lg bg-surface-2 border border-border px-3 py-2.5">
        <p className="text-[10px] text-slate-600 mb-0.5">{side}</p>
        <p className="text-xs text-slate-600">no position</p>
      </div>
    );
  }
  return (
    <div className={clsx(
      "rounded-lg border px-3 py-2.5",
      winning
        ? side === "YES" ? "bg-yes/15 border-yes/40" : "bg-no/15 border-no/40"
        : side === "YES" ? "bg-yes/5 border-yes/20"  : "bg-no/5 border-no/20"
    )}>
      <div className="flex items-center justify-between mb-0.5">
        <span className={clsx("text-[10px] font-semibold", side === "YES" ? "text-yes" : "text-no")}>
          {side}
        </span>
        <span className="text-[10px] text-slate-500">@ {(price * 100).toFixed(1)}%</span>
      </div>
      <p className="text-sm font-bold text-white tabular-nums">{shares.toFixed(2)}</p>
      <p className="text-[10px] text-slate-500">shares</p>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const palette: Record<string, string> = {
    Active:    "bg-yes/10 text-yes",
    Pending:   "bg-yellow-500/10 text-yellow-400",
    Disputed:  "bg-orange-500/10 text-orange-400",
    Finalized: "bg-slate-500/10 text-slate-300",
  };
  return (
    <span className={clsx(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
      palette[status] ?? "bg-slate-500/10 text-slate-300"
    )}>
      {status}
    </span>
  );
}

// ── Main Wallet Page ─────────────────────────────────────────────────────────

export default function WalletPage() {
  const { isConnected, genetiaWallet, genetiaWalletLoading, balance, refreshGenetiaWallet, login } = useAuth();
  const [tab, setTab]           = useState<Tab>("overview");
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await refreshGenetiaWallet();
    setTimeout(() => setRefreshing(false), 600);
  }

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <div className="h-16 w-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center mx-auto mb-4">
          <Wallet size={28} className="text-slate-500" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Your Wallet</h2>
        <p className="text-sm text-slate-500 mb-6">
          Sign in to access your Genetia Wallet — the app wallet for deposits, balances, bets, settlement, winnings, and withdrawals.
        </p>
        <button
          onClick={login}
          className="rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark transition-all shadow-lg shadow-brand/20"
        >
          Sign in
        </button>
      </div>
    );
  }

  const available = parseFloat(balance.available ?? "0");
  const locked    = parseFloat(balance.locked    ?? "0");
  const pending   = parseFloat(balance.pending   ?? "0");
  const total     = available + locked + pending;

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "overview",  label: "Overview",  icon: Wallet },
    { key: "positions", label: "Positions", icon: LayoutGrid },
    { key: "deposit",   label: "Deposit",   icon: ArrowDownToLine },
    { key: "withdraw",  label: "Withdraw",  icon: ArrowUpFromLine },
    { key: "history",   label: "History",   icon: Clock },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard size={14} className="text-brand-light" />
            <span className="text-xs font-semibold text-brand-light uppercase tracking-wider">
              Genetia Wallet
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white">Genetia Wallet</h1>
          <p className="text-xs text-slate-500 mt-1">
            Your app wallet for deposits, balances, bets, settlement, winnings, and withdrawals.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="h-9 w-9 flex items-center justify-center rounded-lg border border-border text-slate-400 hover:text-white hover:bg-surface-2 transition-colors"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Balance card */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-surface-1 to-surface-2 p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-brand/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <p className="text-xs text-slate-500 mb-1">Total portfolio value</p>
        {genetiaWalletLoading && !genetiaWallet ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 size={18} className="animate-spin text-brand-light" />
            <span className="text-slate-400 text-sm">Loading…</span>
          </div>
        ) : (
          <p className="text-4xl font-bold text-white mb-4">${formatUSDC(total)}</p>
        )}

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Available",  value: available, color: "text-yes" },
            { label: "In bets",    value: locked,    color: "text-yellow-400" },
            { label: "Pending",    value: pending,   color: "text-slate-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl bg-surface-0/60 px-3 py-2.5">
              <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
              <p className={clsx("text-sm font-bold", color)}>${formatUSDC(value)}</p>
            </div>
          ))}
        </div>

        {genetiaWallet?.address && (
          <div className="mt-4 pt-4 border-t border-border/50 flex items-center gap-2">
            <Shield size={12} className="text-slate-600 shrink-0" />
            <p className="text-[11px] text-slate-600 font-mono">
              {genetiaWallet.address.slice(0, 16)}…{genetiaWallet.address.slice(-8)}
            </p>
            <a
              href={`https://testnet.arcscan.app/address/${genetiaWallet.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-slate-600 hover:text-slate-400 transition-colors"
            >
              <ExternalLink size={12} />
            </a>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        <div className="flex border-b border-border">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={clsx(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-xs font-medium transition-colors border-b-2 -mb-px",
                tab === key
                  ? "border-brand text-brand-light"
                  : "border-transparent text-slate-500 hover:text-white"
              )}
            >
              <Icon size={13} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === "overview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setTab("deposit")}
                  className="rounded-xl border border-brand/30 bg-brand/5 py-4 flex flex-col items-center gap-2 hover:bg-brand/10 transition-colors"
                >
                  <ArrowDownToLine size={20} className="text-brand-light" />
                  <span className="text-sm font-semibold text-white">Add Funds</span>
                  <span className="text-[11px] text-slate-500">Deposit USDC</span>
                </button>
                <button
                  onClick={() => setTab("withdraw")}
                  className="rounded-xl border border-border bg-surface-2 py-4 flex flex-col items-center gap-2 hover:bg-surface-3 transition-colors"
                >
                  <ArrowUpFromLine size={20} className="text-slate-400" />
                  <span className="text-sm font-semibold text-white">Withdraw</span>
                  <span className="text-[11px] text-slate-500">Send USDC out</span>
                </button>
              </div>

              <div className="rounded-xl bg-surface-2 border border-border p-4 space-y-2">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={13} className="text-brand-light" />
                  <span className="text-xs font-semibold text-slate-300">Genetia Wallet Info</span>
                </div>
                {[
                  { label: "Wallet type",   value: `Circle Developer-Controlled ${genetiaWallet?.accountType ?? "SCA"}` },
                  { label: "Network",       value: genetiaWallet?.blockchain ?? "ARC-TESTNET" },
                  { label: "Resolution",    value: "GenLayer Intelligent Contract" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{label}</span>
                    <span className="text-slate-300">{value}</span>
                  </div>
                ))}
              </div>

              <ConnectedWalletPanel />
            </div>
          )}
          {tab === "positions" && <PositionsTab />}
          {tab === "deposit"   && <DepositTab />}
          {tab === "withdraw"  && <WithdrawTab />}
          {tab === "history"   && <HistoryTab />}
        </div>
      </div>
    </div>
  );
}
