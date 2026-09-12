#!/usr/bin/env node
/**
 * Clean-slate reset for testing.
 *
 *   node scripts/reset-markets.mjs            # dry run (default)
 *   node scripts/reset-markets.mjs --commit   # actually delete
 *
 * Wipes everything market/trade related AND all non-admin users:
 *   - markets, market_suggestions
 *   - bets, positions
 *   - settlements
 *   - arc_trades, indexer_cursors
 *   - all wallet_transactions
 *   - wallet_balances
 *   - circle_wallets, linked_wallets
 *   - users (except admin — identified by isAdmin=true or ADMIN_WALLET_ADDRESS)
 *
 * Note: this does NOT touch anything on-chain. Testnet only.
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
const ADMIN_ADDRESS = (process.env.ADMIN_WALLET_ADDRESS ?? process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? "").toLowerCase();

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log(`Mode: ${commit ? "COMMIT (will delete)" : "DRY RUN (no changes)"}`);
  console.log(`Admin wallet kept: ${ADMIN_ADDRESS || "(none set — all users deleted)"}\n`);

  // Find admin user IDs to preserve
  const adminUsers = await prisma.user.findMany({
    where: {
      OR: [
        { isAdmin: true },
        ...(ADMIN_ADDRESS ? [{ primaryExternalWallet: { equals: ADMIN_ADDRESS, mode: "insensitive" } }] : []),
      ],
    },
    select: { id: true },
  });
  const adminIds = adminUsers.map((u) => u.id);

  const counts = {
    markets:        await prisma.market.count(),
    bets:           await prisma.bet.count(),
    positions:      await prisma.position.count(),
    settlements:    await prisma.settlement.count(),
    suggestions:    await prisma.marketSuggestion.count(),
    arcTrades:      await prisma.arcTrade.count(),
    cursors:        await prisma.indexerCursor.count(),
    allTxns:        await prisma.walletTransaction.count(),
    walletBalances: await prisma.walletBalance.count(),
    nonAdminUsers:  await prisma.user.count({ where: { id: { notIn: adminIds } } }),
    adminKept:      adminIds.length,
  };

  console.log("─── Will delete ─────────────────────────────────────────────");
  console.log(`  markets:                ${counts.markets}`);
  console.log(`  market_suggestions:     ${counts.suggestions}`);
  console.log(`  bets:                   ${counts.bets}`);
  console.log(`  positions:              ${counts.positions}`);
  console.log(`  settlements:            ${counts.settlements}`);
  console.log(`  arc_trades:             ${counts.arcTrades}`);
  console.log(`  indexer_cursors:        ${counts.cursors}`);
  console.log(`  wallet_transactions:    ${counts.allTxns}`);
  console.log(`  wallet_balances:        ${counts.walletBalances}`);
  console.log(`  non-admin users:        ${counts.nonAdminUsers}`);
  console.log("\n─── Will keep ───────────────────────────────────────────────");
  console.log(`  admin users:            ${counts.adminKept} (${adminIds.join(", ") || "none"})`);
  console.log("");

  if (!commit) {
    console.log("(dry run — pass --commit to actually delete)");
    await prisma.$disconnect();
    return;
  }

  console.log("Deleting…\n");

  // Step 1: delete everything that references markets or non-admin users
  await prisma.$transaction([
    prisma.arcTrade.deleteMany({}),
    prisma.bet.deleteMany({}),
    prisma.position.deleteMany({}),
    prisma.settlement.deleteMany({}),
    prisma.marketSuggestion.deleteMany({}),
    prisma.market.deleteMany({}),
    prisma.indexerCursor.deleteMany({}),
    prisma.walletTransaction.deleteMany({}),
    prisma.walletBalance.deleteMany({}),
  ]);

  // Step 2: delete non-admin user data (FK order)
  await prisma.linkedWallet.deleteMany({ where: { userId: { notIn: adminIds } } });
  await prisma.circleWallet.deleteMany({ where: { userId: { notIn: adminIds } } });
  await prisma.user.deleteMany({ where: { id: { notIn: adminIds } } });

  console.log("✓ Clean slate committed.\n");
  console.log("Next: visit the app — users will re-register fresh on next login.");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("✗ Failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
