# Genetia v2 — On-chain LMSR Markets on Arc, resolved by GenLayer

**Status:** Draft. Pre-implementation alignment doc.
**Goal:** Make the on-chain state the source of truth for every market and every position. The database becomes an indexer, not the ledger. Users hold their outcome tokens themselves; bets, sells, and redemptions are real Arc transactions sponsored by Circle Paymaster.

---

## 0. Confirmed prerequisites (Circle docs, 2025.10.27)

- **Arc testnet supports ERC-1155 deploys.** Console + API + standard Solidity.
- **Circle Paymaster supports Arc testnet.** ERC-4337 SCAs pay fees in USDC; no native gas required.
- **Circle Developer-Controlled Wallets support Arc testnet.** Same wallet IDs we use today; we just start sending UserOperations through them instead of plain transfers.
- **GenLayer Studionet** unchanged. Relayer signs `proposeResolution(outcome)` on the Arc Market with the same `GENLAYER_RELAYER_PRIVATE_KEY` we already use.

---

## 1. Contracts

Three contracts. Solidity 0.8.x. Deployed on Arc testnet via Foundry.

### 1.1 `OutcomeTokens` (ERC-1155, singleton)

```solidity
contract OutcomeTokens is ERC1155 {
    address public factory;
    mapping(address => bool) public isMarket;   // only Markets can mint/burn

    // tokenId encoding: marketId * 2 + outcome, outcome ∈ {0 = NO, 1 = YES}
    function tokenId(uint256 marketId, uint8 outcome) public pure returns (uint256);

    function mint(address to, uint256 id, uint256 amount) external onlyMarket;
    function burn(address from, uint256 id, uint256 amount) external onlyMarket;
    function registerMarket(address market) external onlyFactory;
}
```

- One singleton per deployment. Users only ever approve this contract once.
- `marketId` is a `uint128` allocated by the Factory; `outcome` is a `uint8`. We pack them into the `uint256` token ID with bit shifts.

### 1.2 `MarketFactory`

```solidity
contract MarketFactory {
    OutcomeTokens public immutable tokens;
    IERC20       public immutable usdc;
    address      public immutable relayer;     // GenLayer relayer key
    address      public          admin;        // single key now, multisig later
    address      public          treasury;     // funds initial liquidity, receives fees

    event MarketCreated(uint256 indexed marketId, address market, uint256 b, uint256 expiry);

    function createMarket(uint256 expiry, uint256 b) external returns (address market, uint256 marketId);
    function setAdmin(address) external onlyAdmin;
    function setTreasury(address) external onlyAdmin;
}
```

- `createMarket` is called by our backend after a suggestion is approved, using the treasury wallet as the caller.
- `b` is the LMSR liquidity parameter (USDC-denominated, 6 decimals). Default `b = 100 * 1e6` on testnet.
- The factory pulls `b` USDC from `treasury` and seeds the new Market with it.

### 1.3 `Market` (one per market)

State machine:

```
                       proposeResolution(outcome)
                  ┌─────────────────────────────────────┐
                  │                                     ▼
              ┌───────┐   adminResolve     ┌─────────────┐  finalize  ┌──────────┐
              │Active │───────────────────▶│   Pending   │───────────▶│Finalized │
              └───┬───┘                    │ (24h timer) │            └──────────┘
                  │                        └──────┬──────┘                  ▲
                  │ adminResolve                  │ dispute (with bond)     │
                  │                               ▼                         │
                  │                          ┌──────────┐    adminResolve   │
                  └─────────────────────────▶│ Disputed │───────────────────┘
                                             └──────────┘
```

```solidity
enum Status { Active, Pending, Disputed, Finalized }
enum Outcome { NONE, NO, YES, INVALID }

contract Market {
    uint256 public immutable id;
    uint256 public immutable b;           // LMSR liquidity parameter
    uint256 public immutable expiry;      // unix timestamp; bets close at this time
    OutcomeTokens public immutable tokens;
    IERC20 public immutable usdc;
    address public immutable factory;

    uint256 public qYes;                   // outstanding YES tokens
    uint256 public qNo;                    // outstanding NO tokens
    uint256 public collateral;             // USDC held by the contract
    uint256 public feesAccrued;            // 2% trading-fee bucket, sweepable by treasury

    Status  public status;
    Outcome public proposedOutcome;
    Outcome public finalOutcome;
    uint256 public pendingSince;          // for the 24h challenge window
    address public disputeBondHolder;
    uint256 public disputeBond;

    // Trading
    function buy(uint8 outcome, uint256 shares, uint256 maxCostUsdc) external;
    function sell(uint8 outcome, uint256 shares, uint256 minReturnUsdc) external;

    // Pricing (off-chain readable views)
    function priceYes() external view returns (uint256);     // 1e18 fixed point
    function priceNo()  external view returns (uint256);
    function costToBuy(uint8 outcome, uint256 shares) external view returns (uint256);
    function returnOnSell(uint8 outcome, uint256 shares) external view returns (uint256);

    // Resolution
    function proposeResolution(uint8 outcome) external onlyRelayer;
    function dispute() external payable;                     // payable in USDC via approve+pull
    function finalize() external;                            // anyone, after 24h elapsed
    function adminResolve(uint8 outcome) external onlyAdmin; // escape hatch

    // Redemption
    function redeem(uint256 yesAmount, uint256 noAmount) external; // burns tokens, sends USDC

    // Events
    event Bought(address indexed user, uint8 outcome, uint256 shares, uint256 cost, uint256 fee);
    event Sold  (address indexed user, uint8 outcome, uint256 shares, uint256 ret);
    event ResolutionProposed(uint8 outcome, uint256 pendingUntil);
    event Disputed(address indexed challenger, uint256 bond);
    event Finalized(uint8 outcome);
    event Redeemed(address indexed user, uint256 yesBurned, uint256 noBurned, uint256 paid);
}
```

#### Modifiers
- `onlyRelayer`: `msg.sender == factory.relayer()`.
- `onlyAdmin`: `msg.sender == factory.admin()`.
- `onlyActive`: `status == Active && block.timestamp < expiry`.

#### Resolution flow (the part where on-chain meets GenLayer)
1. Resolver pipeline pings GenLayer with the question/criteria as it does today.
2. GenLayer verdict comes back → relayer constructs a tx calling `Market.proposeResolution(outcome)`.
3. Contract sets `status = Pending`, records `pendingSince = block.timestamp`.
4. 24h window:
   - Anyone can call `dispute()` and post a bond = `min(5% × collateral, 500 USDC)`. Triggers `Disputed`.
   - If undisputed at 24h, anyone calls `finalize()` → `Finalized`.
5. Admin can call `adminResolve()` at any time to override. Required for the Disputed path; escape hatch otherwise.
6. Once Finalized, `redeem()` is unlocked.

#### Invalid resolution
If `finalOutcome == INVALID`:
- `redeem(yesAmount, noAmount)` returns `(yesAmount + noAmount) × averageEntryPrice` proportionally. Cleanest implementation: store accumulated paid-in USDC per token at mint time (or recompute from event logs) and refund pro rata. **TBD during implementation — simplest version: redeem each token for `collateral / (qYes + qNo)`. Good enough for testnet.**

---

## 2. LMSR math

Cost function (Hanson):

```
C(qYes, qNo) = b · ln(exp(qYes / b) + exp(qNo / b))
```

Cost of buying `Δ` shares of YES:

```
cost = C(qYes + Δ, qNo) − C(qYes, qNo)
```

Price (instantaneous probability of YES):

```
p(YES) = exp(qYes / b) / (exp(qYes / b) + exp(qNo / b))
```

Properties:
- Price always in `(0, 1)` — never hits zero or one even with huge imbalance.
- Worst-case loss to the LP = `b × ln(2)` ≈ `0.693 × b`. With `b = 100 USDC`, max loss ≈ $69.30.
- Buys and sells are exact inverses (no arbitrage from round-tripping at a single state).

### Fixed-point implementation
- **Library:** PRB-Math `UD60x18` (battle-tested, audited, `exp`/`ln` implemented).
- **Scaling:** USDC has 6 decimals on Arc. We convert to UD60x18 (1e18 scale) at the contract boundary and back. `b` is stored in 6-decimal USDC units, scaled up for math.
- **Overflow guard:** `exp(x/b)` blows up fast. With `b = 100e6` USDC and reasonable bet sizes (`Δ ≤ 1000 USDC` per trade), `x/b ≤ 10`, so `exp(x/b) ≤ e^10 ≈ 22026` — well within UD60x18 range.
- We `require()` that `shares ≤ b × 10` per buy to prevent crazy inputs.

### Fees
- **2% spread on buys.** `actualCost = lmsrCost × 1.02`. Excess goes to `feesAccrued`.
- **0% on sells and redemption.** Don't trap users.
- Treasury can `sweepFees()` at any time.

---

## 3. Off-chain components

### 3.1 New: `lib/arc-userops.ts`
Build and send Circle UserOperations for a given Developer-Controlled Wallet on Arc, paying gas via Circle Paymaster.

```ts
sendUserOp({
  walletId: string,            // Circle wallet ID
  calls: { to: Address, data: Hex, value?: bigint }[],
  paymaster: "circle",         // always for now
}): Promise<{ userOpHash: string, txHash: string }>
```

This replaces the existing `executeCircleTransfer` for bet/exit operations; transfers still use the simple transfer API.

### 3.2 New: `lib/lmsr.ts`
Pure-TS LMSR math, mirrors the contract. Used by TradingPanel to preview prices before tx submission. No network calls.

```ts
costToBuy(qYes: bigint, qNo: bigint, b: bigint, outcome: 0|1, shares: bigint): bigint
priceYes(qYes: bigint, qNo: bigint, b: bigint): number
priceNo (qYes: bigint, qNo: bigint, b: bigint): number
```

### 3.3 New: `lib/arc-indexer.ts`
Long-running task (or cron) that:
1. Polls `MarketFactory.MarketCreated` events → inserts new Market rows.
2. Polls each active Market for `Bought`/`Sold`/`Finalized`/`Redeemed` events → mirrors to DB.
3. Reconciles: if DB diverges from chain, chain wins.

Runs every 30s on the same cron path that resolver pipeline uses.

### 3.4 Modified: `lib/resolver-pipeline.ts`
- `pushToArc()` → `proposeResolutionOnArc()`. Same relayer key, new function selector (`proposeResolution(uint8)` instead of `resolve(bool)`).
- Settlement state machine adds two intermediate states: `proposed_on_arc`, `disputed`.

### 3.5 Modified API routes
| Route | Change |
|---|---|
| `POST /api/bets/place` | Builds & submits UserOp calling `Market.buy(...)`. Returns userOp hash. |
| `POST /api/bets/exit`  | **New.** UserOp calling `Market.sell(...)`. |
| `POST /api/bets/claim` | UserOp calling `Market.redeem(...)`. |
| `POST /api/wallets/withdraw` | Unchanged in shape — still pulls USDC from user's SCA via Circle transfer. Just works now because USDC is actually there. |
| `GET  /api/markets/:id` | Reads `qYes`, `qNo`, `status` from chain (cached); computes prices via `lib/lmsr.ts`. |
| `GET  /api/markets/:id/history` | Reads from indexed `Bought`/`Sold` events instead of `bets` table. |

### 3.6 Deleted / deprecated
- `walletBalance.availableBalance` / `lockedBalance` — replaced by on-chain USDC balance + outcome-token balances. DB columns kept for legacy markets only.
- The treasury-sweep idea I floated earlier — not needed; user wallets hold tokens directly.
- `Bet.status = "won" | "lost"` tracking — derived from on-chain token balances post-resolution.

### 3.7 Frontend changes
- **TradingPanel** — fetches live `qYes`/`qNo` from `/api/markets/:id`, computes LMSR price in-browser via `lib/lmsr.ts`. Slider for shares, displays cost in USDC, slippage tolerance input.
- **Wallet page** — adds a "Positions" section showing each open Market and the user's YES/NO token balances on it. "Cash out" button uses `/api/bets/exit`. "Redeem" button shows after resolution.
- **Market detail** — probability chart sourced from indexed events.

---

## 4. Migration — clean break

Dual-mode is the textbook answer; for us it's overkill. We have no real users and a handful of testnet markets. The honest path is:

1. **Before contract deploy:** wrap up every active parimutuel market. Manually refund or resolve via the existing admin dashboard. Anything already in `resolved` / `refunded` stays in the DB as read-only history.
2. **At contract deploy:** old parimutuel code paths get deleted in the same PR that introduces LMSR. No `mode` column on `Market`. No branching. One path forward.
3. **Historic data stays.** Resolved-market rows + wallet-transaction rows survive so the wallet History tab keeps showing past bet wins/losses forever. Read-only — no maintenance burden.
4. **Going forward:** only LMSR markets can be created. Suggestion approval calls `LMSRMarketFactory.createMarket(...)` and that's the only path.

Trade-off explicitly accepted: a couple test markets in flight need ~10 minutes of admin clicks to wind down. Worth it in exchange for keeping the codebase one-architecture clean.

---

## 5. Open items / deferred decisions

- **Invalid-resolution payout formula.** Punt on exact math; testnet uses `collateral / (qYes + qNo)` per token. Revisit before mainnet.
- **Dispute bond mechanics.** Initial: USDC bond pulled via `transferFrom`. Refunded if dispute upheld, slashed to treasury if not. Admin decides via `adminResolve`.
- **Admin → multisig.** Single EOA on testnet; swap to Safe multisig before mainnet.
- **Liquidity provider tokens.** Treasury is the only LP for v1. v2 could let users be LPs with LP tokens. Out of scope here.

---

## 6. Build order

Roughly two work streams that can interleave:

**Contracts (4-5 days)**
1. `OutcomeTokens` + tests
2. `MarketFactory` + tests
3. `Market` (LMSR + state machine + redemption + disputes) + tests
4. Deploy to Arc testnet via Foundry, verify on Arcscan

**Backend / frontend (8-10 days)**
1. `lib/lmsr.ts` (matches contract math exactly, share tests)
2. `lib/arc-userops.ts` + Circle Paymaster wiring
3. `lib/arc-indexer.ts` + DB schema migration (`mode` column, new event tables)
4. Rewire `/api/bets/place`, add `/api/bets/exit`, rewire `/api/bets/claim`
5. Modify `resolver-pipeline.ts` for the new `proposeResolution` flow
6. TradingPanel rewrite (LMSR pricing, sell button)
7. Wallet page "Positions" section
8. Admin "Resolve dispute" UI

**Integration testing (2-3 days)**
- End-to-end: create market → two bettors trade → expire → GenLayer verdict → propose → finalize (or dispute) → redeem

Total: ~3 weeks of focused work.

---

## 7. What stays untouched

- Privy login, Circle wallet provisioning, user/admin gating
- Market suggestion + approval flow (just calls a new factory method)
- GenLayer contract & relayer key (literally one function selector changes downstream)
- Admin dashboard structure (tabs, navigation)
- Theme, light mode, all UI primitives

---

## 8. Sign-off

If this all reads right, the next step is the smart-contract scaffold (a fresh `contracts/lmsr/` folder under `arc-contracts/`) and a parallel `lib/lmsr.ts` so we can unit-test the math in TS before contracts even exist.

Push back on anything that's off. I'll iterate this doc, not just plow into code.
