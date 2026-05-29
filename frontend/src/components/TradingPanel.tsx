"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, ArrowDownUp, Wallet, CheckCircle2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { usePlaceBet, useExitBet, useClaim } from "../hooks/useCircleWallet";
import {
  priceAsFloat,
  priceYes,
  quoteBuy,
  quoteSell,
  type LMSRState,
} from "../lib/lmsr";
import clsx from "clsx";

/**
 * LMSR trading panel.
 *
 * Reads cached on-chain state (qYes, qNo, b) from the Market row and
 * computes prices locally with `lib/lmsr.ts` — the same math the contract
 * uses, so the displayed cost matches what the contract will actually
 * charge (give or take ~1 micro-USDC of rounding).
 */

export interface MarketInfo {
  id: string;
  title: string;
  status: string;
  /** "qYes" — outstanding YES shares (6-dec USDC string). */
  yesPool: string;
  /** "qNo"  — outstanding NO shares. */
  noPool: string;
  /** LMSR liquidity parameter, 6-dec USDC string. */
  lmsrB?: string | null;
  lmsrStatus?: string | null;
  proposedOutcome?: string | null;
  pendingSince?: string | null;
  settlement?: { resolution: string | null } | null;
}

type Side = "YES" | "NO";
type Mode = "buy" | "sell";

const QUICK_SHARES = ["5", "10", "25", "50"];
const ARC_EXPLORER_URL = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app";

// USDC has 6 decimals — input "12.34" → 12_340_000n
function toMicros(s: string): bigint {
  if (!s) return 0n;
  const [intPart, fracPart = ""] = s.split(".");
  const frac = (fracPart + "000000").slice(0, 6);
  return BigInt(intPart || "0") * 1_000_000n + BigInt(frac || "0");
}

function fmtUSDC(micros: bigint, dp = 2): string {
  const n = Number(micros) / 1_000_000;
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export default function TradingPanel({ market }: { market: MarketInfo }) {
  const { isConnected, balance, login, openDepositModal } = useAuth();
  const { placeBet, isPending: buyPending, error: buyError, reset: resetBuy } = usePlaceBet();
  const { exitBet, isPending: sellPending, error: sellError, reset: resetSell } = useExitBet();
  const { claim, isPending: claimPending, error: claimError, reset: resetClaim } = useClaim();

  const [mode, setMode] = useState<Mode>("buy");
  const [side, setSide] = useState<Side>("YES");
  const [shares, setShares] = useState("");
  const [slippageBps, setSlippageBps] = useState(500); // 5% default
  const [submittedTxId, setSubmittedTxId] = useState<string | null>(null);

  // ── Read on-chain state from Market row ─────────────────────────────────

  const state: LMSRState = useMemo(() => {
    const qYes = toMicros(market.yesPool);
    const qNo  = toMicros(market.noPool);
    const b    = market.lmsrB ? toMicros(market.lmsrB) : 100n * 1_000_000n;
    return { qYes, qNo, b };
  }, [market.yesPool, market.noPool, market.lmsrB]);

  const pY = priceAsFloat(priceYes(state));
  const pN = 1 - pY;

  // ── Trade quoting ───────────────────────────────────────────────────────

  const sharesMicros = useMemo(() => toMicros(shares), [shares]);

  // Only quote the side that's currently active so we don't try to sell
  // shares that don't exist on a fresh market.
  const buyQ = useMemo(() => {
    if (mode !== "buy" || sharesMicros <= 0n) return null;
    return quoteBuy(state, side === "YES" ? 1 : 0, sharesMicros);
  }, [mode, state, side, sharesMicros]);

  const sellQ = useMemo(() => {
    if (mode !== "sell" || sharesMicros <= 0n) return null;
    const q = side === "YES" ? state.qYes : state.qNo;
    if (sharesMicros > q) return null; // can't sell more than outstanding
    return quoteSell(state, side === "YES" ? 1 : 0, sharesMicros);
  }, [mode, state, side, sharesMicros]);

  // Slippage caps: buy = cost × (1 + slip), sell = return × (1 − slip)
  const maxCostMicros = buyQ
    ? (buyQ.costWithFee * (10_000n + BigInt(slippageBps))) / 10_000n
    : 0n;
  const minReturnMicros = sellQ
    ? (sellQ.netReturn * (10_000n - BigInt(slippageBps))) / 10_000n
    : 0n;

  // Effective price & impact for display
  const newPriceYes = useMemo(() => {
    if (!sharesMicros) return priceYes(state);
    if (mode === "buy" && buyQ) return buyQ.newPriceYes;
    if (mode === "sell" && sellQ) return sellQ.newPriceYes;
    return priceYes(state);
  }, [state, mode, buyQ, sellQ, sharesMicros]);

  const priceImpact = priceAsFloat(newPriceYes) - pY;

  const available = parseFloat(balance.available ?? "0");
  const needsDeposit = mode === "buy" && buyQ
    ? Number(buyQ.costWithFee) / 1_000_000 > available
    : false;

  // ── State machine ────────────────────────────────────────────────────────

  const resolved = market.lmsrStatus === "Finalized" || market.status === "resolved";
  const pending = market.lmsrStatus === "Pending";
  const disputed = market.lmsrStatus === "Disputed";
  const resolution = market.settlement?.resolution ?? market.proposedOutcome ?? null;

  // ── Handlers ────────────────────────────────────────────────────────────

  async function handleBuy() {
    if (!buyQ || sharesMicros === 0n) return;
    resetBuy();
    const maxCostStr = (Number(maxCostMicros) / 1_000_000).toFixed(6);
    const r = await placeBet(market.id, side, shares, maxCostStr);
    if (r) {
      setSubmittedTxId(r.circleTxId);
      setShares("");
    }
  }

  async function handleSell() {
    if (!sellQ || sharesMicros === 0n) return;
    resetSell();
    const minReturnStr = (Number(minReturnMicros) / 1_000_000).toFixed(6);
    const r = await exitBet(market.id, side, shares, minReturnStr);
    if (r) {
      setSubmittedTxId(r.circleTxId);
      setShares("");
    }
  }

  async function handleClaim() {
    resetClaim();
    const r = await claim(market.id);
    if (r) setSubmittedTxId(r.circleTxId);
  }

  // ── Resolved state ──────────────────────────────────────────────────────

  if (resolved) {
    return (
      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-white">Market resolved</h3>
        </div>
        <div className="p-5 space-y-4">
          <div className={clsx(
            "rounded-xl p-4 text-center border",
            resolution === "YES" ? "bg-yes/10 border-yes/30"
              : resolution === "NO" ? "bg-no/10 border-no/30"
              : "bg-surface-2 border-border"
          )}>
            <p className={clsx(
              "text-3xl font-bold mb-1",
              resolution === "YES" ? "text-yes"
                : resolution === "NO" ? "text-no"
                : "text-slate-300"
            )}>
              {resolution ?? "INVALID"}
            </p>
            <p className="text-xs text-slate-500">final outcome</p>
          </div>

          {isConnected ? (
            <button
              onClick={handleClaim}
              disabled={claimPending}
              className="w-full rounded-xl bg-primary-500 hover:bg-primary-400 disabled:opacity-50 text-white text-sm font-semibold py-3"
            >
              {claimPending ? <Loader2 size={14} className="inline animate-spin mr-2" /> : null}
              Redeem outcome tokens
            </button>
          ) : (
            <button
              onClick={login}
              className="w-full rounded-xl bg-primary-500 hover:bg-primary-400 text-white text-sm font-semibold py-3"
            >
              Connect to redeem
            </button>
          )}

          {claimError && <ErrorBanner msg={claimError} />}
          {submittedTxId && (
            <PendingTxBanner txId={submittedTxId} label="Redemption submitted" />
          )}
        </div>
      </div>
    );
  }

  // ── Pending / disputed state ────────────────────────────────────────────

  if (pending || disputed) {
    return (
      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-white">
            {disputed ? "Resolution disputed" : "Resolution pending"}
          </h3>
        </div>
        <div className="p-5 space-y-3 text-sm text-slate-300">
          {disputed ? (
            <p>
              Someone disputed the proposed outcome. An admin is reviewing —
              trading and redemption are paused until the dispute is settled.
            </p>
          ) : (
            <p>
              GenLayer proposed {resolution ? <b>{resolution}</b> : "an outcome"} for this market.
              A 24h challenge window is active before it finalizes. Trading is paused.
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            Indexer will mirror the final state to the wallet page once the
            window closes.
          </p>
        </div>
      </div>
    );
  }

  // ── Active trading ──────────────────────────────────────────────────────

  return (
    <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
      {/* Mode tabs */}
      <div className="grid grid-cols-2 border-b border-border">
        {(["buy", "sell"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={clsx(
              "py-3 text-sm font-semibold",
              mode === m ? "bg-surface-2 text-white" : "text-slate-500 hover:text-slate-300"
            )}
          >
            {m === "buy" ? "Buy" : "Sell / Cash out"}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-4">
        {/* Side toggle */}
        <div className="grid grid-cols-2 gap-2">
          <SideButton active={side === "YES"} side="YES" price={pY} onClick={() => setSide("YES")} />
          <SideButton active={side === "NO"}  side="NO"  price={pN} onClick={() => setSide("NO")} />
        </div>

        {/* Shares input */}
        <div>
          <div className="flex justify-between text-[11px] text-slate-500 mb-1">
            <span>Shares (1 share = $1 if {side} wins)</span>
            {mode === "buy" && (
              <span>Wallet: ${available.toFixed(2)}</span>
            )}
          </div>
          <input
            type="number"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="0"
            className="w-full rounded-xl bg-surface-2 border border-border focus:border-primary-500 px-4 py-3 text-lg text-white outline-none"
          />
          <div className="flex gap-2 mt-2">
            {QUICK_SHARES.map((q) => (
              <button
                key={q}
                onClick={() => setShares(q)}
                className="flex-1 rounded-lg bg-surface-2 hover:bg-surface-3 text-slate-300 text-xs py-1.5"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Slippage */}
        <div>
          <div className="flex justify-between text-[11px] text-slate-500 mb-1">
            <span>Max slippage</span>
            <span>{(slippageBps / 100).toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min={50}
            max={2000}
            step={50}
            value={slippageBps}
            onChange={(e) => setSlippageBps(Number(e.target.value))}
            className="w-full accent-primary-500"
          />
        </div>

        {/* Quote summary */}
        {mode === "buy" && buyQ && (
          <QuoteSummary
            rows={[
              ["Cost (with 2% fee)",       `$${fmtUSDC(buyQ.costWithFee, 4)}`],
              ["Effective price",          `${(Number(buyQ.effectivePrice) / 1e18).toFixed(4)}`],
              [`Worst-case (after ${(slippageBps / 100).toFixed(1)}% slip)`, `$${fmtUSDC(maxCostMicros, 4)}`],
              ["Price impact",             priceImpact >= 0 ? `+${fmtPct(priceImpact)}` : fmtPct(priceImpact)],
              [`Max payout if ${side} wins`, `$${fmtUSDC(sharesMicros, 2)}`],
            ]}
          />
        )}
        {mode === "sell" && sellQ && (
          <QuoteSummary
            rows={[
              ["You receive",     `$${fmtUSDC(sellQ.netReturn, 4)}`],
              ["Effective price", `${(Number(sellQ.effectivePrice) / 1e18).toFixed(4)}`],
              [`Min after ${(slippageBps / 100).toFixed(1)}% slip`, `$${fmtUSDC(minReturnMicros, 4)}`],
              ["Price impact",    priceImpact >= 0 ? `+${fmtPct(priceImpact)}` : fmtPct(priceImpact)],
            ]}
          />
        )}

        {/* CTA */}
        {!isConnected ? (
          <button
            onClick={login}
            className="w-full rounded-xl bg-primary-500 hover:bg-primary-400 text-white text-sm font-semibold py-3"
          >
            Connect to trade
          </button>
        ) : mode === "buy" ? (
          needsDeposit ? (
            <button
              onClick={openDepositModal}
              className="w-full rounded-xl bg-yellow-500 hover:bg-yellow-400 text-white text-sm font-semibold py-3 flex items-center justify-center gap-2"
            >
              <Wallet size={14} /> Deposit USDC to buy
            </button>
          ) : (
            <button
              onClick={handleBuy}
              disabled={buyPending || !buyQ || sharesMicros === 0n}
              className={clsx(
                "w-full rounded-xl text-white text-sm font-semibold py-3 flex items-center justify-center gap-2",
                side === "YES"
                  ? "bg-yes hover:bg-yes/90 disabled:bg-yes/40"
                  : "bg-no hover:bg-no/90 disabled:bg-no/40"
              )}
            >
              {buyPending && <Loader2 size={14} className="animate-spin" />}
              Buy {side}
            </button>
          )
        ) : (
          <button
            onClick={handleSell}
            disabled={sellPending || !sellQ || sharesMicros === 0n}
            className="w-full rounded-xl bg-surface-3 hover:bg-surface-4 text-white text-sm font-semibold py-3 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {sellPending && <Loader2 size={14} className="animate-spin" />}
            <ArrowDownUp size={14} /> Sell {side} shares
          </button>
        )}

        {(buyError || sellError) && <ErrorBanner msg={buyError || sellError!} />}
        {submittedTxId && <PendingTxBanner txId={submittedTxId} label="Tx submitted to Arc" />}
      </div>
    </div>
  );
}

function SideButton({
  active, side, price, onClick,
}: {
  active: boolean; side: Side; price: number; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-xl px-4 py-3 border text-left",
        active
          ? side === "YES"
            ? "border-yes/50 bg-yes/10 ring-1 ring-yes/30"
            : "border-no/50 bg-no/10 ring-1 ring-no/30"
          : "border-border bg-surface-2 hover:bg-surface-3"
      )}
    >
      <div className={clsx("text-xs font-medium", side === "YES" ? "text-yes" : "text-no")}>
        {side}
      </div>
      <div className="text-lg font-bold text-white">{fmtPct(price)}</div>
    </button>
  );
}

function QuoteSummary({ rows }: { rows: [string, string][] }) {
  return (
    <div className="rounded-xl bg-surface-2 border border-border px-4 py-3 space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between text-xs">
          <span className="text-slate-500">{k}</span>
          <span className="text-slate-200 font-medium tabular-nums">{v}</span>
        </div>
      ))}
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg bg-no/10 border border-no/30 px-3 py-2 text-xs text-no flex items-start gap-2">
      <AlertCircle size={12} className="mt-0.5 shrink-0" /> {msg}
    </div>
  );
}

function PendingTxBanner({ txId, label }: { txId: string; label: string }) {
  const { authedFetch, refreshGenetiaWallet } = useAuth();
  const [state, setState] = useState<string>("INITIATED");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);

  // Poll Circle for terminal status. Stops once we hit COMPLETE / failure / timeout.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const TERMINAL_OK = new Set(["CONFIRMED", "COMPLETE"]);
    const TERMINAL_FAIL = new Set(["FAILED", "CANCELLED", "DENIED"]);
    const MAX_ATTEMPTS = 60; // ~3 minutes at 3s/poll

    async function poll() {
      if (cancelled) return;
      attempts++;
      try {
        const r = await authedFetch(`/api/circle/tx/${txId}`);
        if (r.ok) {
          const data = await r.json();
          setState(data.state ?? "INITIATED");
          if (data.txHash) setTxHash(data.txHash);
          if (data.errorReason) setErrorReason(data.errorReason);

          if (TERMINAL_OK.has(data.state)) {
            // Refresh wallet/balance once the chain reflects the trade.
            void refreshGenetiaWallet();
            return; // stop polling
          }
          if (TERMINAL_FAIL.has(data.state)) {
            return; // stop polling
          }
        }
      } catch {
        // ignore individual poll failures
      }
      if (attempts < MAX_ATTEMPTS) {
        setTimeout(poll, 3_000);
      }
    }
    poll();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txId]);

  const isDone = state === "CONFIRMED" || state === "COMPLETE";
  const isFail = state === "FAILED" || state === "CANCELLED" || state === "DENIED";

  const statusLine =
    isDone ? "Confirmed on Arc"
    : isFail ? `Failed: ${errorReason ?? state}`
    : state === "SENT" ? "Bundler submitted — waiting for confirmation"
    : state === "QUEUED" ? "Queued by Circle bundler"
    : state === "INITIATED" ? "Submitted to Circle"
    : state;

  return (
    <div className={clsx(
      "rounded-lg border px-3 py-2 text-xs text-slate-300 flex items-center gap-2",
      isDone ? "bg-yes/10 border-yes/30"
      : isFail ? "bg-no/10 border-no/30"
      : "bg-primary-500/10 border-primary-500/30"
    )}>
      {isDone ? (
        <CheckCircle2 size={12} className="shrink-0 text-yes" />
      ) : isFail ? (
        <AlertCircle size={12} className="shrink-0 text-no" />
      ) : (
        <Loader2 size={12} className="animate-spin shrink-0 text-primary-400" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-slate-200">{label}</div>
        <div className="text-[10px] text-slate-500">{statusLine}</div>
        {txHash && (
          <a
            href={`${ARC_EXPLORER_URL}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-brand-light hover:underline truncate block font-mono"
          >
            {txHash.slice(0, 10)}…{txHash.slice(-8)}
          </a>
        )}
      </div>
    </div>
  );
}
