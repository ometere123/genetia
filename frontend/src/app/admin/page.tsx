"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Shield, BarChart3, TrendingUp, CheckCircle2, Clock, Plus,
  AlertTriangle, Loader2, RefreshCw, Users, DollarSign, Activity,
  Gavel, ChevronRight, X, ToggleLeft, ToggleRight, Search,
  ArrowUpRight, Eye, Lock, ExternalLink, Inbox, ThumbsUp, ThumbsDown,
} from "lucide-react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth } from "../../contexts/AuthContext";
import clsx from "clsx";

const ADMIN_ADDRESS = (process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? "").toLowerCase();

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: string | number | undefined, decimals = 2): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  return isNaN(v) ? "0.00" : v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function StatCard({
  icon: Icon, label, value, sub, color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={15} />
        </div>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Market {
  id: string;
  title: string;
  category: string;
  status: string;
  expiry: string;
  yesPool: string;
  noPool: string;
  arcAddress?: string | null;
  createdAt: string;
  _count?: { arcTrades: number };
  settlement?: {
    resolution: string;
    reasoning?: string;
    confidence?: number;
    settledAt: string;
  } | null;
}

interface AdminUser {
  id: string;
  email?: string;
  primaryExternalWallet?: string;
  genetiaWalletAddress?: string;
  genetiaWalletBlockchain?: string;
  linkedWalletCount?: number;
  createdAt: string;
  walletBalance?: {
    availableBalance: string;
    lockedBalance: string;
  };
  _count: { bets: number; transactions: number };
}

interface Analytics {
  users: { total: number };
  markets: { total: number; open: number; resolved: number };
  bets: { total: number; active: number };
  volume: { total: string; totalPayouts: string };
  treasury: {
    lockedFunds: string;
    availableFunds: string;
    pendingFunds: string;
    totalCustody: string;
  };
}

interface Settlement {
  id: string;
  resolution: string;
  reasoning?: string;
  confidence?: number;
  genlayerTxHash?: string;
  settledAt: string;
  market: {
    id: string;
    title: string;
    category: string;
    yesPool: string;
    noPool: string;
  };
}

// ── Resolve Dialog ────────────────────────────────────────────────────────────

function ResolveDialog({
  market,
  onClose,
  onResolved,
}: {
  market: Market;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [reasoning, setReasoning]   = useState("");
  const [isPending, setIsPending]   = useState(false);
  const [success, setSuccess]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  async function handleRefund() {
    setIsPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/markets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "refund",
          marketId: market.id,
          reason: reasoning || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.refunded) {
        setSuccess(true);
        setTimeout(() => { onClose(); onResolved(); }, 1500);
      } else {
        setError(data.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-1 shadow-2xl p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-white">Wind down market</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Refund all active bets and mark the market closed. Used for
              legacy markets whose contract pre-dates the LMSR cutover.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="rounded-xl bg-surface-2 border border-border p-3">
          <p className="text-sm text-slate-200 leading-snug">{market.title}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Pool: ${fmt(parseFloat(market.yesPool) + parseFloat(market.noPool))} USDC
            · {market._count?.arcTrades ?? 0} trades
          </p>
        </div>

        <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-200">
          For new LMSR markets, resolution is automatic via GenLayer.
          Use this only for stuck legacy markets. Active bets are refunded
          at full stake; the on-chain contract is left untouched.
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">
            Reason (optional — saved on the settlement record)
          </label>
          <textarea
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            rows={2}
            placeholder="Legacy parimutuel market wind-down"
            className="w-full rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-brand/50 focus:outline-none resize-none"
          />
        </div>

        {error && (
          <div className="rounded-xl bg-no/10 border border-no/30 p-3 text-xs text-no">
            {error}
          </div>
        )}

        {success ? (
          <div className="rounded-xl bg-yes/10 border border-yes/30 p-3 text-center">
            <p className="text-sm font-semibold text-yes">Market refunded.</p>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-border py-2.5 text-sm text-slate-300 hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRefund}
              disabled={isPending}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 size={14} className="animate-spin" />}
              {isPending ? "Refunding…" : "Refund & close"}
            </button>
          </div>
        )}

        <p className="text-[11px] text-yellow-500/80 flex items-center gap-1.5">
          <AlertTriangle size={11} />
          This distributes payouts from locked funds immediately.
        </p>
      </div>
    </div>
  );
}

// ── Create Market Dialog ──────────────────────────────────────────────────────

function CreateMarketDialog({
  onClose,
  onCreated,
  createdBy,
}: {
  onClose: () => void;
  onCreated: () => void;
  createdBy: string;
}) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "politics",
    expiry: "",
    resolutionSource: "",
  });
  const [isPending, setIsPending] = useState(false);
  const [error, setError]         = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.expiry) return;
    setIsPending(true);
    setError("");
    try {
      const res = await fetch("/api/markets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          expiry: new Date(form.expiry).toISOString(),
          createdBy,
        }),
      });
      const data = await res.json();
      if (res.ok && data.market) {
        onClose();
        onCreated();
      } else {
        setError(data.error ?? "Failed to create market");
      }
    } catch {
      setError("Network error");
    } finally {
      setIsPending(false);
    }
  }

  const CATEGORIES = ["politics", "crypto", "sports", "tech", "economics", "science", "culture"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface-1 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div>
            <h3 className="font-bold text-white">Create Market</h3>
            <p className="text-xs text-slate-500 mt-0.5">Published immediately as active</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Question</label>
            <textarea
              required
              rows={2}
              placeholder="Will Bitcoin exceed $150k by end of 2025?"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-xl bg-surface-2 border border-border px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-brand/50 focus:outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Description</label>
            <textarea
              required
              rows={3}
              placeholder="Describe what counts as YES resolution…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-xl bg-surface-2 border border-border px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-brand/50 focus:outline-none resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-white focus:border-brand/50 focus:outline-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-surface-3">
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Expiry date</label>
              <input
                type="datetime-local"
                required
                value={form.expiry}
                onChange={(e) => setForm({ ...form, expiry: e.target.value })}
                className="w-full rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-white focus:border-brand/50 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Resolution source URL (for GenLayer)
            </label>
            <input
              type="url"
              placeholder="https://example.com/data-source"
              value={form.resolutionSource}
              onChange={(e) => setForm({ ...form, resolutionSource: e.target.value })}
              className="w-full rounded-xl bg-surface-2 border border-border px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-brand/50 focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle size={12} /> {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-border py-2.5 text-sm text-slate-300 hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40 transition-all flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 size={14} className="animate-spin" />}
              {isPending ? "Creating…" : "Publish Market"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tab: Markets ──────────────────────────────────────────────────────────────

/**
 * Per-row force-resolve trigger for the admin Markets table.
 *
 * Fires `Market.adminResolve(outcome)` on chain via the existing
 * /api/admin/dispute-resolve endpoint. The contract accepts adminResolve
 * from any non-finalized state (Active, Pending, Disputed), so this works
 * even on markets that haven't expired yet — useful for testnet smoke
 * tests where we want to fast-forward to redemption.
 */
function ForceResolveButtons({
  marketId, onResolved,
}: {
  marketId: string;
  onResolved: () => void;
}) {
  const { authedFetch } = useAuth();
  const [busy, setBusy] = useState<"YES" | "NO" | "INVALID" | null>(null);
  const [open, setOpen] = useState(false);

  async function resolve(outcome: "YES" | "NO" | "INVALID") {
    if (!confirm(`Force-resolve this market as ${outcome}? This calls Market.adminResolve on Arc and is final.`)) return;
    setBusy(outcome);
    try {
      const r = await authedFetch("/api/admin/dispute-resolve", {
        method: "POST",
        body: JSON.stringify({ marketId, outcome }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setOpen(false);
      // Refresh after the indexer has had a moment to mirror AdminResolved.
      setTimeout(onResolved, 2_000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Resolve failed");
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="h-7 px-2 flex items-center gap-1 rounded-lg bg-orange-500/10 border border-orange-500/20 text-[11px] text-orange-400 hover:bg-orange-500/20 transition-colors"
        title="Force resolve on-chain (testnet shortcut, skips GenLayer + dispute window)"
      >
        <Gavel size={11} /> Force resolve
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => resolve("YES")}
        disabled={busy !== null}
        className="h-7 px-2 flex items-center rounded-lg bg-yes/15 hover:bg-yes/25 text-[10px] font-semibold text-yes disabled:opacity-50"
      >
        {busy === "YES" ? "…" : "YES"}
      </button>
      <button
        onClick={() => resolve("NO")}
        disabled={busy !== null}
        className="h-7 px-2 flex items-center rounded-lg bg-no/15 hover:bg-no/25 text-[10px] font-semibold text-no disabled:opacity-50"
      >
        {busy === "NO" ? "…" : "NO"}
      </button>
      <button
        onClick={() => resolve("INVALID")}
        disabled={busy !== null}
        className="h-7 px-2 flex items-center rounded-lg bg-surface-3 hover:bg-surface-4 text-[10px] font-semibold text-slate-300 disabled:opacity-50"
      >
        {busy === "INVALID" ? "…" : "INV"}
      </button>
      <button
        onClick={() => setOpen(false)}
        disabled={busy !== null}
        className="h-7 px-2 flex items-center rounded-lg bg-surface-2 text-[10px] text-slate-500 hover:text-slate-300"
      >
        ✕
      </button>
    </>
  );
}

function MarketsTab({
  markets,
  loading,
  onRefresh,
  onResolve,
  createdBy,
}: {
  markets: Market[];
  loading: boolean;
  onRefresh: () => void;
  onResolve: (m: Market) => void;
  createdBy: string;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [q, setQ]                   = useState("");
  const [filter, setFilter]         = useState("all");

  const filtered = markets.filter((m) => {
    const matchQ = !q || m.title.toLowerCase().includes(q.toLowerCase());
    const matchF = filter === "all" || m.status === filter;
    return matchQ && matchF;
  });

  async function togglePause(m: Market) {
    await fetch("/api/admin/markets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "pause",
        marketId: m.id,
        pause: m.status === "active",
      }),
    });
    onRefresh();
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search markets…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface-2 border border-border text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-brand/50"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-xl bg-surface-2 border border-border px-3 py-2 text-sm text-slate-200 focus:outline-none"
        >
          {["all", "active", "paused", "resolved", "pending"].map((s) => (
            <option key={s} value={s} className="bg-surface-3">
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark transition-all shadow-lg shadow-brand/20"
        >
          <Plus size={14} />
          Create
        </button>
      </div>

      <div className="rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-2/50">
          <span className="text-xs text-slate-500">{filtered.length} markets</span>
          <button onClick={onRefresh} className="text-slate-500 hover:text-white transition-colors">
            <RefreshCw size={13} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-slate-500 text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">No markets found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Question", "Category", "Pool", "Bets", "Status", "Expiry", "Actions"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((m) => {
                  const pool   = parseFloat(m.yesPool) + parseFloat(m.noPool);
                  const isPast = new Date(m.expiry) < new Date();
                  return (
                    <tr key={m.id} className="hover:bg-surface-2/50 transition-colors group">
                      <td className="px-4 py-3 max-w-xs">
                        <p className="text-slate-200 text-xs leading-snug line-clamp-2 group-hover:text-white">
                          {m.title}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-slate-400">
                          {m.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        ${fmt(pool)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {m._count?.arcTrades ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        {m.status === "resolved" ? (
                          <span className={clsx(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            m.settlement?.resolution === "YES"
                              ? "bg-yes/10 text-yes"
                              : "bg-no/10 text-no"
                          )}>
                            <CheckCircle2 size={10} />
                            {m.settlement?.resolution ?? "Resolved"}
                          </span>
                        ) : m.status === "refunded" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-600/20 px-2 py-0.5 text-[11px] text-slate-400">
                            Refunded
                          </span>
                        ) : m.status === "paused" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-600/20 px-2 py-0.5 text-[11px] text-slate-400">
                            Paused
                          </span>
                        ) : isPast ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-[11px] text-yellow-400">
                            <AlertTriangle size={10} /> Expired
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-yes/10 px-2 py-0.5 text-[11px] text-yes">
                            <span className="h-1.5 w-1.5 rounded-full bg-yes live-dot" />
                            Live
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(m.expiry).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/markets/${m.id}`}
                            className="h-7 px-2 flex items-center gap-1 rounded-lg bg-surface-3 text-[11px] text-slate-300 hover:text-white transition-colors"
                          >
                            <Eye size={11} />
                          </Link>
                          {m.status !== "resolved" && m.status !== "refunded" && (
                            <>
                              <button
                                onClick={() => togglePause(m)}
                                className="h-7 px-2 flex items-center gap-1 rounded-lg bg-surface-3 text-[11px] text-slate-400 hover:text-white transition-colors"
                                title={m.status === "active" ? "Pause" : "Unpause"}
                              >
                                {m.status === "active"
                                  ? <ToggleLeft size={13} />
                                  : <ToggleRight size={13} className="text-brand-light" />}
                              </button>
                              {m.arcAddress ? (
                                <ForceResolveButtons marketId={m.id} onResolved={onRefresh} />
                              ) : (
                                <button
                                  onClick={() => onResolve(m)}
                                  className="h-7 px-2 flex items-center gap-1 rounded-lg bg-orange-500/10 border border-orange-500/20 text-[11px] text-orange-400 hover:bg-orange-500/20 transition-colors"
                                  title="Wind down legacy market (refund active bets, mark closed)"
                                >
                                  <Gavel size={11} /> Wind down
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateMarketDialog
          onClose={() => setShowCreate(false)}
          onCreated={onRefresh}
          createdBy={createdBy}
        />
      )}
    </>
  );
}

// ── Tab: Users ────────────────────────────────────────────────────────────────

function UsersTab() {
  const { authedFetch } = useAuth();
  const [users, setUsers]   = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ]             = useState("");

  const fetchUsers = useCallback(async (search = "") => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/admin/users?limit=50&q=${encodeURIComponent(search)}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by email or wallet address…"
            value={q}
            onChange={(e) => { setQ(e.target.value); fetchUsers(e.target.value); }}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface-2 border border-border text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-brand/50"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-surface-2/50">
          <span className="text-xs text-slate-500">{users.length} users</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-slate-500 text-sm">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["User", "Auth", "Circle Wallet", "Available", "Locked", "Bets", "Joined"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-2/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-xs text-slate-200">
                        {u.email || u.primaryExternalWallet?.slice(0, 10) + "…" || u.id.slice(0, 10)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-slate-400">
                        {u.email ? "email" : u.primaryExternalWallet ? "wallet" : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.genetiaWalletAddress ? (
                        <span className="text-[11px] font-mono text-slate-500">
                          {u.genetiaWalletAddress.slice(0, 8)}…{u.genetiaWalletAddress.slice(-6)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-yes">
                      ${fmt(u.walletBalance?.availableBalance ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-xs text-yellow-400">
                      ${fmt(u.walletBalance?.lockedBalance ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {u._count.bets}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(u.createdAt).toLocaleDateString("en-US", {
                        month: "short", day: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Tab: Treasury ─────────────────────────────────────────────────────────────

interface TreasuryMarketRow {
  marketId: string;
  title: string;
  arcAddress: string;
  marketIdOnChain: string;
  lmsrB: string;
  status: string;
  lmsrStatus: string | null;
  finalOutcome: string | null;
  contractBalance: string;
  collateral: string;
  feesAccrued: string;
  redemptionReserve: string;
  sweepableCollateral: string;
  collateralReady: boolean;
  graceRemainingSec: number;
}
interface TreasuryResponse {
  treasury: { address: string; usdcBalance: string; rpcSource: string };
  totals: {
    marketsTracked: number;
    totalContractBalance: string;
    totalCollateral: string;
    totalFees: string;
    totalReserve: string;
    totalSweepable: string;
  };
  markets: TreasuryMarketRow[];
}

function formatGrace(sec: number): string {
  if (sec <= 0) return "ready";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function TreasuryTab() {
  const { authedFetch } = useAuth();
  const [data, setData] = useState<TreasuryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<"fees" | "collateral" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await authedFetch("/api/admin/treasury");
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);
  useEffect(() => { load(); }, [load]);

  async function sweep(marketId: string, kind: "fees" | "collateral") {
    if (!confirm(`Sweep ${kind} from this market to treasury?`)) return;
    setBusyId(marketId);
    setBusyKind(kind);
    setError(null);
    try {
      const r = await authedFetch("/api/admin/treasury/sweep", {
        method: "POST",
        body: JSON.stringify({ marketId, kind }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      // Wait a beat for the chain state to settle before reloading
      setTimeout(() => load(), 2_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sweep failed");
      setBusyId(null);
      setBusyKind(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-slate-500 text-sm">
        <Loader2 size={14} className="animate-spin" /> Reading on-chain state…
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="rounded-lg bg-no/10 border border-no/30 px-3 py-2 text-xs text-no">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const { treasury, totals, markets } = data;

  return (
    <div className="space-y-5">
      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { label: "Treasury wallet", value: `$${fmt(treasury.usdcBalance)}`, sub: treasury.address ? `${treasury.address.slice(0,8)}…${treasury.address.slice(-6)}` : "not configured", subHref: treasury.address ? `https://testnet.arcscan.app/address/${treasury.address}` : null, icon: DollarSign, color: "bg-brand/10 text-brand-light" },
          { label: "Deployed in markets (collateral)", value: `$${fmt(totals.totalCollateral)}`, sub: `${totals.marketsTracked} markets`, subHref: null, icon: TrendingUp, color: "bg-yes/10 text-yes" },
          { label: "Fees accrued (un-swept)", value: `$${fmt(totals.totalFees)}`, sub: "across all market contracts", subHref: null, icon: ArrowUpRight, color: "bg-purple-400/10 text-purple-400" },
          { label: "Sweepable collateral", value: `$${fmt(totals.totalSweepable)}`, sub: "finalized + past grace", subHref: null, icon: Lock, color: "bg-yellow-500/10 text-yellow-400" },
        ] as const).map(({ label, value, sub, subHref, icon: Icon, color }) => (
          <div key={label} className="rounded-2xl border border-border bg-surface-1 p-5">
            <div className="flex items-start justify-between mb-3">
              <span className="text-xs text-slate-500">{label}</span>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${color}`}>
                <Icon size={15} />
              </div>
            </div>
            <p className="text-xl font-bold text-white">{value}</p>
            {subHref ? (
              <a
                href={subHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-slate-500 mt-1 truncate hover:text-brand-light inline-flex items-center gap-1"
              >
                {sub} <ExternalLink size={9} />
              </a>
            ) : (
              <p className="text-[10px] text-slate-500 mt-1 truncate">{sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* Reconciliation */}
      <div className="rounded-2xl border border-border bg-surface-1 p-5 space-y-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-white">Reconciliation</h3>
          <button onClick={load} className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
        {[
          { label: "Treasury wallet on-chain",        value: `$${fmt(treasury.usdcBalance)}` },
          { label: "Sum of contracts (collateral + fees)", value: `$${fmt(totals.totalContractBalance)}` },
          { label: "Outstanding redemption obligation", value: `$${fmt(totals.totalReserve)}` },
          { label: "Available to sweep (collateral, ready)", value: `$${fmt(totals.totalSweepable)}` },
          { label: "Available to sweep (fees, anytime)",     value: `$${fmt(totals.totalFees)}` },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
            <span className="text-sm text-slate-400">{label}</span>
            <span className="text-sm font-semibold text-white tabular-nums">{value}</span>
          </div>
        ))}
        <p className="text-[10px] text-slate-500 mt-2">
          Treasury balance + sum of contracts = total protocol USDC at rest. Sweeping moves USDC from a market contract back to the treasury wallet.
        </p>
      </div>

      {/* Per-market table */}
      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Per-market balances ({markets.length})</h3>
        </div>
        {error && (
          <div className="px-5 py-2 text-xs text-no bg-no/10 border-b border-no/30">{error}</div>
        )}
        {markets.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-500 text-sm">No on-chain markets yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-slate-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Market</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-right px-4 py-2 font-medium">Seed (b)</th>
                <th className="text-right px-4 py-2 font-medium">Collateral</th>
                <th className="text-right px-4 py-2 font-medium">Reserve</th>
                <th className="text-right px-4 py-2 font-medium">Fees</th>
                <th className="text-right px-4 py-2 font-medium">Sweep collateral</th>
                <th className="text-right px-4 py-2 font-medium">Sweep fees</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {markets.map((m) => {
                const feesNum = parseFloat(m.feesAccrued);
                const sweepNum = parseFloat(m.sweepableCollateral);
                const isBusy = busyId === m.marketId;
                return (
                  <tr key={m.marketId} className="hover:bg-surface-2/50">
                    <td className="px-4 py-3">
                      <Link href={`/markets/${m.marketId}`} className="text-slate-200 hover:text-white truncate block max-w-xs">
                        {m.title}
                      </Link>
                      <span className="text-[10px] text-slate-500 font-mono">{m.arcAddress.slice(0,8)}…{m.arcAddress.slice(-6)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                        m.lmsrStatus === "Finalized"  ? "bg-yes/10 text-yes" :
                        m.lmsrStatus === "Pending"    ? "bg-yellow-500/10 text-yellow-400" :
                        m.lmsrStatus === "Disputed"   ? "bg-orange-500/10 text-orange-400" :
                                                        "bg-slate-500/15 text-slate-300"
                      )}>
                        {m.lmsrStatus ?? "?"}
                      </span>
                      {m.finalOutcome && (
                        <div className="text-[10px] text-slate-500 mt-0.5">→ {m.finalOutcome}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 tabular-nums">${fmt(m.lmsrB)}</td>
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums">${fmt(m.collateral)}</td>
                    <td className="px-4 py-3 text-right text-slate-500 tabular-nums">${fmt(m.redemptionReserve)}</td>
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums">${fmt(m.feesAccrued)}</td>
                    <td className="px-4 py-3 text-right">
                      {m.lmsrStatus !== "Finalized" ? (
                        <span className="text-[10px] text-slate-600">not finalized</span>
                      ) : m.graceRemainingSec > 0 ? (
                        <span className="text-[10px] text-slate-500">grace: {formatGrace(m.graceRemainingSec)}</span>
                      ) : sweepNum > 0 ? (
                        <button
                          onClick={() => sweep(m.marketId, "collateral")}
                          disabled={isBusy}
                          className="rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-[10px] font-semibold px-2 py-1 disabled:opacity-50"
                        >
                          {isBusy && busyKind === "collateral" ? "…" : `Sweep $${fmt(m.sweepableCollateral)}`}
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-600">nothing to sweep</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {feesNum > 0 ? (
                        <button
                          onClick={() => sweep(m.marketId, "fees")}
                          disabled={isBusy}
                          className="rounded-lg bg-yes/15 hover:bg-yes/25 text-yes text-[10px] font-semibold px-2 py-1 disabled:opacity-50"
                        >
                          {isBusy && busyKind === "fees" ? "…" : `Sweep $${fmt(m.feesAccrued)}`}
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[10px] text-slate-500 leading-relaxed">
        On-chain reads happen live on every refresh. Sweeps are admin-signed transactions to the
        Market contract; both go to the treasury wallet
        {treasury.address && (
          <> (<span className="font-mono">{treasury.address.slice(0,10)}…{treasury.address.slice(-8)}</span>)</>
        )}.
      </p>
    </div>
  );
}

// ── Tab: Review Queue ─────────────────────────────────────────────────────────

interface SuggestionRow {
  id: string;
  question: string;
  description?: string | null;
  category: string;
  expiry: string;
  criteria: string;
  sources: string[];
  status: string;
  rejectionReason?: string | null;
  createdAt: string;
  user: { id: string; email?: string | null; primaryExternalWallet?: string | null };
  market?: { id: string; status: string } | null;
}

function ReviewQueueTab({ onApproved }: { onApproved: () => void }) {
  const { authedFetch } = useAuth();
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [items, setItems] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/admin/suggestions?status=${filter}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body?.error ?? `HTTP ${res.status}`;
        setError(
          res.status === 401
            ? "Session expired — refresh the page to sign in again."
            : res.status === 403
            ? "Forbidden — this account is not an admin."
            : msg
        );
        setItems([]);
        return;
      }
      const data = await res.json();
      setItems(data.suggestions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load queue");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [authedFetch, filter]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  async function approve(id: string) {
    setBusyId(id);
    try {
      const res = await authedFetch("/api/admin/suggestions", {
        method: "POST",
        body: JSON.stringify({ action: "approve", suggestionId: id }),
      });
      if (res.ok) {
        await fetchQueue();
        onApproved();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("Reason for rejection (optional)?") ?? undefined;
    setBusyId(id);
    try {
      const res = await authedFetch("/api/admin/suggestions", {
        method: "POST",
        body: JSON.stringify({ action: "reject", suggestionId: id, reason }),
      });
      if (res.ok) await fetchQueue();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Inbox size={14} className="text-brand-light" />
            Public market suggestions
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Approve to publish · reject with a reason · admin edits will be persisted to the audit row.
          </p>
        </div>
        <div className="flex gap-1">
          {(["pending", "approved", "rejected", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={clsx(
                "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
                filter === s
                  ? "bg-brand/15 text-brand-light"
                  : "text-slate-500 hover:text-slate-300 hover:bg-surface-2"
              )}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-slate-500 text-sm">
          <Loader2 size={14} className="animate-spin" /> Loading queue…
        </div>
      ) : error ? (
        <div className="p-8 text-center text-sm">
          <p className="text-no mb-2">{error}</p>
          <button
            onClick={fetchQueue}
            className="text-[12px] text-brand-light hover:underline"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center text-sm text-slate-500">
          No {filter === "all" ? "" : filter} suggestions.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((s) => (
            <div key={s.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[10px] font-medium uppercase tracking-wider bg-surface-3 text-slate-400 rounded-full px-2 py-0.5">
                      {s.category}
                    </span>
                    <span className={clsx(
                      "text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5",
                      s.status === "pending"  && "bg-yellow-500/15 text-yellow-400",
                      s.status === "approved" && "bg-yes/15 text-yes",
                      s.status === "rejected" && "bg-no/15 text-no",
                    )}>
                      {s.status}
                    </span>
                    <span className="text-[10px] text-slate-600">
                      by {s.user.email ?? s.user.primaryExternalWallet ?? s.user.id.slice(0, 8) + "…"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-100 mb-1">{s.question}</p>
                  {s.description && <p className="text-[11px] text-slate-500 mb-2">{s.description}</p>}
                  <p className="text-[11px] text-slate-500 mb-2"><span className="text-slate-400">Criteria:</span> {s.criteria}</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {s.sources.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-brand-light hover:underline truncate max-w-[260px]">
                        {u.replace(/^https?:\/\//, "")}
                      </a>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-600">
                    Closes {new Date(s.expiry).toLocaleString()} · submitted {new Date(s.createdAt).toLocaleString()}
                  </p>
                  {s.status === "rejected" && s.rejectionReason && (
                    <p className="text-[11px] text-no/80 mt-1.5">Reason: {s.rejectionReason}</p>
                  )}
                  {s.status === "approved" && s.market && (
                    <p className="text-[11px] text-yes mt-1.5">Approved → market <code className="font-mono">{s.market.id.slice(0, 10)}…</code></p>
                  )}
                </div>

                {s.status === "pending" && (
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      onClick={() => approve(s.id)}
                      disabled={busyId === s.id}
                      className="flex items-center gap-1 rounded-lg bg-yes/15 hover:bg-yes/25 text-yes border border-yes/30 px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      {busyId === s.id ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
                      Approve
                    </button>
                    <button
                      onClick={() => reject(s.id)}
                      disabled={busyId === s.id}
                      className="flex items-center gap-1 rounded-lg bg-no/15 hover:bg-no/25 text-no border border-no/30 px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      <ThumbsDown size={12} />
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tab: Settlements ──────────────────────────────────────────────────────────

interface BackfillRow {
  marketId: string;
  title: string;
  resolution: string | null;
  skipped: boolean;
  skipReason?: string;
  payoutsInserted: number;
  lossesInserted: number;
  payoutsTotal: string;
  lossesTotal: string;
}
interface BackfillResponse {
  summary: {
    mode: string;
    marketsScanned: number;
    marketsBackfilled: number;
    marketsSkipped: number;
    totalPayoutRows: number;
    totalLossRows: number;
  };
  results: BackfillRow[];
}

function BackfillHistoryPanel() {
  const { authedFetch } = useAuth();
  const [running, setRunning]   = useState(false);
  const [resp, setResp]         = useState<BackfillResponse | null>(null);
  const [error, setError]       = useState<string | null>(null);

  async function run(commit: boolean) {
    setRunning(true);
    setError(null);
    try {
      const r = await authedFetch("/api/admin/backfill-history", {
        method: "POST",
        body: JSON.stringify({ commit }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setResp(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-5 mb-4">
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-slate-100">Backfill wallet history</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Adds missing PAYOUT / BET_LOSS rows for markets resolved before the fix.
            Insert-only, idempotent, balances are not touched.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => run(false)}
            disabled={running}
            className="rounded-lg bg-surface-3 hover:bg-surface-4 text-slate-200 text-xs font-medium px-3 py-1.5 disabled:opacity-50"
          >
            {running ? "…" : "Dry run"}
          </button>
          <button
            onClick={() => run(true)}
            disabled={running || !resp || resp.summary.mode !== "dry-run"}
            className="rounded-lg bg-purple-500 hover:bg-purple-400 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title={!resp ? "Dry run first" : ""}
          >
            Commit
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-no/10 border border-no/30 px-3 py-2 text-xs text-no">
          {error}
        </div>
      )}

      {resp && (
        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap text-[11px]">
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-slate-300">
              mode: <b>{resp.summary.mode}</b>
            </span>
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-slate-300">
              scanned: {resp.summary.marketsScanned}
            </span>
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-slate-300">
              backfilled: {resp.summary.marketsBackfilled}
            </span>
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-slate-300">
              skipped: {resp.summary.marketsSkipped}
            </span>
            <span className="rounded-full bg-yes/10 text-yes px-2 py-0.5">
              +{resp.summary.totalPayoutRows} PAYOUT
            </span>
            <span className="rounded-full bg-no/10 text-no px-2 py-0.5">
              +{resp.summary.totalLossRows} BET_LOSS
            </span>
          </div>

          <div className="rounded-xl border border-border divide-y divide-border">
            {resp.results.map((r) => (
              <div key={r.marketId} className="px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="text-slate-200 truncate">{r.title}</span>
                  {r.skipped ? (
                    <span className="text-slate-500 shrink-0">skipped</span>
                  ) : (
                    <span className="text-slate-400 shrink-0">{r.resolution}</span>
                  )}
                </div>
                {r.skipped ? (
                  <span className="text-slate-500">{r.skipReason}</span>
                ) : (
                  <span className="text-slate-500">
                    +{r.payoutsInserted} payout (${r.payoutsTotal}) · +{r.lossesInserted} loss (${r.lossesTotal})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface PendingMarket {
  id: string;
  title: string;
  lmsrStatus: string;
  proposedOutcome: string | null;
  pendingSince: string | null;
  disputeBondHolder: string | null;
  disputeBondAmount: string | null;
  arcAddress: string | null;
}

function DisputeResolvePanel() {
  const { authedFetch } = useAuth();
  const [markets, setMarkets] = useState<PendingMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await authedFetch("/api/admin/markets?lmsrStatus=Pending,Disputed");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setMarkets(data.markets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => { load(); }, [load]);

  async function resolve(marketId: string, outcome: "YES" | "NO" | "INVALID") {
    if (!confirm(`Override on-chain resolution to ${outcome}? This is final.`)) return;
    setSubmitting(marketId);
    setError(null);
    try {
      const r = await authedFetch("/api/admin/dispute-resolve", {
        method: "POST",
        body: JSON.stringify({ marketId, outcome }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-surface-1 p-5 mb-4 text-slate-500 text-xs flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> Checking pending/disputed markets…
      </div>
    );
  }
  if (markets.length === 0) return null;

  return (
    <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-5 mb-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-orange-200">
          {markets.length} market{markets.length === 1 ? "" : "s"} awaiting admin action
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          On-chain <code>adminResolve(outcome)</code> ends the dispute (or overrides
          the proposed outcome before the 24h window closes). Use INVALID for
          pro-rata refunds.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-no/10 border border-no/30 px-3 py-2 text-xs text-no">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {markets.map((m) => (
          <div key={m.id} className="rounded-xl bg-surface-1 border border-border p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-100 truncate">{m.title}</p>
                <div className="flex items-center gap-2 flex-wrap mt-1 text-[10px]">
                  <span className={clsx(
                    "rounded-full px-2 py-0.5",
                    m.lmsrStatus === "Disputed"
                      ? "bg-orange-500/15 text-orange-300"
                      : "bg-yellow-500/15 text-yellow-300"
                  )}>
                    {m.lmsrStatus}
                  </span>
                  {m.proposedOutcome && (
                    <span className="text-slate-500">
                      proposed: <span className="text-slate-300">{m.proposedOutcome}</span>
                    </span>
                  )}
                  {m.disputeBondHolder && (
                    <span className="text-slate-500">
                      bond: <span className="text-slate-300">${m.disputeBondAmount}</span> by{" "}
                      <span className="font-mono">{m.disputeBondHolder.slice(0, 8)}…</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              {(["YES", "NO", "INVALID"] as const).map((o) => (
                <button
                  key={o}
                  onClick={() => resolve(m.id, o)}
                  disabled={submitting === m.id}
                  className={clsx(
                    "flex-1 rounded-lg text-xs font-semibold py-2 disabled:opacity-50",
                    o === "YES"     ? "bg-yes/20 hover:bg-yes/30 text-yes" :
                    o === "NO"      ? "bg-no/20 hover:bg-no/30 text-no" :
                                      "bg-surface-3 hover:bg-surface-4 text-slate-300"
                  )}
                >
                  {submitting === m.id ? "…" : `Resolve ${o}`}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettlementsTab() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading]         = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/settlements")
      .then((r) => r.json())
      .then((d) => setSettlements(d.settlements ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-slate-500 text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading settlements…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DisputeResolvePanel />
      <BackfillHistoryPanel />
      {settlements.length === 0 ? (
        <div className="rounded-xl bg-surface-2 border border-border p-12 text-center text-slate-500 text-sm">
          No settlements yet. Markets appear here after GenLayer resolution.
        </div>
      ) : null}
      {settlements.map((s) => {
        const pool = parseFloat(s.market.yesPool) + parseFloat(s.market.noPool);
        return (
          <div key={s.id} className="rounded-2xl border border-border bg-surface-1 p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1">
                <p className="text-sm text-slate-200 leading-snug mb-1">{s.market.title}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-500 bg-surface-3 rounded-full px-2 py-0.5">
                    {s.market.category}
                  </span>
                  <span className="text-[11px] text-slate-500">Pool: ${fmt(pool)}</span>
                  <span className="text-[11px] text-slate-500">
                    {new Date(s.settledAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <span className={clsx(
                "shrink-0 rounded-xl px-3 py-1.5 text-sm font-bold",
                s.resolution === "YES"
                  ? "bg-yes/15 text-yes border border-yes/30"
                  : "bg-no/15 text-no border border-no/30"
              )}>
                {s.resolution}
              </span>
            </div>

            {s.reasoning && (
              <div className="rounded-xl bg-surface-2 border border-border px-4 py-3 mb-3">
                <p className="text-[11px] text-slate-500 mb-1 font-medium">GenLayer Reasoning</p>
                <p className="text-xs text-slate-300 leading-relaxed">{s.reasoning}</p>
              </div>
            )}

            <div className="flex items-center gap-4 flex-wrap">
              {s.confidence != null && (
                <div className="flex items-center gap-1.5">
                  <Activity size={11} className="text-brand-light" />
                  <span className="text-[11px] text-slate-400">
                    Confidence: <span className="text-white">{(s.confidence * 100).toFixed(0)}%</span>
                  </span>
                </div>
              )}
              {s.genlayerTxHash && (
                <a
                  href={`https://explorer-studio.genlayer.com/tx/${s.genlayerTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-brand-light hover:text-white transition-colors"
                >
                  GenLayer TX <ExternalLink size={10} />
                </a>
              )}
              <Link
                href={`/markets/${s.market.id}`}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors"
              >
                View market <ChevronRight size={11} />
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────

type AdminTab = "markets" | "queue" | "users" | "treasury" | "settlements";

export default function AdminPage() {
  const { connectedWalletAddress: address, isConnected } = useAuth();
  const { login, authenticated } = usePrivy();

  const [activeTab, setActiveTab]       = useState<AdminTab>("markets");
  const [markets, setMarkets]           = useState<Market[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [analytics, setAnalytics]       = useState<Analytics | null>(null);
  const [resolveTarget, setResolveTarget] = useState<Market | null>(null);

  const loggedIn  = isConnected || authenticated;
  const isAdmin   = loggedIn && !!address &&
    address.toLowerCase() === ADMIN_ADDRESS;

  const fetchMarkets = useCallback(async () => {
    setMarketsLoading(true);
    try {
      const res = await fetch("/api/markets?limit=100");
      if (res.ok) {
        const data = await res.json();
        setMarkets(data.markets ?? []);
      }
    } finally {
      setMarketsLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/analytics");
      if (res.ok) setAnalytics(await res.json());
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    fetchMarkets();
    fetchAnalytics();
  }, [isAdmin, fetchMarkets, fetchAnalytics]);

  // ── Auth gates ─────────────────────────────────────────────────────────────

  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="h-16 w-16 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mx-auto mb-4">
            <Shield size={28} className="text-brand-light" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Admin Dashboard</h1>
          <p className="text-sm text-slate-400 mb-6">Sign in with the admin account to continue.</p>
          <button
            onClick={login}
            className="rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark transition-colors shadow-lg shadow-brand/20"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="h-16 w-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <Shield size={28} className="text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-sm text-slate-400 mb-2">This dashboard is restricted to admin accounts.</p>
          {!ADMIN_ADDRESS && (
            <p className="text-xs text-yellow-400 mb-4">
              Set <code className="bg-surface-2 px-1 rounded">NEXT_PUBLIC_ADMIN_ADDRESS</code> in .env.local
            </p>
          )}
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
            ← Back to markets
          </Link>
        </div>
      </div>
    );
  }

  // ── Stats row ──────────────────────────────────────────────────────────────

  const openCount     = markets.filter((m) => m.status === "active").length;
  const resolvedCount = markets.filter((m) => m.status === "resolved").length;
  const totalVolume   = markets.reduce(
    (s, m) => s + parseFloat(m.yesPool) + parseFloat(m.noPool), 0
  );

  const TABS: { key: AdminTab; label: string; icon: React.ElementType }[] = [
    { key: "markets",     label: "Markets",      icon: BarChart3  },
    { key: "queue",       label: "Review Queue", icon: Inbox      },
    { key: "users",       label: "Users",        icon: Users      },
    { key: "treasury",    label: "Treasury",     icon: DollarSign },
    { key: "settlements", label: "Settlements",  icon: Gavel      },
  ];

  return (
    <>
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield size={16} className="text-brand-light" />
              <span className="text-xs font-semibold text-brand-light uppercase tracking-wider">
                Admin
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white">Operations Dashboard</h1>
            <p className="text-sm text-slate-500 mt-1">
              Markets · Users · Treasury · GenLayer Settlements
            </p>
          </div>
          <button
            onClick={() => { fetchMarkets(); fetchAnalytics(); }}
            className="h-9 w-9 flex items-center justify-center rounded-lg border border-border text-slate-400 hover:text-white hover:bg-surface-2 transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={BarChart3}
            label="Total Markets"
            value={markets.length}
            sub={`${openCount} live`}
            color="bg-brand/10 text-brand-light"
          />
          <StatCard
            icon={Clock}
            label="Open Markets"
            value={openCount}
            color="bg-yes/10 text-yes"
          />
          <StatCard
            icon={CheckCircle2}
            label="Resolved"
            value={resolvedCount}
            color="bg-purple-400/10 text-purple-400"
          />
          <StatCard
            icon={TrendingUp}
            label="Total Volume"
            value={`$${fmt(totalVolume)}`}
            sub={analytics ? `${analytics.bets.total} bets` : ""}
            color="bg-orange-400/10 text-orange-400"
          />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border mb-6 gap-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={clsx(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                activeTab === key
                  ? "border-brand text-brand-light"
                  : "border-transparent text-slate-500 hover:text-white"
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {activeTab === "markets" && (
          <MarketsTab
            markets={markets}
            loading={marketsLoading}
            onRefresh={fetchMarkets}
            onResolve={setResolveTarget}
            createdBy={address ?? "admin"}
          />
        )}
        {activeTab === "queue"       && <ReviewQueueTab onApproved={fetchMarkets} />}
        {activeTab === "users"       && <UsersTab />}
        {activeTab === "treasury"    && <TreasuryTab />}
        {activeTab === "settlements" && <SettlementsTab />}

        <div className="mt-6 flex items-center gap-2 text-xs text-slate-600">
          <Shield size={11} />
          Signed in as admin: <code className="font-mono text-slate-500">{address}</code>
        </div>
      </div>

      {resolveTarget && (
        <ResolveDialog
          market={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={fetchMarkets}
        />
      )}
    </>
  );
}
