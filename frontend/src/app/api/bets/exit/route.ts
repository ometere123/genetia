export const dynamic = "force-dynamic";

/**
 * POST /api/bets/exit
 *
 * Sell outcome tokens back to the market AMM at the current LMSR price.
 * "Cash out" UI button. The Market contract is registered as a token
 * minter/burner, so no ERC-1155 approval is needed from the user.
 *
 * Body: { marketId, side: "YES"|"NO", shares, minReturn }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";
import { callContract, makeArcIdempotencyKey } from "@/lib/arc-userops";
import { LMSR_MARKET_ABI } from "@/lib/lmsr-abi";
import { canTradeMarket } from "@/lib/market-policy";

const schema = z.object({
  marketId: z.string().min(1),
  side: z.enum(["YES", "NO"]),
  shares: z.string().regex(/^\d+(\.\d{1,6})?$/),
  minReturn: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

function toMicros(decimalString: string): bigint {
  const [intPart, fracPart = ""] = decimalString.split(".");
  const frac = (fracPart + "000000").slice(0, 6);
  return BigInt(intPart) * 1_000_000n + BigInt(frac || "0");
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const { marketId, side, shares, minReturn } = parsed.data;

    const baseUser = await createOrGetUserFromPrivyAuth(auth);
    const [user, market] = await Promise.all([
      prisma.user.findUnique({
        where: { id: baseUser.id },
        include: { circleWallet: true },
      }),
      prisma.market.findUnique({ where: { id: marketId } }),
    ]);

    if (!user?.circleWallet) {
      return NextResponse.json({ error: "Wallet not provisioned" }, { status: 409 });
    }
    if (!market?.arcAddress) {
      return NextResponse.json({ error: "Market has no on-chain contract" }, { status: 400 });
    }
    if (market.lmsrStatus && market.lmsrStatus !== "Active") {
      return NextResponse.json({ error: `Market is ${market.lmsrStatus}, cannot sell` }, { status: 400 });
    }
    if (market.expiry < new Date()) {
      return NextResponse.json({ error: "Trading has closed (past expiry)" }, { status: 400 });
    }

    const policyDecision = canTradeMarket(user, market);
    if (!policyDecision.allowed) {
      return NextResponse.json(
        {
          error: "Trade blocked by app-level market policy",
          reasons: policyDecision.reasons,
          policy: policyDecision.policy,
        },
        { status: 403 }
      );
    }

    const outcome = side === "YES" ? 1 : 0;
    const sharesMicros = toMicros(shares);
    const minReturnMicros = toMicros(minReturn);

    const result = await callContract({
      walletId: user.circleWallet.circleWalletId,
      contractAddress: market.arcAddress as `0x${string}`,
      abi: LMSR_MARKET_ABI,
      functionName: "sell",
      args: [outcome, sharesMicros, minReturnMicros],
      idempotencyKey: makeArcIdempotencyKey("sell", [user.id, marketId, side, shares, Date.now().toString()]),
      refId: `sell-${marketId}-${side}`,
    });

    return NextResponse.json({
      circleTxId: result.txId,
      state: result.state,
      marketId,
      side,
      shares,
      minReturn,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status =
      msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[bets/exit]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
