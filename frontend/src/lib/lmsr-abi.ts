/**
 * Hand-written ABIs for the LMSR stack on Arc.
 *
 * Trimmed to only the surface area the backend / frontend actually touch —
 * full ABIs live in `contracts/arc/out/*.json` after `forge build`. Keeping
 * this hand-rolled means we don't have to regenerate anything when the
 * contract recompiles.
 */

export const LMSR_FACTORY_ABI = [
  {
    type: "function",
    name: "createMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "b", type: "uint256" },
      { name: "expiry", type: "uint256" },
    ],
    outputs: [
      { name: "marketId", type: "uint256" },
      { name: "market", type: "address" },
    ],
  },
  {
    type: "function",
    name: "marketById",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getMarkets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "tokens",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "admin",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "relayer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "market", type: "address", indexed: true },
      { name: "b", type: "uint256", indexed: false },
      { name: "expiry", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

export const LMSR_MARKET_ABI = [
  // ── State views ──
  { type: "function", name: "marketId",   stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "qYes",       stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "qNo",        stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "collateral",  stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "feesAccrued", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "b",          stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "expiry",     stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "status",     stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "finalOutcome",    stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "proposedOutcome", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "pendingSince",    stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "challengeTimeLeft", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "priceYes",   stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "priceNo",    stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function",
    name: "costToBuy",
    stateMutability: "view",
    inputs: [{ name: "outcome", type: "uint8" }, { name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "returnOnSell",
    stateMutability: "view",
    inputs: [{ name: "outcome", type: "uint8" }, { name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },

  // ── Trading ──
  {
    type: "function",
    name: "buy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "outcome", type: "uint8" },
      { name: "shares", type: "uint256" },
      { name: "maxCost", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { name: "outcome", type: "uint8" },
      { name: "shares", type: "uint256" },
      { name: "minReturn", type: "uint256" },
    ],
    outputs: [],
  },

  // ── Resolution ──
  {
    type: "function",
    name: "proposeResolution",
    stateMutability: "nonpayable",
    inputs: [{ name: "outcome", type: "uint8" }],
    outputs: [],
  },
  { type: "function", name: "dispute",  stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "finalize", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "adminResolve",
    stateMutability: "nonpayable",
    inputs: [{ name: "outcome", type: "uint8" }],
    outputs: [],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "yesAmount", type: "uint256" },
      { name: "noAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sweepFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "sweepCollateral",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "redemptionReserve",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  { type: "function", name: "finalizedAt", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "SWEEP_GRACE_PERIOD", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },

  // ── Events ──
  {
    type: "event",
    name: "Bought",
    inputs: [
      { name: "user",    type: "address", indexed: true },
      { name: "outcome", type: "uint8",   indexed: false },
      { name: "shares",  type: "uint256", indexed: false },
      { name: "cost",    type: "uint256", indexed: false },
      { name: "fee",     type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Sold",
    inputs: [
      { name: "user",    type: "address", indexed: true },
      { name: "outcome", type: "uint8",   indexed: false },
      { name: "shares",  type: "uint256", indexed: false },
      { name: "ret",     type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ResolutionProposed",
    inputs: [
      { name: "outcome",      type: "uint8",   indexed: false },
      { name: "pendingUntil", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Disputed",
    inputs: [
      { name: "challenger", type: "address", indexed: true },
      { name: "bond",       type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Finalized",
    inputs: [{ name: "outcome", type: "uint8", indexed: false }],
    anonymous: false,
  },
  {
    type: "event",
    name: "AdminResolved",
    inputs: [{ name: "outcome", type: "uint8", indexed: false }],
    anonymous: false,
  },
  {
    type: "event",
    name: "Redeemed",
    inputs: [
      { name: "user",       type: "address", indexed: true },
      { name: "yesBurned",  type: "uint256", indexed: false },
      { name: "noBurned",   type: "uint256", indexed: false },
      { name: "paid",       type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

export const OUTCOME_TOKENS_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenIdFor",
    stateMutability: "pure",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "outcome", type: "uint8" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const USDC_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ── Status / outcome enums (must match contract) ─────────────────────────

export const MARKET_STATUS = {
  Active: 0,
  Pending: 1,
  Disputed: 2,
  Finalized: 3,
} as const;

export const OUTCOME = {
  NONE: 0,
  NO: 1,
  YES: 2,
  INVALID: 3,
} as const;

export type MarketStatus = keyof typeof MARKET_STATUS;
export type OutcomeName = keyof typeof OUTCOME;

export function statusLabel(s: number): MarketStatus {
  switch (s) {
    case 0: return "Active";
    case 1: return "Pending";
    case 2: return "Disputed";
    case 3: return "Finalized";
    default: throw new Error(`unknown status ${s}`);
  }
}

export function outcomeLabel(o: number): OutcomeName {
  switch (o) {
    case 0: return "NONE";
    case 1: return "NO";
    case 2: return "YES";
    case 3: return "INVALID";
    default: throw new Error(`unknown outcome ${o}`);
  }
}
