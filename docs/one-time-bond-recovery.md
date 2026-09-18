# One-time confirmed bond recovery

## Why it existed

The first production proposal submission successfully locked the 2 USDC bond on Base Sepolia, but the API database insert failed because the initial migration created `Proposal.id` as NOT NULL without a database default. The wallet transaction was successful; only the durable database recording failed.

## Recovery transaction

- Bond transaction: `0x7b4dbe380885e30b027307092bc01e4d902235a62808e3aa73dc849f8793d084`
- On-chain proposal ID: `0x45e228fec2551cd427b28cae36440c9ab551a0c1eca374a7d02bf26334d2402f`
- Network: Base Sepolia (`84532`)
- Bond: 2 USDC
- Escrow: `0x6C80477aC761615Dc421859511991e736Cb39E20`

The recovery path verifies the exact transaction receipt, sender wallet, escrow destination, `BondLocked` event, and 2 USDC transfer. It does not request another wallet signature or transfer.

## How it was used

The recovery URL included the existing transaction hash:

```text
/create?recoverTx=<confirmed-bond-transaction-hash>
```

The user re-entered the original market terms and submitted. The API reused the confirmed bond and started the normal admissibility workflow.

## Cleanup

After confirming the proposal is fully recorded and the market lifecycle is complete, remove the temporary `RECOVERY_BOND_TX_HASH` Worker variable and the recovery branch from the API/frontend. The normal path must continue to derive proposal IDs canonically and must never request approval when the required allowance already exists.