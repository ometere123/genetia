/**
 * Genetia deposit watcher — server-only.
 *
 * Production-grade pattern (testnet edition):
 *   1. List recent INBOUND transactions for the user's Circle wallet
 *      via Circle's `/transactions` endpoint (Circle is the source of
 *      truth — its indexer confirms when funds have actually landed).
 *   2. For each Circle transaction in a terminal-success state, check
 *      whether we've already credited it on the internal ledger by
 *      looking up the Circle tx ID in `wallet_transactions.tx_hash`.
 *   3. If not, atomically credit `availableBalance` and insert a
 *      DEPOSIT row tagged with that Circle tx ID.
 *
 * This dedupes by Circle's transaction ID, which is unique per inbound
 * USDC transfer — so balance is exact even if the watcher runs many
 * times concurrently.
 *
 * Trigger points:
 *   - On every `/api/wallets/balance` call (so the UI updates the
 *     moment a deposit lands and the user opens the wallet).
 *   - Could also be wired to a cron or Circle webhook later — both
 *     would just call `syncDepositsForUser` and rely on the same
 *     dedupe logic.
 */

import "server-only";

import { prisma } from "@/lib/db";
import { Decimal } from "@/lib/decimal";
import { listCircleTransactions } from "@/lib/circle";

const TERMINAL_SUCCESS = new Set(["CONFIRMED", "COMPLETE"]);

export interface DepositSyncResult {
  inspected: number;
  credited: number;
  totalCredited: string;
  details: { txId: string; amount: string }[];
}

export async function syncDepositsForUser(userId: string): Promise<DepositSyncResult> {
  const result: DepositSyncResult = {
    inspected: 0,
    credited: 0,
    totalCredited: "0",
    details: [],
  };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { circleWallet: true },
  });
  if (!user || !user.circleWallet) return result;

  // Pull recent inbound transactions from Circle.
  const txs = await listCircleTransactions({
    walletId: user.circleWallet.circleWalletId,
    type: "INBOUND",
    pageSize: 50,
  });
  result.inspected = txs.length;

  if (txs.length === 0) return result;

  // Filter to terminal-success only and pull the Circle tx IDs we want to credit.
  const candidates = txs.filter((t) => TERMINAL_SUCCESS.has(t.state));
  const candidateIds = candidates.map((t) => t.id);
  if (candidateIds.length === 0) return result;

  // Find which of those we've already credited (we store Circle's tx ID in tx_hash).
  const existing = await prisma.walletTransaction.findMany({
    where: {
      userId: user.id,
      type: "DEPOSIT",
      txHash: { in: candidateIds },
    },
    select: { txHash: true },
  });
  const alreadyCredited = new Set(existing.map((r) => r.txHash));

  // Credit anything new.
  let runningTotal = new Decimal(0);
  for (const tx of candidates) {
    if (alreadyCredited.has(tx.id)) continue;

    // Circle returns an array of amounts; for ERC-20 transfers it's just one.
    const amountStr = tx.amounts?.[0];
    if (!amountStr) continue;
    const amount = new Decimal(amountStr);
    if (amount.lessThanOrEqualTo(0)) continue;

    try {
      await prisma.$transaction([
        prisma.walletBalance.update({
          where: { userId: user.id },
          data: { availableBalance: { increment: amount } },
        }),
        prisma.walletTransaction.create({
          data: {
            userId: user.id,
            txHash: tx.id, // Circle tx ID — unique per inbound transfer
            amount,
            type: "DEPOSIT",
            status: "confirmed",
            metadata: {
              source: "circle",
              circleTxId: tx.id,
              onChainTxHash: tx.txHash ?? null,
              from: tx.sourceAddress ?? null,
              blockchain: tx.blockchain,
            },
          },
        }),
      ]);
      result.credited++;
      runningTotal = runningTotal.add(amount);
      result.details.push({ txId: tx.id, amount: amount.toString() });
    } catch (err) {
      // Unique-constraint race: another concurrent sync credited the same tx.
      // Safe to ignore — that row exists.
      console.warn("[deposit-watcher] skipped (likely race)", tx.id, err);
    }
  }

  result.totalCredited = runningTotal.toString();
  if (result.credited > 0) {
    console.log(
      `[deposit-watcher] user ${user.id}: credited ${result.credited} deposit(s) totalling ${result.totalCredited}`
    );
  }
  return result;
}
