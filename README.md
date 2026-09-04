# Genetia

Genetia is a gas-abstracted prediction-market protocol for broad YES/NO questions. Base Sepolia (chain 84532) is the financial network; GenLayer Studio Dev (chain 61997) is the resolution layer. Every activated market is bound to an immutable resolution manifest and an immutable contract release.

## Architecture

- Base contracts: `contracts/base` — Pool, Live Price/LMSR, vaults, risk caps, fees, immutable release registry, and resolution transport.
- GenLayer Intelligent Contracts: `contracts/genlayer` — `MarketAdmissibility`, `ResolverFactory`, and immutable per-market `MarketResolver`.
- Cloudflare: `apps/api-worker`, orchestration, queues, workflows, cron, Hyperdrive, and five independently keyed watcher deployments.
- Supabase Postgres: indexed/application data only; Base and GenLayer remain authoritative.
- Frontend target: Vercel with Privy user-owned wallets, wagmi/viem, and no custodial betting balance.

## Locked economic constants

Pool fee is 1.50% (10% creator / 90% Genetia), with no fee on VOID. LMSR trading fee is 1.00% (50% LP vault / 10% creator / 40% Genetia), with no terminal redemption fee. LMSR `b` is 100–5,000 USDC and funding is `max(100 USDC, ceil(1.10 × b × ln(2)))`. Market and system exposure caps are 25,000 and 250,000 USDC. There is no fixed wager or LP contribution minimum; the separate proposal bond is 2 USDC.

## Development

```text
pnpm install --frozen-lockfile
pnpm --filter @genetia/api-worker typecheck
pnpm --filter @genetia/resolution-watcher typecheck
cd contracts/base && forge build && forge test
```

Deployment manifests are under `deployments/`. They intentionally contain null/not-deployed values until real credentials and verified transactions exist. Never use fake transaction hashes or deploy dirty code.

## Security boundary

No staff operation can choose an outcome. A Base market accepts only a verified 3-of-5 watcher envelope for a finalized, successful GenLayer execution, or permissionless `expireToVoid()` after its absolute terminal deadline. Exits remain callable through normal pause/cap states and old immutable releases are never forcibly migrated.
