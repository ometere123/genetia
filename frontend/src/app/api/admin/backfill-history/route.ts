export const dynamic = "force-dynamic";

/**
 * One-off backfill for wallet history rows on markets that resolved BEFORE
 * the resolver pipeline started writing PAYOUT / BET_LOSS rows.
 *
 * Safety properties:
 *   - Idempotent: skips any market that already has at least one PAYOUT or
 *     BET_LOSS row tagged with its marketId. So re-running is a no-op.
 *   - Insert-only: never updates balances, bets, settlements, or markets.
 *     Available balances were already credited by the original settle, so
 *     we only fill in the missing audit trail.
 *   - Atomic per market: each market is backfilled inside a single
 *     $transaction. A failure on one market does not leave half-rows.
 *   - Dry-run by default. Pass { commit: true } to actually write.
 *
 * Admin-gated. POST only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Decimal } from "@/lib/decimal";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";

const schema = z.object({
  commit: z.boolean().optional().default(false),
  marketId: z.string().optional(), // limit to a single market if provided
});

async function requireAdmin(req: NextRequest) {
  const auth = await verifyPrivyAuth(req);
  const user = await createOrGetUserFromPrivyAuth(auth);
  const adminEnv = (process.env.ADMIN_WALLET_ADDRESS ?? "").toLowerCase();
  const linkedLower = auth.linkedWallets.map((a) => a.toLowerCase());
  const matchesAdminEnv =
    !!adminEnv &&
    (linkedLower.includes(adminEnv) ||
      (user.primaryExternalWallet ?? "").toLowerCase() === adminEnv);
  if (!user.isAdmin && !matchesAdminEnv) {
    const err = new Error("Forbidden — admin only");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
  return user;
}

interface PerMarketResult {
  marketId: string;
  title: string;
  resolution: string | null;
  skipped: boolean;
  skipReason?: string;
  payoutsInserted: number;
  lossesInserted: number;
  payoutsTotal: string;
  lossesTotal: string;
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const { commit, marketId } = parsed.data;

    const markets = await prisma.market.findMany({
      where: {
        status: "resolved",
        ...(marketId ? { id: marketId } : {}),
      },
      include: {
        bets: true,
        settlement: true,
      },
    });

    const results: PerMarketResult[] = [];
    const FEE = new Decimal("0.02");

    for (const m of markets) {
      const res: PerMarketResult = {
        marketId: m.id,
        title: m.title,
        resolution: m.settlement?.resolution ?? null,
        skipped: false,
        payoutsInserted: 0,
        lossesInserted: 0,
        payoutsTotal: "0",
        lossesTotal: "0",
      };

      const winningSide = m.settlement?.resolution;
      if (winningSide !== "YES" && winningSide !== "NO") {
        res.skipped = true;
        res.skipReason = `settlement.resolution is ${winningSide ?? "null"} — not YES/NO, skipping`;
        results.push(res);
        continue;
      }

      // Idempotency guard — if any PAYOUT/BET_LOSS row already references
      // this marketId, the new settle path already handled it. Skip.
      const existing = await prisma.walletTransaction.findFirst({
        where: {
          type: { in: ["PAYOUT", "BET_LOSS"] },
          metadata: { path: ["marketId"], equals: m.id },
        },
        select: { id: true },
      });
      if (existing) {
        res.skipped = true;
        res.skipReason = "already has PAYOUT/BET_LOSS rows for this marketId";
        results.push(res);
        continue;
      }

      const winningPool = winningSide === "YES" ? m.yesPool : m.noPool;
      const totalPool = m.yesPool.add(m.noPool);

      // Aggregate per-user winnings using the same formula as settleMarket().
      const perUserWon = new Map<string, Decimal>();
      const losingBets: { id: string; userId: string; amount: Decimal; side: string }[] = [];

      for (const bet of m.bets) {
        if (bet.side === winningSide && winningPool.greaterThan(0)) {
          const payout = bet.amount.div(winningPool).mul(totalPool).mul(new Decimal(1).sub(FEE));
          perUserWon.set(bet.userId, (perUserWon.get(bet.userId) ?? new Decimal(0)).add(payout));
        } else if (bet.side !== winningSide) {
          losingBets.push({ id: bet.id, userId: bet.userId, amount: bet.amount, side: bet.side });
        }
      }

      const payoutInserts = Array.from(perUserWon.entries())
        .filter(([, won]) => won.greaterThan(0))
        .map(([userId, won]) => ({
          userId,
          amount: won,
          type: "PAYOUT" as const,
          status: "confirmed" as const,
          metadata: {
            marketId: m.id,
            resolution: winningSide,
            backfilled: true,
            reasoning: m.settlement?.reasoning ?? null,
          },
        }));

      const lossInserts = losingBets.map((b) => ({
        userId: b.userId,
        amount: b.amount,
        type: "BET_LOSS" as const,
        status: "confirmed" as const,
        metadata: {
          marketId: m.id,
          betId: b.id,
          side: b.side,
          resolution: winningSide,
          backfilled: true,
        },
      }));

      res.payoutsInserted = payoutInserts.length;
      res.lossesInserted = lossInserts.length;
      res.payoutsTotal = payoutInserts
        .reduce((acc, r) => acc.add(r.amount), new Decimal(0))
        .toFixed(2);
      res.lossesTotal = lossInserts
        .reduce((acc, r) => acc.add(r.amount), new Decimal(0))
        .toFixed(2);

      if (commit && (payoutInserts.length > 0 || lossInserts.length > 0)) {
        await prisma.$transaction([
          ...payoutInserts.map((data) => prisma.walletTransaction.create({ data })),
          ...lossInserts.map((data) => prisma.walletTransaction.create({ data })),
        ]);
      }

      results.push(res);
    }

    const summary = {
      mode: commit ? "committed" : "dry-run",
      marketsScanned: markets.length,
      marketsBackfilled: results.filter((r) => !r.skipped && (r.payoutsInserted + r.lossesInserted) > 0).length,
      marketsSkipped: results.filter((r) => r.skipped).length,
      totalPayoutRows: results.reduce((n, r) => n + r.payoutsInserted, 0),
      totalLossRows: results.reduce((n, r) => n + r.lossesInserted, 0),
    };

    return NextResponse.json({ summary, results });
  } catch (err) {
    const e = err as Error & { status?: number };
    const msg = e?.message ?? "Internal server error";
    const lower = msg.toLowerCase();
    const status =
      e?.status ??
      (lower.includes("forbidden") ? 403
        : lower.includes("privy") || msg.includes("Authorization") ? 401
          : 500);
    if (status === 500) console.error("[admin/backfill-history]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
