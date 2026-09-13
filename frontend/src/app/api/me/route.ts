export const dynamic = "force-dynamic";

/**
 * GET /api/me
 *
 * Returns the authenticated user's profile, linked wallets, and Genetia
 * Wallet. Identity is read from the verified Privy auth token.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    // Upsert in case this is the very first call.
    const baseUser = await createOrGetUserFromPrivyAuth(auth);

    const user = await prisma.user.findUnique({
      where: { id: baseUser.id },
      include: {
        linkedWallets: true,
        circleWallet: true,
        walletBalance: true,
      },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json({
      user: {
        id: user.id,
        privyUserId: user.privyUserId,
        email: user.email,
        primaryExternalWallet: user.primaryExternalWallet,
        isAdmin: user.isAdmin,
      },
      linkedWallets: user.linkedWallets.map((w) => ({
        address: w.address,
        chainType: w.chainType,
        walletType: w.walletType,
        provider: w.provider,
      })),
      genetiaWallet: user.circleWallet
        ? {
            provider: "circle",
            circleWalletId: user.circleWallet.circleWalletId,
            address: user.circleWallet.address,
            blockchain: user.circleWallet.blockchain,
            accountType: user.circleWallet.accountType,
            status: user.circleWallet.status,
          }
        : null,
      balance: user.walletBalance
        ? {
            available: user.walletBalance.availableBalance.toString(),
            locked: user.walletBalance.lockedBalance.toString(),
            pending: user.walletBalance.pendingBalance.toString(),
          }
        : { available: "0", locked: "0", pending: "0" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[me]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
