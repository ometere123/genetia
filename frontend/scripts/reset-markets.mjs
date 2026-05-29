#!/usr/bin/env node
/**
 * Clean-slate reset for testing.
 *
 *   node scripts/reset-markets.mjs            # dry run (default)
 *   node scripts/reset-markets.mjs --commit   # actually delete
 *
 * Wipes everything market/trade related so we can start fresh:
 *   - markets, market_suggestions
 *   - bets, positions
 *   - settlements
 *   - arc_trades, indexer_cursors
 *   - market-related wallet_transactions (BET_LOCK, BET_RELEASE, PAYOUT,
 *     BET_LOSS, FEE) — keeps DEPOSIT and WITHDRAWAL audit trail
 *   - wallet_balances reset to 0 (will resync from Circle on next /wallet)
 *
 * Keeps untouched:
 *   - users
 *   - circle_wallets
 *   - linked_wallets
 *
 * Note: this does NOT touch anything on-chain. The LMSRMarketFactory still
 * holds the registry of past markets, and outcome tokens you minted before
 * still exist in your Circle wallet. Those are testnet so it doesn't matter,
 * but be aware.
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const commit = process.argv.includes("--commit");

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log(`Mode: ${commit ? "COMMIT (will delete)" : "DRY RUN (no changes)"}\n`);

  // Counts before
  const counts = {
    markets:           await prisma.market.count(),
    bets:              await prisma.bet.count(),
    positions:         await prisma.position.count(),
    settlements:       await prisma.settlement.count(),
    suggestions:       await prisma.marketSuggestion.count(),
    arcTrades:         await prisma.arcTrade.count(),
    cursors:           await prisma.indexerCursor.count(),
    marketTxs:         await prisma.walletTransaction.count({
                         where: {
                           type: { in: ["BET_LOCK", "BET_RELEASE", "PAYOUT", "BET_LOSS", "FEE"] },
                         },
                       }),
    walletBalances:    await prisma.walletBalance.count(),
    usersKept:         await prisma.user.count(),
    walletsKept:       await prisma.circleWallet.count(),
    linkedWalletsKept: await prisma.linkedWallet.count(),
    deposits:          await prisma.walletTransaction.count({ where: { type: "DEPOSIT" } }),
    withdrawals:       await prisma.walletTransaction.count({ where: { type: "WITHDRAWAL" } }),
  };

  console.log("─── Will delete ─────────────────────────────────────────────");
  console.log(`  markets:                ${counts.markets}`);
  console.log(`  market_suggestions:     ${counts.suggestions}`);
  console.log(`  bets:                   ${counts.bets}`);
  console.log(`  positions:              ${counts.positions}`);
  console.log(`  settlements:            ${counts.settlements}`);
  console.log(`  arc_trades:             ${counts.arcTrades}`);
  console.log(`  indexer_cursors:        ${counts.cursors}`);
  console.log(`  market wallet_txns:     ${counts.marketTxs}`);
  console.log(`  wallet_balances:        ${counts.walletBalances} (reset to 0; resync from chain)`);
  console.log("\n─── Will keep ───────────────────────────────────────────────");
  console.log(`  users:                  ${counts.usersKept}`);
  console.log(`  circle_wallets:         ${counts.walletsKept}`);
  console.log(`  linked_wallets:         ${counts.linkedWalletsKept}`);
  console.log(`  DEPOSIT wallet_txns:    ${counts.deposits}`);
  console.log(`  WITHDRAWAL wallet_txns: ${counts.withdrawals}`);
  console.log("");

  if (!commit) {
    console.log("(dry run — pass --commit to actually delete)");
    await prisma.$disconnect();
    return;
  }

  console.log("Deleting…\n");

  await prisma.$transaction([
    // FK order: things that reference markets first.
    prisma.arcTrade.deleteMany({}),
    prisma.bet.deleteMany({}),
    prisma.position.deleteMany({}),
    prisma.settlement.deleteMany({}),
    // suggestions are FK'd to markets via marketId; null out + delete
    prisma.marketSuggestion.deleteMany({}),
    prisma.market.deleteMany({}),
    prisma.indexerCursor.deleteMany({}),
    prisma.walletTransaction.deleteMany({
      where: { type: { in: ["BET_LOCK", "BET_RELEASE", "PAYOUT", "BET_LOSS", "FEE"] } },
    }),
    // Reset balances. Next /api/wallets/balance fetch overwrites available
    // from Circle's on-chain USDC balance anyway.
    prisma.walletBalance.updateMany({
      data: { availableBalance: 0, lockedBalance: 0, pendingBalance: 0 },
    }),
  ]);

  console.log("✓ Clean slate committed.\n");
  console.log("Next: restart your dev server so Prisma reconnects, then visit /wallet");
  console.log("to refresh balances from Circle.");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("✗ Failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
