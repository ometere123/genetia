export const dynamic = "force-dynamic";

/**
 * GET /api/wallets/balance
 *
 * Returns the user's Genetia Wallet balance, syncing any new Circle
 * inbound deposits into the internal ledger first.
 *
 * Identity from Bearer token.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { getOnChainUsdcBalance } from "@/lib/circle";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";
import { syncDepositsForUser } from "@/lib/deposit-watcher";

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const baseUser = await createOrGetUserFromPrivyAuth(auth);

    // First make sure any new on-chain deposits are reflected in the ledger.
    let depositSync = null;
    try {
      depositSync = await syncDepositsForUser(baseUser.id);
    } catch (err) {
      console.warn("[wallets/balance] deposit sync failed", err);
    }

    const user = await prisma.user.findUnique({
      where: { id: baseUser.id },
      include: { circleWallet: true, walletBalance: true },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!user.circleWallet) {
      return NextResponse.json({ error: "Genetia Wallet not provisioned" }, { status: 409 });
    }

    // In LMSR v2 the on-chain USDC balance IS the available balance. Buys,
    // sells, and withdrawals all move USDC in/out of the wallet, so any
    // DB-side `availableBalance` tracking drifts. Source of truth = chain.
    //
    // We read USDC.balanceOf(walletAddress) directly via Arc RPC rather than
    // Circle's /balances endpoint — Circle's balance indexer lags behind
    // actual on-chain state by minutes on testnet.
    let onChainUsdc: number | null = null;
    try {
      onChainUsdc = await getOnChainUsdcBalance(user.circleWallet.address);
    } catch (err) {
      console.warn("[wallets/balance] on-chain USDC balanceOf failed", err);
    }

    const available =
      onChainUsdc != null
        ? onChainUsdc.toFixed(6)
        : user.walletBalance?.availableBalance.toString() ?? "0";

    return NextResponse.json({
      genetiaWallet: {
        circleWalletId: user.circleWallet.circleWalletId,
        address: user.circleWallet.address,
        blockchain: user.circleWallet.blockchain,
        accountType: user.circleWallet.accountType,
      },
      balance: {
        available,
        // `locked` / `pending` are LMSR-legacy. With outcome tokens, "locked"
        // value is your position's market value, not USDC in escrow.
        locked: "0",
        pending: "0",
        onChainUsdc: onChainUsdc != null ? onChainUsdc.toString() : "unknown",
      },
      depositSync,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[wallets/balance]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
