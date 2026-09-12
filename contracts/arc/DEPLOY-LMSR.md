# LMSR contract deployment — Arc testnet

This is the **only** thing standing between Phase 1 (everything I've written so far) and Phase 2 (the backend / frontend rewrite). After you finish this checklist, ping me and I'll resume from the indexer onward.

---

## 0. One-time prep

```bash
cd contracts/arc

# Install OpenZeppelin contracts. `forge install` uses git submodules and
# requires a .git directory; on a standalone Foundry project without one,
# the cleanest approach is a shallow git clone:
git clone --depth 1 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts

# (prb-math is optional — we ship our own UD60x18Math. Only install if you
#  ever want to swap to PRB's gas-optimised version:)
# git clone --depth 1 https://github.com/PaulRBerg/prb-math.git lib/prb-math

# Verify the project builds
forge build
```

If `forge build` fails, fix any import remapping issues before continuing — the deploy will fail otherwise.

---

## 1. Run the contract tests

```bash
forge test --match-path "test/lmsr/*" -vv
```

You should see every test in `LMSRMarketTest` pass. If any fail, **stop** and tell me what failed — the math or state machine has a bug that needs fixing before deployment.

---

## 2. Pick / fund the wallets you'll need

You need three Arc-testnet addresses with USDC funded via the [Circle Faucet](https://faucet.circle.com):

| Role | What it does | Funding |
|---|---|---|
| **Deployer** | Pays gas to deploy the factory. Becomes initial admin. | ~5 USDC (Arc gas) |
| **Relayer** | Calls `proposeResolution()` on Markets. **Reuse `GENLAYER_RELAYER_PRIVATE_KEY` — same wallet that already calls `resolve_market`.** | ~5 USDC for gas over time |
| **Treasury** | Seeds every new market with `b` USDC. **Use a fresh Circle Developer-Controlled Wallet.** | 500-1000 USDC (enough for 5-10 markets at b=100) |

If you don't already have a treasury wallet, provision one through the Circle console or via the existing `createCircleDeveloperControlledWallet` helper, then faucet-fund it.

---

## 3. Set deployment env

In `contracts/arc/.env` (create if it doesn't exist):

```bash
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
ARCSCAN_API_KEY=<your existing key>

PRIVATE_KEY=0x<deployer key, 64 hex chars>
RELAYER_ADDRESS=0x<address of GENLAYER_RELAYER_PRIVATE_KEY>
TREASURY_ADDRESS=0x<address of the Circle treasury wallet>

# Optional override; defaults to Arc's native USDC at 0x3600...0000
# ARC_USDC_ADDRESS=0x3600000000000000000000000000000000000000
```

---

## 4. Deploy

```bash
source .env  # load PRIVATE_KEY etc

forge script script/DeployLMSR.s.sol \
  --rpc-url arc_testnet \
  --broadcast \
  --verify
```

The script will log:

```
=========================================================
LMSRMarketFactory deployed at: 0x...
OutcomeTokens         at:      0x...
=========================================================
```

Copy both addresses.

---

## 5. Treasury approval

The factory pulls USDC out of the treasury wallet whenever it creates a market, so the treasury needs to approve the factory once for an effectively infinite amount.

From the **treasury wallet** (you'll do this through the Circle dashboard or via a one-off script through Circle's Developer-Controlled Wallets API):

```
USDC.approve(factory_address, type(uint256).max)
```

If you'd rather do this from Foundry, ping me and I'll write a quick `forge script` to do it.

---

## 6. Update the frontend `.env`

In `frontend/.env`:

```bash
NEXT_PUBLIC_LMSR_FACTORY_ADDRESS=0x<from step 4>
NEXT_PUBLIC_OUTCOME_TOKENS_ADDRESS=0x<from step 4>
CIRCLE_TREASURY_WALLET_ID=<the Circle wallet ID of your treasury wallet>
```

The factory + tokens addresses are public (used by client-side reads). The treasury wallet ID is server-only.

---

## 7. Wind down the parimutuel markets

Before we cut over the codebase to LMSR-only, all in-flight parimutuel markets need to be in a terminal state.

For each market in `prisma studio` with `status IN ('active', 'pending_resolve', 'resolving')`:

- **If past expiry and has both YES + NO bets:** let the cron resolver pick it up; it'll resolve via GenLayer.
- **If past expiry and one-sided:** the resolver pipeline already short-circuits and refunds.
- **If still future-dated but you want to nuke it:** use the admin "Resolve dispute" / manual-resolve action to force-settle, or run the cleanup SQL I'll write if you find any that won't go gracefully.

Once everything is `resolved | refunded | failed`, ping me — that unblocks the cleanup PR that deletes parimutuel code paths.

---

## 8. Hand back to me

Reply with:
1. ✅ `forge test` passed
2. ✅ Contract addresses from step 4
3. ✅ `.env` updated
4. ✅ Treasury wallet funded + approved factory
5. ✅ Outstanding parimutuel markets wound down

I'll resume from `lib/arc-userops.ts` and work through the backend, frontend, and final cleanup PR. No more user input needed until end-to-end smoke testing.
