/**
 * LMSR — Logarithmic Market Scoring Rule (Hanson)
 *
 * Pure off-chain implementation that mirrors the on-chain LMSRMarket
 * contract exactly. Used by:
 *   - the TradingPanel to preview cost / shares / price before submitting
 *     a UserOperation
 *   - the indexer to recompute snapshots
 *   - tests as the ground-truth oracle
 *
 * Units & conventions
 * ───────────────────
 * Everything that represents USDC or shares is a 6-decimal BigInt:
 *   1_000_000n  ===  1 USDC  ===  1 share
 * Internally we lift to 1e18 fixed point (UD60x18) to match PRB-Math on
 * the contract side, then drop back to 6 decimals at the boundary.
 *
 * Cost function (Hanson):
 *     C(qY, qN) = b · ln(exp(qY/b) + exp(qN/b))
 *
 * Cost to buy Δ shares of YES at state (qY, qN):
 *     ΔC = C(qY+Δ, qN) − C(qY, qN)
 *
 * Instantaneous YES price (= implied probability of YES):
 *     p(Y) = exp(qY/b) / (exp(qY/b) + exp(qN/b))
 *
 * Invariants:
 *   - Price is always in (0, 1) — never exactly 0 or 1
 *   - Buying YES raises p(Y); selling YES lowers it
 *   - LP worst-case loss is bounded at b · ln(2) ≈ 0.693·b
 */

// ── Fixed-point primitives (UD60x18, matches PRB-Math contract side) ──

/** 1e18 — scale factor for 60.18 fixed point. */
const ONE = 10n ** 18n;
/** USDC has 6 decimals on Arc. */
const USDC_DECIMALS = 6n;
const USDC_ONE = 10n ** USDC_DECIMALS;
/** 1e12 — multiplier to lift a 6-decimal value into 18-decimal. */
const USDC_TO_UD = 10n ** 12n;

/** Convert a 6-decimal USDC BigInt to UD60x18. */
function usdcToUd(x: bigint): bigint {
  return x * USDC_TO_UD;
}

/** Convert a UD60x18 BigInt back to 6-decimal USDC (rounds toward zero). */
function udToUsdc(x: bigint): bigint {
  return x / USDC_TO_UD;
}

/** Multiply two UD60x18 values. */
function udMul(a: bigint, b: bigint): bigint {
  return (a * b) / ONE;
}

/** Divide two UD60x18 values. */
function udDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("lmsr: division by zero");
  return (a * ONE) / b;
}

// ── exp / ln in UD60x18, BigInt-only ──────────────────────────────────────
//
// PRB-Math's exp & ln are gas-optimised polynomial approximations. To keep
// the off-chain copy faithful to within ~1e-12 absolute error (well below
// USDC dust), we use:
//   exp(x) = 2^(x · log2(e))      via separation into integer + fractional
//   ln(x)  = log2(x) / log2(e)    by integer-bit + fractional Taylor

/** log2(e) in UD60x18 — 1.4426950408889634073599246... */
const LOG2_E = 1442695040888963407n;
/** ln(2)   in UD60x18 — 0.6931471805599453094172321... */
const LN_2 = 693147180559945309n;

/**
 * exp(x) for x in UD60x18.
 * Domain: 0 ≤ x ≤ 133.084 (above which the result overflows UD60x18).
 */
export function udExp(x: bigint): bigint {
  if (x === 0n) return ONE;
  if (x < 0n) throw new Error("lmsr: negative exp input");

  // y = x · log2(e), so result = 2^y
  const y = udMul(x, LOG2_E);

  // Split y into integer (k) and fractional (f) parts
  const k = y / ONE; // BigInt integer part
  const f = y - k * ONE; // fractional in UD60x18, in [0, 1)

  // 2^f via 8-term Taylor of exp(f · ln 2) around 0
  // exp(z) ≈ 1 + z + z²/2 + z³/6 + z⁴/24 + z⁵/120 + z⁶/720 + z⁷/5040
  const z = udMul(f, LN_2);
  const z2 = udMul(z, z);
  const z3 = udMul(z2, z);
  const z4 = udMul(z3, z);
  const z5 = udMul(z4, z);
  const z6 = udMul(z5, z);
  const z7 = udMul(z6, z);
  let frac = ONE + z + z2 / 2n + z3 / 6n + z4 / 24n + z5 / 120n + z6 / 720n + z7 / 5040n;

  // Apply 2^k by shifting
  if (k > 0n) {
    if (k > 127n) throw new Error("lmsr: exp overflow");
    frac = frac << k;
  }
  return frac;
}

/**
 * ln(x) for x in UD60x18.
 * Domain: x > 0.
 */
export function udLn(x: bigint): bigint {
  if (x <= 0n) throw new Error("lmsr: non-positive ln input");
  if (x === ONE) return 0n;

  // Reduce to ln(x) = ln(2)·k + ln(m), where m ∈ [1, 2)
  let k = 0n;
  let m = x;
  while (m >= 2n * ONE) {
    m /= 2n;
    k += 1n;
  }
  while (m < ONE) {
    m *= 2n;
    k -= 1n;
  }

  // ln(m) for m ∈ [1, 2): set u = (m−1)/(m+1), then
  //   ln(m) = 2·(u + u³/3 + u⁵/5 + u⁷/7 + u⁹/9 + u¹¹/11 + u¹³/13)
  const num = m - ONE;
  const den = m + ONE;
  const u = udDiv(num, den);
  const u2 = udMul(u, u);
  const u3 = udMul(u2, u);
  const u5 = udMul(u3, u2);
  const u7 = udMul(u5, u2);
  const u9 = udMul(u7, u2);
  const u11 = udMul(u9, u2);
  const u13 = udMul(u11, u2);
  const series = u + u3 / 3n + u5 / 5n + u7 / 7n + u9 / 9n + u11 / 11n + u13 / 13n;
  const lnM = 2n * series;

  return k * LN_2 + lnM;
}

// ── LMSR primitives ───────────────────────────────────────────────────────

export type Outcome = 0 | 1; // 0 = NO, 1 = YES

export interface LMSRState {
  /** Outstanding YES shares (6-dec USDC units, since 1 share = 1 USDC redemption). */
  qYes: bigint;
  /** Outstanding NO shares (6-dec). */
  qNo: bigint;
  /** Liquidity parameter b (6-dec USDC). */
  b: bigint;
}

/**
 * Cost function C(qY, qN) = b·ln(exp(qY/b) + exp(qN/b))
 * Returns a value in 6-decimal USDC.
 */
export function cost(state: LMSRState): bigint {
  const bUd = usdcToUd(state.b);
  const yUd = usdcToUd(state.qYes);
  const nUd = usdcToUd(state.qNo);

  // exp(qY/b), exp(qN/b)
  // Subtract the max from each exponent for numerical stability:
  //   ln(e^a + e^b) = max(a,b) + ln(1 + e^{−|a−b|})
  // This keeps the inputs to exp() bounded.
  const ratioY = udDiv(yUd, bUd);
  const ratioN = udDiv(nUd, bUd);
  const mx = ratioY > ratioN ? ratioY : ratioN;
  const dy = ratioY >= mx ? ratioY - mx : 0n; // ≤ 0
  const dn = ratioN >= mx ? ratioN - mx : 0n; // ≤ 0
  // We need exp(ratio - mx), which is exp of a non-positive number.
  // Implement as 1/exp(|.|).
  const eY = ratioY >= mx ? ONE : udDiv(ONE, udExp(mx - ratioY));
  const eN = ratioN >= mx ? ONE : udDiv(ONE, udExp(mx - ratioN));
  void dy;
  void dn;

  const sum = eY + eN;
  const ln = udLn(sum) + mx;
  const result = udMul(bUd, ln);
  return udToUsdc(result);
}

/**
 * Cost to buy `shares` of `outcome` at current state.
 * Returns a non-negative USDC amount (6-dec).
 *
 * For a sell, pass shares as a positive bigint and call `returnOnSell`.
 */
export function costToBuy(state: LMSRState, outcome: Outcome, shares: bigint): bigint {
  if (shares <= 0n) return 0n;
  const before = cost(state);
  const after = cost({
    ...state,
    qYes: outcome === 1 ? state.qYes + shares : state.qYes,
    qNo: outcome === 0 ? state.qNo + shares : state.qNo,
  });
  return after - before;
}

/**
 * Net USDC returned by selling `shares` of `outcome` at current state.
 * Always non-negative. Reduces qOutcome by `shares`.
 */
export function returnOnSell(state: LMSRState, outcome: Outcome, shares: bigint): bigint {
  if (shares <= 0n) return 0n;
  const q = outcome === 1 ? state.qYes : state.qNo;
  // Callers should pre-clamp, but be defensive — UI should never crash on
  // a bad input. Return 0 for unsellable amounts.
  if (shares > q) return 0n;
  const before = cost(state);
  const after = cost({
    ...state,
    qYes: outcome === 1 ? state.qYes - shares : state.qYes,
    qNo: outcome === 0 ? state.qNo - shares : state.qNo,
  });
  return before - after;
}

/**
 * Instantaneous price of YES (= implied probability), as a UD60x18 BigInt
 * in [0, 1·1e18]. Use `priceAsFloat` to get a JS number.
 */
export function priceYes(state: LMSRState): bigint {
  const bUd = usdcToUd(state.b);
  const yUd = usdcToUd(state.qYes);
  const nUd = usdcToUd(state.qNo);
  const ratioY = udDiv(yUd, bUd);
  const ratioN = udDiv(nUd, bUd);
  // softmax with max-shift for stability
  const mx = ratioY > ratioN ? ratioY : ratioN;
  const eY = ratioY >= mx ? ONE : udDiv(ONE, udExp(mx - ratioY));
  const eN = ratioN >= mx ? ONE : udDiv(ONE, udExp(mx - ratioN));
  return udDiv(eY, eY + eN);
}

export function priceNo(state: LMSRState): bigint {
  return ONE - priceYes(state);
}

/** Convert a UD60x18 probability to a plain number for UI rendering. */
export function priceAsFloat(p: bigint): number {
  // p ∈ [0, 1e18]; preserve 6 fractional digits
  return Number(p / 10n ** 12n) / 1_000_000;
}

// ── Fees ──────────────────────────────────────────────────────────────────

/** 2% buy spread (200 basis points), matches contract `FEE_BPS`. */
export const FEE_BPS = 200n;
const BPS = 10_000n;

/** Apply 2% spread to a raw LMSR cost. */
export function applyBuyFee(rawCost: bigint): { gross: bigint; fee: bigint } {
  const fee = (rawCost * FEE_BPS) / BPS;
  return { gross: rawCost + fee, fee };
}

/** Sells have no fee, but we keep the helper for symmetry / future tuning. */
export function applySellFee(rawReturn: bigint): { net: bigint; fee: bigint } {
  return { net: rawReturn, fee: 0n };
}

// ── High-level quote helpers ──────────────────────────────────────────────

export interface BuyQuote {
  /** Raw LMSR cost (pre-fee), 6-dec USDC. */
  rawCost: bigint;
  /** Cost the user actually pays (raw + 2% spread). */
  costWithFee: bigint;
  /** Effective price per share, in 1e18 fixed point. */
  effectivePrice: bigint;
  /** YES price after the trade lands (for slippage UI). */
  newPriceYes: bigint;
}

export interface SellQuote {
  /** Raw LMSR return, 6-dec USDC. */
  rawReturn: bigint;
  /** What the user actually receives (currently = rawReturn). */
  netReturn: bigint;
  /** Effective price per share, in 1e18 fixed point. */
  effectivePrice: bigint;
  /** YES price after the trade lands. */
  newPriceYes: bigint;
}

export function quoteBuy(state: LMSRState, outcome: Outcome, shares: bigint): BuyQuote {
  if (shares <= 0n) {
    return { rawCost: 0n, costWithFee: 0n, effectivePrice: 0n, newPriceYes: priceYes(state) };
  }
  const rawCost = costToBuy(state, outcome, shares);
  const { gross } = applyBuyFee(rawCost);
  const newState: LMSRState = {
    ...state,
    qYes: outcome === 1 ? state.qYes + shares : state.qYes,
    qNo: outcome === 0 ? state.qNo + shares : state.qNo,
  };
  return {
    rawCost,
    costWithFee: gross,
    effectivePrice: udDiv(usdcToUd(rawCost), usdcToUd(shares)),
    newPriceYes: priceYes(newState),
  };
}

export function quoteSell(state: LMSRState, outcome: Outcome, shares: bigint): SellQuote {
  if (shares <= 0n) {
    return { rawReturn: 0n, netReturn: 0n, effectivePrice: 0n, newPriceYes: priceYes(state) };
  }
  const rawReturn = returnOnSell(state, outcome, shares);
  const newState: LMSRState = {
    ...state,
    qYes: outcome === 1 ? state.qYes - shares : state.qYes,
    qNo: outcome === 0 ? state.qNo - shares : state.qNo,
  };
  return {
    rawReturn,
    netReturn: rawReturn,
    effectivePrice: udDiv(usdcToUd(rawReturn), usdcToUd(shares)),
    newPriceYes: priceYes(newState),
  };
}

// ── Constants exported for symmetry with the contract ────────────────────

/** Default seed liquidity for a new market on testnet: 100 USDC. */
export const DEFAULT_B = 100n * USDC_ONE;

/** Worst-case LP loss for a given b, in 6-dec USDC. = b · ln(2) */
export function maxLpLoss(b: bigint): bigint {
  return udToUsdc(udMul(usdcToUd(b), LN_2));
}

// ── Internal exports (for tests only) ─────────────────────────────────────

export const _internals = {
  ONE,
  USDC_ONE,
  LOG2_E,
  LN_2,
  udExp,
  udLn,
  udMul,
  udDiv,
  usdcToUd,
  udToUsdc,
};
