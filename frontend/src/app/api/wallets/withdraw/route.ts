export const dynamic = "force-dynamic";

/**
 * POST /api/wallets/withdraw
 *
 * Withdraw USDC from the user's Circle Genetia Wallet to either:
 *   - a linked external wallet, or
 *   - a manually entered, valid EVM address.
 *
 * Identity from Bearer token. The frontend cannot choose the source
 * wallet — it's always the user's single CircleWallet from the DB.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { Decimal } from "@/lib/decimal";
import { executeCircleTransfer, makeIdempotencyKey, getOnChainUsdcBalance } from "@/lib/circle";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";

const schema = z.object({
  destinationAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const { destinationAddress, amount } = parsed.data;

    const baseUser = await createOrGetUserFromPrivyAuth(auth);
    const user = await prisma.user.findUnique({
      where: { id: baseUser.id },
      include: { circleWallet: true, walletBalance: true },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!user.circleWallet) {
      return NextResponse.json({ error: "Genetia Wallet not provisioned" }, { status: 409 });
    }

    const amt = new Decimal(amount);

    // Check against live on-chain USDC balance — the DB ledger is no longer
    // authoritative under LMSR v2 (buys/sells move USDC in/out of the wallet
    // outside the deposit-watcher loop). Arc RPC is the source of truth.
    let onChainBal = new Decimal(0);
    try {
      const raw = await getOnChainUsdcBalance(user.circleWallet.address);
      onChainBal = new Decimal(raw.toString());
    } catch (err) {
      console.warn("[wallets/withdraw] on-chain balance fetch failed", err);
      // Fall back to DB ledger if RPC is down.
      onChainBal = user.walletBalance?.availableBalance ?? new Decimal(0);
    }

    if (onChainBal.lessThan(amt)) {
      return NextResponse.json(
        {
          error: "Insufficient balance",
          onChainBalance: onChainBal.toString(),
          requested: amt.toString(),
        },
        { status: 400 }
      );
    }

    const idempotencyKey = makeIdempotencyKey("withdraw", user.id + "-" + Date.now());

    // No optimistic deduction needed — Circle either succeeds (chain moves
    // USDC, next /api/wallets/balance call will reflect it) or throws.
    const transfer = await executeCircleTransfer({
      walletId: user.circleWallet.circleWalletId,
      destinationAddress,
      amount,
      idempotencyKey,
    });
    const transferId = transfer.id;

    const tx = await prisma.walletTransaction.create({
      data: {
        userId: user.id,
        txHash: transferId,
        amount: amt,
        type: "WITHDRAWAL",
        status: "pending",
        metadata: { destinationAddress },
      },
    });

    return NextResponse.json({ txId: tx.id, circleTransferId: transferId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[wallets/withdraw]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
