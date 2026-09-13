#!/usr/bin/env node
/**
 * Debug: list everything Circle thinks it has for a given wallet, plus
 * everything we've credited locally. Helps explain why a balance hasn't
 * caught up to on-chain.
 *
 *   node scripts/inspect-circle-deposits.mjs <walletAddress>
 *
 * Looks up the Circle wallet by address (from our DB), then pulls the
 * raw transactions list from Circle and compares to wallet_transactions.
 */

import crypto from "node:crypto";
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

const CIRCLE_API_BASE = "https://api.circle.com/v1/w3s";

function headers() {
  const key = process.env.CIRCLE_API_KEY;
  if (!key) throw new Error("CIRCLE_API_KEY not set");
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}

async function listAllTxs(walletId) {
  // No type filter — we want to see everything (INBOUND + OUTBOUND).
  const url = `${CIRCLE_API_BASE}/transactions?walletIds=${walletId}&pageSize=50`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(`Circle listTransactions failed: ${await res.text()}`);
  }
  const body = await res.json();
  return body?.data?.transactions ?? [];
}

async function main() {
  const walletAddress = process.argv[2];
  if (!walletAddress) {
    console.error("Usage: node scripts/inspect-circle-deposits.mjs <walletAddress>");
    process.exit(1);
  }

  // 1. Look up Circle wallet id from our DB.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const cw = await prisma.circleWallet.findFirst({
    where: { address: { equals: walletAddress, mode: "insensitive" } },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!cw) {
    console.error(`No CircleWallet row for ${walletAddress}`);
    process.exit(1);
  }
  console.log(`User:           ${cw.user.email ?? cw.user.id}`);
  console.log(`Wallet id:      ${cw.circleWalletId}`);
  console.log(`Address:        ${cw.address}`);
  console.log("");

  // 2. Pull Circle transactions.
  console.log("─── Circle transactions ────────────────────────────────────");
  const txs = await listAllTxs(cw.circleWalletId);
  console.log(`Found ${txs.length} tx(s):`);
  for (const t of txs) {
    const ts = t.createDate ?? "";
    const amt = (t.amounts ?? []).join(",");
    console.log(
      `  ${t.transactionType ?? "?"}  ${t.state}  ${amt} USDC  ${ts}  id=${t.id}  onChain=${t.txHash ?? "—"}`
    );
  }
  console.log("");

  // 3. What we have in wallet_transactions for that user.
  console.log("─── Our wallet_transactions ─────────────────────────────────");
  const local = await prisma.walletTransaction.findMany({
    where: { userId: cw.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  console.log(`Found ${local.length} row(s):`);
  for (const w of local) {
    console.log(
      `  ${w.type}  ${w.amount}  status=${w.status}  txHash=${w.txHash ?? "—"}  ${w.createdAt.toISOString()}`
    );
  }
  console.log("");

  // 4. Cross-reference: which Circle INBOUND tx ids are missing from local?
  const inbound = txs.filter((t) => t.transactionType === "INBOUND");
  const credited = new Set(
    local.filter((w) => w.type === "DEPOSIT").map((w) => w.txHash)
  );
  console.log("─── Reconciliation ─────────────────────────────────────────");
  let missing = 0;
  for (const t of inbound) {
    const has = credited.has(t.id);
    const status = ["CONFIRMED", "COMPLETE"].includes(t.state) ? "✓" : `state=${t.state}`;
    console.log(
      `  ${has ? "✓ credited" : "✗ MISSING"}  ${status}  ${t.amounts?.[0]} USDC  ${t.id}`
    );
    if (!has) missing++;
  }
  if (missing === 0) {
    console.log("\nAll Circle inbound transactions are already credited.");
    console.log("If on-chain balance > internal ledger, Circle hasn't indexed the");
    console.log("most recent faucet drop yet — wait and re-run this script.");
  } else {
    console.log(`\n${missing} inbound tx(s) NOT yet credited locally.`);
    console.log("Likely cause: non-terminal state (PENDING / SENT etc).");
    console.log("The deposit watcher only credits CONFIRMED/COMPLETE.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("✗ Failed:", err.message ?? err);
  process.exit(1);
});
