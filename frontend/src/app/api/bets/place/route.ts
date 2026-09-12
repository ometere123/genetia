export const dynamic = "force-dynamic";

/**
 * POST /api/bets/place
 *
 * LMSR-v2: places a buy on the on-chain Market contract via the user's
 * Circle SCA. Returns the Circle transaction id; the indexer mirrors the
 * `Bought` event into Postgres on its next pass.
 *
 * Body: { marketId, side: "YES"|"NO", shares, maxCost }
 *   shares  — number of outcome tokens to buy, 6-decimal USDC units string ("25" = 25.000000)
 *   maxCost — slippage cap in USDC, includes the 2% fee.
 *
 * If the caller hasn't yet approved USDC for this Market contract, this
 * route silently submits an `approve(market, MAX_UINT256)` userOp first,
 * waits for confirmation, then the buy.
 *
 * GET /api/bets/place — list the authenticated user's recent on-chain trades.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPublicClient, http, type Address, maxUint256 } from "viem";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";
import { callContract, waitForArcTx, makeArcIdempotencyKey } from "@/lib/arc-userops";
import { LMSR_MARKET_ABI, USDC_ABI } from "@/lib/lmsr-abi";
import { canTradeMarket } from "@/lib/market-policy";

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
const ARC_USDC = (process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS ??
  "0x3600000000000000000000000000000000000000") as Address;

const schema = z.object({
  marketId: z.string().min(1),
  side: z.enum(["YES", "NO"]),
  shares: z.string().regex(/^\d+(\.\d{1,6})?$/),
  maxCost: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

function toMicros(decimalString: string): bigint {
  const [intPart, fracPart = ""] = decimalString.split(".");
  const frac = (fracPart + "000000").slice(0, 6);
  return BigInt(intPart) * 1_000_000n + BigInt(frac || "0");
}

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
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const { marketId, side, shares, maxCost } = parsed.data;

    const baseUser = await createOrGetUserFromPrivyAuth(auth);
    const [user, market] = await Promise.all([
      prisma.user.findUnique({
        where: { id: baseUser.id },
        include: { circleWallet: true },
      }),
      prisma.market.findUnique({ where: { id: marketId } }),
    ]);

    if (!user)            return NextResponse.json({ error: "User not found" },   { status: 404 });
    if (!user.circleWallet) return NextResponse.json({ error: "Wallet not provisioned" }, { status: 409 });
    if (!market)          return NextResponse.json({ error: "Market not found" }, { status: 404 });
    if (!market.arcAddress)
      return NextResponse.json({ error: "Market has no on-chain contract" }, { status: 400 });
    if (market.status !== "active")
      return NextResponse.json({ error: "Market is not active" }, { status: 400 });
    if (market.lmsrStatus && market.lmsrStatus !== "Active")
      return NextResponse.json({ error: `Market is ${market.lmsrStatus} on-chain` }, { status: 400 });
    if (market.expiry < new Date())
      return NextResponse.json({ error: "Market has expired" }, { status: 400 });

    const policyDecision = canTradeMarket(user, market, { amount: Number(maxCost) });
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
    const maxCostMicros = toMicros(maxCost);

    // Ensure the user's SCA has approved this Market contract for USDC pulls.
    const userAddr = user.circleWallet.address as Address;
    const marketAddr = market.arcAddress as Address;
    const pub = createPublicClient({ chain: arcChain(), transport: http(ARC_RPC) });
    const allowance = (await pub.readContract({
      address: ARC_USDC,
      abi: USDC_ABI,
      functionName: "allowance",
      args: [userAddr, marketAddr],
    })) as bigint;

    if (allowance < maxCostMicros) {
      const approve = await callContract({
        walletId: user.circleWallet.circleWalletId,
        contractAddress: ARC_USDC,
        abi: USDC_ABI,
        functionName: "approve",
        args: [marketAddr, maxUint256],
        idempotencyKey: makeArcIdempotencyKey("usdc-approve", [user.id, marketAddr]),
        refId: `approve-${marketId}`,
      });
      // Wait for approve to confirm before submitting the buy — otherwise it
      // races and reverts.
      await waitForArcTx(approve.txId);
    }

    const result = await callContract({
      walletId: user.circleWallet.circleWalletId,
      contractAddress: marketAddr,
      abi: LMSR_MARKET_ABI,
      functionName: "buy",
      args: [outcome, sharesMicros, maxCostMicros],
      idempotencyKey: makeArcIdempotencyKey("buy", [user.id, marketId, side, shares, Date.now().toString()]),
      refId: `buy-${marketId}-${side}`,
    });

    return NextResponse.json({
      circleTxId: result.txId,
      state: result.state,
      marketId,
      side,
      shares,
      maxCost,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status =
      msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[bets/place]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const baseUser = await createOrGetUserFromPrivyAuth(auth);
    const marketId = req.nextUrl.searchParams.get("marketId");

    const user = await prisma.user.findUnique({
      where: { id: baseUser.id },
      include: { circleWallet: true },
    });
    if (!user?.circleWallet) return NextResponse.json({ trades: [] });

    const trades = await prisma.arcTrade.findMany({
      where: {
        userAddress: user.circleWallet.address,
        ...(marketId ? { marketId } : {}),
      },
      include: {
        market: {
          select: {
            title: true,
            category: true,
            status: true,
            lmsrStatus: true,
            expiry: true,
            settlement: { select: { resolution: true } },
          },
        },
      },
      orderBy: { blockTime: "desc" },
      take: 100,
    });
    return NextResponse.json({ trades });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status =
      msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[bets GET]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
