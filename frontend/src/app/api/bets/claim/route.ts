export const dynamic = "force-dynamic";

/**
 * POST /api/bets/claim
 *
 * After a market is `Finalized` on-chain, the user redeems their YES/NO
 * tokens for USDC by calling `Market.redeem(yesAmount, noAmount)`. We pull
 * the current token balances from chain and submit the full redemption in
 * one userOp.
 *
 * Body: { marketId }
 *
 * Payout rules (handled on-chain):
 *   - YES wins  → 1 YES token = 1 USDC, NO tokens burn for 0.
 *   - NO  wins  → 1 NO  token = 1 USDC, YES tokens burn for 0.
 *   - INVALID   → both burn pro-rata against remaining collateral.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPublicClient, http, type Address } from "viem";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";
import { callContract, makeArcIdempotencyKey } from "@/lib/arc-userops";
import { LMSR_MARKET_ABI, OUTCOME_TOKENS_ABI } from "@/lib/lmsr-abi";

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
const OUTCOME_TOKENS_ADDR = (process.env.NEXT_PUBLIC_OUTCOME_TOKENS_ADDRESS ?? "") as Address | "";

const schema = z.object({ marketId: z.string().min(1) });

function arcChain() {
  return {
    id: ARC_CHAIN_ID,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [ARC_RPC] } },
  } as const;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const { marketId } = parsed.data;

    if (!OUTCOME_TOKENS_ADDR) {
      return NextResponse.json({ error: "OutcomeTokens address not configured" }, { status: 500 });
    }

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
    if (market.lmsrStatus !== "Finalized") {
      return NextResponse.json(
        { error: `Market is ${market.lmsrStatus ?? "not finalized"} — cannot redeem yet` },
        { status: 400 }
      );
    }
    if (!market.marketIdOnChain) {
      return NextResponse.json({ error: "Market id-on-chain missing — indexer hasn't caught up" }, { status: 503 });
    }

    const userAddr = user.circleWallet.address as Address;
    const onChainId = BigInt(market.marketIdOnChain.toFixed());
    const yesTokenId = onChainId * 2n + 1n;
    const noTokenId = onChainId * 2n + 0n;

    // Snapshot the user's outcome-token balances on chain right now.
    const pub = createPublicClient({ chain: arcChain(), transport: http(ARC_RPC) });
    const [yesBal, noBal] = (await Promise.all([
      pub.readContract({
        address: OUTCOME_TOKENS_ADDR as Address,
        abi: OUTCOME_TOKENS_ABI,
        functionName: "balanceOf",
        args: [userAddr, yesTokenId],
      }),
      pub.readContract({
        address: OUTCOME_TOKENS_ADDR as Address,
        abi: OUTCOME_TOKENS_ABI,
        functionName: "balanceOf",
        args: [userAddr, noTokenId],
      }),
    ])) as [bigint, bigint];

    if (yesBal === 0n && noBal === 0n) {
      return NextResponse.json({ error: "No outcome tokens to redeem" }, { status: 400 });
    }

    const result = await callContract({
      walletId: user.circleWallet.circleWalletId,
      contractAddress: market.arcAddress as Address,
      abi: LMSR_MARKET_ABI,
      functionName: "redeem",
      args: [yesBal, noBal],
      idempotencyKey: makeArcIdempotencyKey("redeem", [user.id, marketId]),
      refId: `redeem-${marketId}`,
    });

    return NextResponse.json({
      circleTxId: result.txId,
      state: result.state,
      marketId,
      yesRedeemed: yesBal.toString(),
      noRedeemed: noBal.toString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status =
      msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[bets/claim]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
