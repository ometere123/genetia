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
        _count: { select: { bets: true, transactions: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    });

    const shaped = users.map((u) => ({
      id: u.id,
      privyUserId: u.privyUserId,
      email: u.email,
      primaryExternalWallet: u.primaryExternalWallet,
      genetiaWalletAddress: u.circleWallet?.address ?? null,
      genetiaWalletBlockchain: u.circleWallet?.blockchain ?? null,
      linkedWalletCount: u.linkedWallets.length,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt,
      walletBalance: u.walletBalance,
      _count: u._count,
    }));

    const total = await prisma.user.count();
    return NextResponse.json({ users: shaped, total });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
