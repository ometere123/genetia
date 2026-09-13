export const dynamic = "force-dynamic";

/**
 * GET  /api/wallets/transactions   — list recent transactions
 * POST /api/wallets/transactions   — record a deposit observed on-chain
 *
 * Identity from verified Privy auth token.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { Decimal } from "@/lib/decimal";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";

const depositSchema = z.object({
  txHash: z.string().optional(),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const baseUser = await createOrGetUserFromPrivyAuth(auth);

    const transactions = await prisma.walletTransaction.findMany({
      where: { userId: baseUser.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ transactions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[wallets/transactions GET]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const body = await req.json();
    const parsed = depositSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const { txHash, amount } = parsed.data;
    const baseUser = await createOrGetUserFromPrivyAuth(auth);
    const amt = new Decimal(amount);

    const tx = await prisma.walletTransaction.create({
      data: {
        userId: baseUser.id,
        txHash,
        amount: amt,
        type: "DEPOSIT",
        status: txHash ? "confirmed" : "pending",
      },
    });

    if (txHash) {
      await prisma.walletBalance.upsert({
        where: { userId: baseUser.id },
        create: { userId: baseUser.id, availableBalance: amt },
        update: { availableBalance: { increment: amt } },
      });
    }

    return NextResponse.json({ txId: tx.id, status: tx.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[wallets/transactions POST]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
