export const dynamic = "force-dynamic";

/**
 * POST /api/admin/dispute-resolve
 *
 * Admin escape hatch for a disputed (or any non-finalized) LMSR market.
 * Calls `LMSRMarket.adminResolve(uint8 outcome)` with the admin private
 * key. On the disputed branch the contract refunds the disputer's bond if
 * the admin agrees with them (outcome ≠ proposed), or slashes it to fees
 * if the admin upholds the proposed verdict.
 *
 * Body: { marketId, outcome: "YES" | "NO" | "INVALID" }
 *
 * Required env: ARC_ADMIN_PRIVATE_KEY (falls back to ARC_RESOLVER_PRIVATE_KEY
 * so testnet single-key setups still work).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";
import { LMSR_MARKET_ABI, OUTCOME } from "@/lib/lmsr-abi";

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
// IMPORTANT: this must be the key whose address matches LMSRMarketFactory.admin().
// In our deploy, admin = the deployer (PRIVATE_KEY in contracts/arc/.env =
// ARC_OPERATOR_PRIVATE_KEY in frontend/.env). The GenLayer relayer key
// (ARC_RESOLVER_PRIVATE_KEY) is NOT admin — using it triggers NotAdmin
// (0x7bfa4b9f) on adminResolve / sweepFees / sweepCollateral.
const ARC_ADMIN_KEY = process.env.ARC_ADMIN_PRIVATE_KEY ?? process.env.ARC_OPERATOR_PRIVATE_KEY ?? "";

const schema = z.object({
  marketId: z.string().min(1),
  outcome: z.enum(["YES", "NO", "INVALID"]),
});

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

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const { marketId, outcome } = parsed.data;

    if (!ARC_ADMIN_KEY) {
      return NextResponse.json(
        { error: "ARC_ADMIN_PRIVATE_KEY not configured" },
        { status: 500 }
      );
    }

    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market?.arcAddress) {
      return NextResponse.json({ error: "Market has no on-chain contract" }, { status: 400 });
    }
    if (market.lmsrStatus === "Finalized") {
      return NextResponse.json({ error: "Market already finalized" }, { status: 400 });
    }

    const onChainOutcome =
      outcome === "YES" ? OUTCOME.YES :
      outcome === "NO"  ? OUTCOME.NO  :
                          OUTCOME.INVALID;

    // Lazy-require viem so build doesn't depend on it.
    const { createWalletClient, http } = require("viem");
    const { privateKeyToAccount } = require("viem/accounts");

    const chain = {
      id: ARC_CHAIN_ID,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [ARC_RPC] } },
    } as const;

    const keyRaw = ARC_ADMIN_KEY.trim();
    const key = keyRaw.startsWith("0x") ? keyRaw : `0x${keyRaw}`;
    const account = privateKeyToAccount(key as `0x${string}`);
    const wallet = createWalletClient({ account, chain, transport: http(ARC_RPC) });

    const txHash: string = await wallet.writeContract({
      address: market.arcAddress as `0x${string}`,
      abi: LMSR_MARKET_ABI,
      functionName: "adminResolve",
      args: [onChainOutcome],
    });

    // Stamp the settlement immediately; indexer will overwrite with the
    // canonical state when it sees the AdminResolved event.
    await prisma.settlement.upsert({
      where: { marketId },
      create: {
        marketId,
        status: "submitted_to_arc",
        resolution: outcome === "INVALID" ? null : outcome,
        finalizedAt: new Date(),
        arcResolvedAt: new Date(),
        arcTxHash: txHash,
        reasoning: `Admin override → ${outcome}`,
      },
      update: {
        status: "submitted_to_arc",
        resolution: outcome === "INVALID" ? null : outcome,
        finalizedAt: new Date(),
        arcResolvedAt: new Date(),
        arcTxHash: txHash,
        reasoning: `Admin override → ${outcome}`,
      },
    });

    return NextResponse.json({ txHash, marketId, outcome });
  } catch (err) {
    const e = err as Error & { status?: number };
    const msg = e?.message ?? "Internal server error";
    const lower = msg.toLowerCase();
    const status =
      e?.status ??
      (lower.includes("forbidden") ? 403
        : lower.includes("privy") || msg.includes("Authorization") ? 401
          : 500);
    if (status === 500) console.error("[admin/dispute-resolve]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
