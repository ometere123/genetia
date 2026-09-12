# Deploying Genetia Arc contracts

End-to-end deploy of `MarketFactory.sol` to Arc Testnet using Foundry.
After this, the GenLayer → Arc relayer pipeline can push verdicts on-chain.

## 1. Install Foundry (one-time)

Windows: open PowerShell and run

```powershell
winget install Foundry
```

…or use WSL if `winget` doesn't find it. Verify with `forge --version`.

## 2. Set up `contracts/arc/.env`

```powershell
cd C:\Users\USER\Desktop\genetia\contracts\arc
Copy-Item .env.example .env
notepad .env
```

Fill in:
- `PRIVATE_KEY` — the deployer wallet's private key (needs Arc testnet gas).
- `RESOLVER_ADDRESS` — already pre-filled as `0xFffC471399903Bf35DF41A0cD1DB1165D525B7af`. This is the address paired with your `ARC_RESOLVER_PRIVATE_KEY` in `frontend/.env`. **Must match** or the relayer won't be able to settle markets.
- `ARCSCAN_API_KEY` — optional, only if you want auto-verification on Arcscan/Blockscout.

## 3. Fund the deployer

The `PRIVATE_KEY` address needs Arc testnet gas. Look at your `.env`'s address (run `cast wallet address $PRIVATE_KEY` to derive) and request gas from the Arc testnet faucet.

## 4. Install forge-std (one-time)

```powershell
cd C:\Users\USER\Desktop\genetia\contracts\arc
forge install foundry-rs/forge-std --no-commit
```

## 5. Deploy

PowerShell:

```powershell
$env:PRIVATE_KEY=(Select-String "^PRIVATE_KEY=" .env | ForEach-Object { ($_.Line -split "=", 2)[1] })
$env:RESOLVER_ADDRESS=(Select-String "^RESOLVER_ADDRESS=" .env | ForEach-Object { ($_.Line -split "=", 2)[1] })
$env:ARC_TESTNET_RPC_URL="https://rpc.testnet.arc.network"

forge script script/Deploy.s.sol:DeployGenetia `
  --rpc-url $env:ARC_TESTNET_RPC_URL `
  --broadcast `
  --private-key $env:PRIVATE_KEY
```

You'll see output like:

```
MarketFactory deployed at: 0xABCD...
Demo market deployed at:   0x1234...
```

**Copy the `MarketFactory` address.**

## 6. Wire the address into the frontend

Open `frontend/.env` and set:

```
NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=0xABCD...
```

Restart `npm run dev`. The frontend will now read on-chain market data
from your factory, and the resolver pipeline will be able to push verdicts
to individual `PredictionMarket` contracts once they're created via the
factory.

## What the script does

1. Deploys `MarketFactory(resolver = $RESOLVER_ADDRESS)`. The deployer becomes the factory `owner` (admin override) and the resolver becomes the trusted address allowed to call `resolve(bool)` on every spawned market.
2. Creates one demo market — "Will ETH surpass $10,000 before 2027?" — so the admin dashboard isn't empty after deploy.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `insufficient funds` | Deployer wallet has no Arc gas | Faucet → re-run |
| `RESOLVER_ADDRESS not set` | `.env` not sourced | Re-run the `$env:` lines above |
| `forge: command not found` | Foundry not installed / not on PATH | `winget install Foundry` then restart shell |
| `Failed to get chain id` | RPC URL typo | `https://rpc.testnet.arc.network` (no trailing slash) |
| `cannot estimate gas` | Address that doesn't match key | Re-derive: `cast wallet address $env:PRIVATE_KEY` |

## What's next

Once `NEXT_PUBLIC_MARKET_FACTORY_ADDRESS` is set, admin-approved suggestions can be **simultaneously** created in Postgres AND on Arc — but that integration is one switch away (the current admin approval flow writes to DB only). Holler when you want me to wire it.
