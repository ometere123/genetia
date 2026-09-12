export const dynamic = "force-dynamic";

/**
 * GET /api/admin/treasury
 *
 * Aggregates the protocol's on-chain financial state:
 *   - Treasury wallet's live USDC balance (Arc RPC)
 *   - Per-market: collateral, feesAccrued, redemption reserve, sweepable,
 *     LMSR seed b, status, finalizedAt
 *   - Totals across markets
 *
 * Admin-gated. Read-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";
import { LMSR_MARKET_ABI, statusLabel } from "@/lib/lmsr-abi";
import { getOnChainUsdcBalance } from "@/lib/circle";

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
const TREASURY_ADDRESS_FROM_ENV = process.env.NEXT_PUBLIC_TREASURY_ADDRESS ??
  process.env.TREASURY_ADDRESS ??
  "";

async function requireAdmin(req: NextRequest) {
  const auth = await verifyPrivyAuth(req);
  const user = await createOrGetUserFromPrivyAuth(auth);
  const adminEnv = (process.env.ADMIN_WALLET_ADDRESS ?? "").toLowerCase();
  const linkedLower = auth.linkedWallets.map((a) => a.toLowerCase());
  const matchesAdminEnv =
    !!adminEnv &&
    (linkedLower.includes(adminEnv) ||
      (user.primaryExternalWallet ?? "").toLowerCase() === adminEnv);
  if (!user.isAdmin && !matchesAdminEnv) {
    const err = new Error("Forbidden — admin only");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
  return user;
}

interface MarketTreasuryRow {
  marketId: string;
  title: string;
  arcAddress: string;
  marketIdOnChain: string;
  lmsrB: string;
  status: string;
  lmsrStatus: string | null;
  finalOutcome: string | null;
  /** USDC the contract holds, total. */
  contractBalance: string;
  /** LMSR collateral bucket (excludes feesAccrued). */
  collateral: string;
  /** Accumulated fees bucket — sweepable to treasury anytime. */
  feesAccrued: string;
  /** USDC the contract must keep to pay remaining redemptions. */
  redemptionReserve: string;
  /** Amount sweepable via sweepCollateral right now (0 if status != Finalized or in grace). */
  sweepableCollateral: string;
  /** True if status==Finalized AND grace period has passed. */
  collateralReady: boolean;
  /** Seconds remaining in grace period (0 if not finalized or grace passed). */
  graceRemainingSec: number;
}

function arcChain() {
  return {
    id: ARC_CHAIN_ID,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [ARC_RPC] } },
  } as const;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    // ── Treasury wallet ──
    const treasuryAddress = TREASURY_ADDRESS_FROM_ENV ||
      // Fall back to looking up the treasury wallet by CIRCLE_TREASURY_WALLET_ID
      // via the circle_wallets table (if we ever store it there). For now,
      // the env var is the source of truth.
      "";
    let treasuryBalance = "0";
    if (treasuryAddress) {
      try {
        const v = await getOnChainUsdcBalance(treasuryAddress);
        treasuryBalance = v.toFixed(6);
      } catch (err) {
        console.warn("[admin/treasury] treasury balance read failed", err);
      }
    }

    // ── Markets ──
    const markets = await prisma.market.findMany({
      where: { arcAddress: { not: null }, marketIdOnChain: { not: null } },
      select: {
        id: true,
        title: true,
        status: true,
        arcAddress: true,
        marketIdOnChain: true,
        lmsrB: true,
        lmsrStatus: true,
        proposedOutcome: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const pub = createPublicClient({ chain: arcChain(), transport: http(ARC_RPC) });
    const now = Math.floor(Date.now() / 1000);

    const rows: MarketTreasuryRow[] = [];
    let totalCollateral = 0;
    let totalFees = 0;
    let totalReserve = 0;
    let totalSweepable = 0;
    let totalContractBalance = 0;

    for (const m of markets) {
      if (!m.arcAddress) continue;
      try {
        const [collateralRaw, feesRaw, reserveRaw, statusRaw, finalRaw, finalizedAtRaw, graceRaw] =
          (await Promise.all([
            pub.readContract({ address: m.arcAddress as Address, abi: LMSR_MARKET_ABI, functionName: "collateral" }),
            pub.readContract({ address: m.arcAddress as Address, abi: LMSR_MARKET_ABI, functionName: "feesAccrued" }),
            pub.readContract({ address: m.arcAddress as Address, abi: LMSR_MARKET_ABI, functionName: "redemptionReserve" }).catch(() => 0n), // older deploys lack this
            pub.readContract({ address: m.arcAddress as Address, abi: LMSR_MARKET_ABI, functionName: "status" }),
            pub.readContract({ address: m.arcAddress as Address, abi: LMSR_MARKET_ABI, functionName: "finalOutcome" }).catch(() => 0),
            pub.readContract({ address: m.arcAddress as Address, abi: LMSR_MARKET_ABI, functionName: "finalizedAt" }).catch(() => 0n),
            pub.readContract({ address: m.arcAddress as Address, abi: LMSR_MARKET_ABI, functionName: "SWEEP_GRACE_PERIOD" }).catch(() => 0n),
          ])) as [bigint, bigint, bigint, number, number, bigint, bigint];

        const collateral = Number(collateralRaw) / 1_000_000;
        const fees = Number(feesRaw) / 1_000_000;
        const reserve = Number(reserveRaw) / 1_000_000;
        const contractBal = collateral + fees;

        const isFinalized = Number(statusRaw) === 3;
        const finalizedAt = Number(finalizedAtRaw);
        const grace = Number(graceRaw);
        const graceEnd = finalizedAt > 0 ? finalizedAt + grace : 0;
        const graceRemaining = isFinalized && graceEnd > now ? graceEnd - now : 0;
        const collateralReady = isFinalized && graceRemaining === 0 && grace > 0;
        const sweepable = collateralReady ? Math.max(collateral - reserve, 0) : 0;

        rows.push({
          marketId: m.id,
          title: m.title,
          arcAddress: m.arcAddress,
          marketIdOnChain: m.marketIdOnChain!.toFixed(),
          lmsrB: m.lmsrB?.toString() ?? "0",
          status: m.status,
          lmsrStatus: statusLabel(Number(statusRaw)),
          finalOutcome: isFinalized
            ? (finalRaw === 1 ? "NO" : finalRaw === 2 ? "YES" : finalRaw === 3 ? "INVALID" : null)
            : null,
          contractBalance: contractBal.toFixed(6),
          collateral: collateral.toFixed(6),
          feesAccrued: fees.toFixed(6),
          redemptionReserve: reserve.toFixed(6),
          sweepableCollateral: sweepable.toFixed(6),
          collateralReady,
          graceRemainingSec: graceRemaining,
        });

        totalContractBalance += contractBal;
        totalCollateral += collateral;
        totalFees += fees;
        totalReserve += reserve;
        totalSweepable += sweepable;
      } catch (err) {
        console.warn("[admin/treasury] read failed for market", m.arcAddress, err);
      }
    }

    return NextResponse.json({
      treasury: {
        address: treasuryAddress,
        usdcBalance: treasuryBalance,
        rpcSource: "arc-rpc",
      },
      totals: {
        marketsTracked: rows.length,
        totalContractBalance: totalContractBalance.toFixed(6),
        totalCollateral: totalCollateral.toFixed(6),
        totalFees: totalFees.toFixed(6),
        totalReserve: totalReserve.toFixed(6),
        totalSweepable: totalSweepable.toFixed(6),
      },
      markets: rows,
    });
  } catch (err) {
    const e = err as Error & { status?: number };
    const msg = e?.message ?? "Internal server error";
    const status =
      e?.status ??
      (msg.toLowerCase().includes("forbidden") ? 403
        : msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401
          : 500);
    if (status === 500) console.error("[admin/treasury]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
