export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics  — platform-level metrics
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const [
      totalUsers,
      totalMarkets,
      openMarkets,
      resolvedMarkets,
      totalBets,
      activeBets,
      allBalances,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.market.count(),
      prisma.market.count({ where: { status: "active" } }),
      prisma.market.count({ where: { status: "resolved" } }),
      prisma.bet.count(),
      prisma.bet.count({ where: { status: "active" } }),
      prisma.walletBalance.aggregate({
        _sum: {
          availableBalance: true,
          lockedBalance: true,
          pendingBalance: true,
        },
      }),
    ]);

    // Total volume = sum of all bet amounts ever
    const volumeAgg = await prisma.bet.aggregate({
      _sum: { amount: true },
    });

    // Winning bets payout
    const payoutAgg = await prisma.walletTransaction.aggregate({
      where: { type: "PAYOUT" },
      _sum: { amount: true },
    });

    const totalLocked  = allBalances._sum.lockedBalance ?? 0;
    const totalAvail   = allBalances._sum.availableBalance ?? 0;
    const totalPending = allBalances._sum.pendingBalance ?? 0;

    return NextResponse.json({
      users: {
        total: totalUsers,
      },
      markets: {
        total: totalMarkets,
        open: openMarkets,
        resolved: resolvedMarkets,
      },
      bets: {
        total: totalBets,
        active: activeBets,
      },
      volume: {
        total: volumeAgg._sum.amount?.toString() ?? "0",
        totalPayouts: payoutAgg._sum.amount?.toString() ?? "0",
      },
      treasury: {
        lockedFunds: totalLocked.toString(),
        availableFunds: totalAvail.toString(),
        pendingFunds: totalPending.toString(),
        totalCustody: (
          Number(totalLocked) +
          Number(totalAvail) +
          Number(totalPending)
        ).toString(),
      },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
