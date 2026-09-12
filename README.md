# Genetia

Genetia is an Arc-native prediction market using LMSR-based trading and GenLayer AI-powered outcome resolution.

Core positioning:

> Arc handles the financial market layer. GenLayer handles intelligent evidence-based outcome resolution.

This is testnet MVP software. It is not audited, not legal or financial advice, and not yet decentralised end to end.

## Architecture Overview

- Arc contracts: settle trading, collateral, challenge windows, finalisation, and redemption.
- Outcome tokens: ERC-1155 YES/NO position tokens per market.
- LMSR market maker: prices YES/NO shares with Hanson's LMSR curve and USDC collateral.
- Circle/Arc wallet layer: each user gets a Circle Developer-Controlled SCA wallet on Arc Testnet.
- GenLayer resolver: fetches evidence and produces the market verdict.
- Resolver pipeline: trusted app/relayer path that validates GenLayer verdicts and submits them to Arc.
- Frontend: Next.js market UI, trading panel, wallet flows, admin tools, and transparency disclosures.

## Text Diagram

```text
User
  |
  v
Frontend / Next.js app
  |
  v
Arc LMSRMarket.sol <-> OutcomeTokens.sol
  ^
  |
Resolver pipeline / trusted relayer
  ^
  |
GenLayer market_resolver.py
  ^
  |
Evidence sources
```

## Current Trust Model

- Arc contracts handle market trading, collateral, finalisation, and redemption.
- GenLayer generates evidence-based YES/NO verdicts.
- A trusted relayer/app pipeline submits validated GenLayer verdicts to Arc.
- A 24 hour challenge window starts after the relayer proposes the verdict.
- If challenged, admin adjudication is required in this MVP.
- Admin functions exist for testnet safety and operational recovery.
- Multisig dispute governance is intentionally not included yet.
- Compliance checks are app-level MVP controls unless a contract explicitly enforces them.

## Market Lifecycle

1. Admin creates or approves a market.
2. The app mirrors it to Arc through `LMSRMarketFactory`.
3. Users trade YES/NO through Circle SCA wallets.
4. At expiry, the resolver pipeline submits the question, criteria, and evidence sources to GenLayer.
5. GenLayer returns an evidence-based verdict.
6. The resolver pipeline validates the verdict and creates a resolver attestation.
7. The trusted relayer calls `proposeResolution(outcome)` on Arc.
8. The market enters the challenge window.
9. If unchallenged, anyone can finalise after the window.
10. If challenged, admin adjudication resolves the MVP dispute.
11. Users redeem outcome tokens on Arc.

## Important Files

```text
contracts/arc/src/lmsr/LMSRMarket.sol
contracts/arc/src/lmsr/LMSRMarketFactory.sol
contracts/arc/src/lmsr/OutcomeTokens.sol
contracts/genlayer/market_resolver.py
frontend/src/lib/resolver-pipeline.ts
frontend/src/lib/market-policy.ts
frontend/src/lib/circle.ts
frontend/src/lib/arc-userops.ts
frontend/src/lib/arc-indexer.ts
frontend/src/app/markets/[id]/page.tsx
relayer/src/index.ts
```

## Environment Variables

Start from `.env.example`. Do not commit real secrets.

Arc:

```env
NEXT_PUBLIC_ARC_CHAIN_ID=5042002
NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.network
NEXT_PUBLIC_ARC_EXPLORER_URL=https://testnet.arcscan.app
NEXT_PUBLIC_ARC_USDC_ADDRESS=0x3600000000000000000000000000000000000000
NEXT_PUBLIC_LMSR_FACTORY_ADDRESS=
NEXT_PUBLIC_OUTCOME_TOKENS_ADDRESS=
ARC_ADMIN_PRIVATE_KEY=
ARC_RESOLVER_PRIVATE_KEY=
ARC_OPERATOR_PRIVATE_KEY=
```

GenLayer:

```env
GENLAYER_RPC=https://studio.genlayer.com/api
GENLAYER_CHAIN_ID=61999
GENLAYER_CONTRACT_ADDRESS=0x7DE5e141bCD9c8c7f7Ab40396FF517859ec80172
NEXT_PUBLIC_GENLAYER_RESOLVER_ADDRESS=0x7DE5e141bCD9c8c7f7Ab40396FF517859ec80172
GENLAYER_RELAYER_PRIVATE_KEY=
```

Circle and Privy:

```env
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_SET_ID=
CIRCLE_BLOCKCHAIN=ARC-TESTNET
CIRCLE_ACCOUNT_TYPE=SCA
PRIVY_APP_ID=
PRIVY_APP_SECRET=
NEXT_PUBLIC_PRIVY_APP_ID=
```

App and cron:

```env
DATABASE_URL=
DIRECT_URL=
APP_URL=http://localhost:3000
CRON_SECRET=
POLL_INTERVAL_MS=60000
INDEX_INTERVAL_MS=30000
ADMIN_WALLET_ADDRESS=
NEXT_PUBLIC_ADMIN_ADDRESS=
NEXT_PUBLIC_ADMIN_SLUG=/admin
NEXT_PUBLIC_MIN_TRADE_USDC=0.01
NEXT_PUBLIC_MAX_TRADE_USDC=5000
```

## Local Development

Install frontend dependencies:

```bash
cd frontend
npm install
npm run db:generate
npm run dev
```

Run the cron pinger:

```bash
cd relayer
npm install
npm run dev
```

Compile and test Arc contracts:

```bash
cd contracts/arc
forge build
forge test -vvv
```

Build checks:

```bash
cd frontend
npm run lint
npm run build

cd ../relayer
npm run build
```

## Known Limitations

- The GenLayer-to-Arc bridge is trusted through the app/relayer.
- Challenged markets use admin adjudication.
- Dispute multisig/governance is not implemented yet.
- Compliance checks are MVP app-level controls unless a contract enforces them.
- Arc and GenLayer usage is testnet-oriented.
- The contracts are not production audited.
- The frontend relies on the Arc indexer cache for fast market reads.

## Roadmap

- Multisig or governance dispute module.
- Decentralised relayer set.
- Stronger indexer backfill and monitoring.
- Richer compliance and market policy engine.
- Independent resolver committees.
- Full smart contract and backend audit.
- Multi-stablecoin settlement if supported by Arc/Circle.
- Improved market creation templates and evidence standards.
