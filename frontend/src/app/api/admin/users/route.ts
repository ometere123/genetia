export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users — list users with balances and Genetia Wallet
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { searchParams } = req.nextUrl;
    const limit  = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
    const offset = parseInt(searchParams.get("offset") ?? "0");
    const q      = searchParams.get("q");

    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { primaryExternalWallet: { contains: q, mode: "insensitive" } },
              { circleWallet: { address: { contains: q, mode: "insensitive" } } },
            ],
          }
        : undefined,
      include: {
        walletBalance: true,
        circleWallet: true,
        linkedWallets: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    // Count arc trades per wallet address (LMSR v2 — bets table is legacy)
    const walletAddresses = users
      .map((u) => u.circleWallet?.address)
      .filter((a): a is string => !!a);

    const tradeRows = walletAddresses.length
      ? await prisma.arcTrade.groupBy({
          by: ["userAddress"],
          where: { userAddress: { in: walletAddresses } },
          _count: { id: true },
        })
      : [];

    const tradeCountByAddress = new Map(
      tradeRows.map((r) => [r.userAddress.toLowerCase(), r._count.id])
    );

    const shaped = users.map((u) => {
      const addr = (u.circleWallet?.address ?? "").toLowerCase();
      const available = u.walletBalance?.availableBalance;
      const locked    = u.walletBalance?.lockedBalance;
      return {
        id: u.id,
        privyUserId: u.privyUserId,
        email: u.email,
        primaryExternalWallet: u.primaryExternalWallet,
        genetiaWalletAddress: u.circleWallet?.address ?? null,
        genetiaWalletBlockchain: u.circleWallet?.blockchain ?? null,
        linkedWalletCount: u.linkedWallets.length,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt,
        // Divide by 1_000_000 — balances are stored in micro-USDC (Circle integer units)
        walletBalance: u.walletBalance
          ? {
              availableBalance: available
                ? (Number(available.toString()) / 1_000_000).toFixed(6)
                : "0",
              lockedBalance: locked
                ? (Number(locked.toString()) / 1_000_000).toFixed(6)
                : "0",
            }
          : null,
        arcTradeCount: tradeCountByAddress.get(addr) ?? 0,
      };
    });

    const total = await prisma.user.count();
    return NextResponse.json({ users: shaped, total });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
