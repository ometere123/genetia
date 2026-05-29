export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/positions
 *
 * Returns the authenticated user's open outcome-token positions, read
 * live from Arc. Indexed `ArcTrade` rows give us the candidate market
 * list; we then call `balanceOf` for each (yesId, noId) pair so we
 * never display stale balances.
 *
 * Used by the Wallet page "Positions" tab.
 */

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";
import { OUTCOME_TOKENS_ABI, LMSR_MARKET_ABI, statusLabel } from "@/lib/lmsr-abi";
import { priceYes, priceAsFloat, type LMSRState } from "@/lib/lmsr";

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
const OUTCOME_TOKENS_ADDR = (process.env.NEXT_PUBLIC_OUTCOME_TOKENS_ADDRESS ?? "") as Address | "";

function arcChain() {
  return {
    id: ARC_CHAIN_ID,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [ARC_RPC] } },
  } as const;
}

export interface PositionSummary {
  marketId: string;
  marketTitle: string;
  marketStatus: string;
  lmsrStatus: string | null;
  arcAddress: string;
  yesShares: string; // decimal USDC string
  noShares: string;
  /** Current YES probability, 0..1, sampled live from chain. */
  priceYes: number;
  /** Estimated value if sold right now (sum of sell-quotes). */
  estimatedValue: string;
  /** Settled outcome if Finalized, else null. */
  resolution: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const baseUser = await createOrGetUserFromPrivyAuth(auth);
    const user = await prisma.user.findUnique({
      where: { id: baseUser.id },
      include: { circleWallet: true },
    });

    if (!user?.circleWallet || !OUTCOME_TOKENS_ADDR) {
      return NextResponse.json({ positions: [] });
    }
    const userAddr = user.circleWallet.address as Address;

    // Candidate markets: anything this address has ever traded on.
    const candidateMarkets = await prisma.market.findMany({
      where: {
        marketIdOnChain: { not: null },
        arcAddress: { not: null },
        arcTrades: { some: { userAddress: userAddr } },
      },
      select: {
        id: true,
        title: true,
        status: true,
        lmsrStatus: true,
        arcAddress: true,
        marketIdOnChain: true,
        lmsrB: true,
        settlement: { select: { resolution: true } },
      },
      take: 200,
    });

    if (candidateMarkets.length === 0) {
      return NextResponse.json({ positions: [] });
    }

    const pub = createPublicClient({ chain: arcChain(), transport: http(ARC_RPC) });
    const positions: PositionSummary[] = [];

    for (const m of candidateMarkets) {
      if (!m.marketIdOnChain || !m.arcAddress) continue;
      const onChainId = BigInt(m.marketIdOnChain.toFixed());
      const yesId = onChainId * 2n + 1n;
      const noId  = onChainId * 2n;

      const [yesBalRaw, noBalRaw, qYesRaw, qNoRaw, bRaw, statusRaw] = (await Promise.all([
        pub.readContract({ address: OUTCOME_TOKENS_ADDR as Address, abi: OUTCOME_TOKENS_ABI, functionName: "balanceOf", args: [userAddr, yesId] }),
        pub.readContract({ address: OUTCOME_TOKENS_ADDR as Address, abi: OUTCOME_TOKENS_ABI, functionName: "balanceOf", args: [userAddr, noId] }),
        pub.readContract({ address: m.arcAddress as Address, abi: LMSR_MARKET_ABI, functionName: "qYes" }),
        pub.readContract({ address: m.arcAddress as Address, abi: LMSR_MARKET_ABI, functionName: "qNo" }),
        pub.readContract({ address: m.arcAddress as Address, abi: LMSR_MARKET_ABI, functionName: "b" }),
        pub.readContract({ address: m.arcAddress as Address, abi: LMSR_MARKET_ABI, functionName: "status" }),
      ])) as [bigint, bigint, bigint, bigint, bigint, number | bigint];

      if (yesBalRaw === 0n && noBalRaw === 0n) continue;

      const state: LMSRState = { qYes: qYesRaw, qNo: qNoRaw, b: bRaw };
      const pY = priceAsFloat(priceYes(state));

      // Estimated value if sold now: priced via LMSR sell-quote per side.
      // We compute conservatively as `shares × side-price` (good-enough for UI).
      const yesValue = (Number(yesBalRaw) / 1_000_000) * pY;
      const noValue  = (Number(noBalRaw)  / 1_000_000) * (1 - pY);
      const estValue = yesValue + noValue;

      positions.push({
        marketId: m.id,
        marketTitle: m.title,
        marketStatus: m.status,
        lmsrStatus: statusLabel(Number(statusRaw)),
        arcAddress: m.arcAddress,
        yesShares: (Number(yesBalRaw) / 1_000_000).toFixed(6),
        noShares: (Number(noBalRaw) / 1_000_000).toFixed(6),
        priceYes: pY,
        estimatedValue: estValue.toFixed(2),
        resolution: m.settlement?.resolution ?? null,
      });
    }

    return NextResponse.json({ positions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status =
      msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[wallet/positions]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
