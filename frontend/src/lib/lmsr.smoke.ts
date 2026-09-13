/**
 * Smoke check for lib/lmsr.ts.
 *
 * Run with:   npx -y tsx frontend/src/lib/lmsr.smoke.ts
 *
 * Foundry tests on the Solidity side are the source of truth for what users
 * actually pay/receive; this just guards against typos and obvious math
 * regressions in the off-chain mirror.
 */

import {
  cost,
  costToBuy,
  returnOnSell,
  priceYes,
  priceAsFloat,
  quoteBuy,
  quoteSell,
  applyBuyFee,
  maxLpLoss,
  DEFAULT_B,
  _internals,
  type LMSRState,
} from "./lmsr";

let failures = 0;

function approx(actual: number, expected: number, tol: number, label: string) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) {
    failures++;
    console.error(`✗ ${label} — got ${actual}, expected ~${expected} (±${tol})`);
  } else {
    console.log(`✓ ${label}`);
  }
}

function eq(actual: bigint, expected: bigint, label: string) {
  if (actual !== expected) {
    failures++;
    console.error(`✗ ${label} — got ${actual}, expected ${expected}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

function check(cond: boolean, label: string) {
  if (!cond) {
    failures++;
    console.error(`✗ ${label}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

// ── UD60x18 primitives ────────────────────────────────────────────────────

const { ONE, udExp, udLn, LN_2 } = _internals;

// exp(0) = 1
eq(udExp(0n), ONE, "udExp(0) == 1");
// exp(ln(2)) ≈ 2 (off-chain Taylor series, ~6-decimal precision is plenty)
approx(Number(udExp(LN_2)) / Number(ONE), 2, 1e-5, "udExp(ln 2) ≈ 2");
// ln(1) = 0
eq(udLn(ONE), 0n, "udLn(1) == 0");
// ln(e) ≈ 1, where e = exp(1)
const e = udExp(ONE);
approx(Number(udLn(e)) / Number(ONE), 1, 1e-5, "udLn(e) ≈ 1");
// round-trip: exp(ln(5)) ≈ 5
approx(
  Number(udExp(udLn(5n * ONE))) / Number(ONE),
  5,
  1e-5,
  "udExp(udLn(5)) ≈ 5",
);
// exp(10) ≈ 22026.4658
approx(Number(udExp(10n * ONE)) / Number(ONE), Math.exp(10), 1e-2, "udExp(10) ≈ e^10");

// ── LMSR primitives ───────────────────────────────────────────────────────

// At qY = qN = 0, price should be exactly 0.5
const state0: LMSRState = { qYes: 0n, qNo: 0n, b: DEFAULT_B };
approx(priceAsFloat(priceYes(state0)), 0.5, 1e-9, "p(Y) at (0,0) == 0.5");

// At qY = qN, price stays 0.5 regardless of magnitude
const stateSym: LMSRState = { qYes: 50n * 1_000_000n, qNo: 50n * 1_000_000n, b: DEFAULT_B };
approx(priceAsFloat(priceYes(stateSym)), 0.5, 1e-9, "p(Y) at (50,50) == 0.5");

// Buying YES raises p(Y)
const afterBuyYes: LMSRState = { ...state0, qYes: 25n * 1_000_000n };
const pAfter = priceAsFloat(priceYes(afterBuyYes));
check(pAfter > 0.5, `buying 25 YES (b=100) raises p(Y) above 0.5 (got ${pAfter.toFixed(4)})`);
// And it should be ~0.562 — matches Hanson's formula exactly:
//   p = exp(0.25) / (exp(0.25) + 1) ≈ 0.5621765
approx(pAfter, 0.5621765, 1e-4, "p(Y) after +25 YES on b=100 ≈ 0.5621765");

// Cost to buy 25 YES from (0,0) with b=100:
//   C(25, 0) - C(0, 0) = 100·ln(e^0.25 + 1) - 100·ln(2)
//                      = 100·(0.8259 - 0.6931) ≈ 13.28 USDC
const cost25Yes = costToBuy(state0, 1, 25n * 1_000_000n);
const cost25YesFloat = Number(cost25Yes) / 1_000_000;
approx(cost25YesFloat, 13.282, 0.01, "costToBuy(25 YES) from (0,0) ≈ 13.28");

// Round-trip: buy then sell gives back exactly the same USDC (in same state)
const buyState: LMSRState = { ...state0 };
const buy = costToBuy(buyState, 1, 10n * 1_000_000n);
const newState: LMSRState = { ...buyState, qYes: buyState.qYes + 10n * 1_000_000n };
const sellBack = returnOnSell(newState, 1, 10n * 1_000_000n);
// Allow 1 unit (1e-6 USDC) of rounding tolerance.
const diff = buy > sellBack ? buy - sellBack : sellBack - buy;
check(diff <= 1n, `buy 10 YES then sell 10 YES recovers within 1 dust (${diff} units)`);

// Worst-case LP loss: b · ln(2)
const maxLoss = maxLpLoss(DEFAULT_B);
approx(Number(maxLoss) / 1_000_000, 69.3147, 0.01, "maxLpLoss(b=100) ≈ 69.31 USDC");

// Fee math: buying $10 at 2% spread → user pays $10.20, fee = $0.20
const { gross, fee } = applyBuyFee(10n * 1_000_000n);
eq(fee, 200_000n, "fee of 10 USDC == 0.20 USDC");
eq(gross, 10_200_000n, "gross of 10 USDC == 10.20 USDC");

// quoteBuy: confirm structure
const q = quoteBuy(state0, 1, 25n * 1_000_000n);
check(q.rawCost > 0n, "quoteBuy returns positive rawCost");
check(q.costWithFee > q.rawCost, "quoteBuy costWithFee > rawCost");
check(q.newPriceYes > priceYes(state0), "quoteBuy newPriceYes > current");

// quoteSell mirror
const sellState: LMSRState = { ...state0, qYes: 25n * 1_000_000n };
const qs = quoteSell(sellState, 1, 10n * 1_000_000n);
check(qs.rawReturn > 0n, "quoteSell returns positive rawReturn");
check(qs.newPriceYes < priceYes(sellState), "quoteSell newPriceYes < current");

// Stability under big asymmetry: q=(1000, 0) — should not throw, p(Y) > 0.99
const lopsided: LMSRState = { qYes: 1_000n * 1_000_000n, qNo: 0n, b: DEFAULT_B };
const pLop = priceAsFloat(priceYes(lopsided));
check(pLop > 0.99 && pLop < 1.0, `extreme lopsided p(Y) in (0.99, 1.0), got ${pLop}`);

// Cost is always non-negative regardless of state
check(cost(lopsided) >= 0n, "cost is non-negative for lopsided state");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll LMSR smoke checks passed.");
