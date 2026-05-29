export const dynamic = "force-dynamic";

/**
 * POST /api/admin/treasury/sweep
 *
 * Calls one of the two sweep functions on a Market contract:
 *   - { marketId, kind: "fees" }       → Market.sweepFees(treasury)
 *   - { marketId, kind: "collateral" } → Market.sweepCollateral(treasury)
 *
 * Both are admin-only on chain. We sign with ARC_ADMIN_PRIVATE_KEY (falls back
 * to ARC_RESOLVER_PRIVATE_KEY for testnet single-key setups).
 *
 * Destination is always the protocol treasury wallet (`NEXT_PUBLIC_TREASURY_ADDRESS`).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";
import { LMSR_MARKET_ABI } from "@/lib/lmsr-abi";

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
// See dispute-resolve route — must match factory.admin(). Resolver key is NOT admin.
const ARC_ADMIN_KEY = process.env.ARC_ADMIN_PRIVATE_KEY ?? process.env.ARC_OPERATOR_PRIVATE_KEY ?? "";
const TREASURY_ADDRESS = (process.env.NEXT_PUBLIC_TREASURY_ADDRESS ??
  process.env.TREASURY_ADDRESS ?? "") as `0x${string}` | "";

const schema = z.object({
  marketId: z.string().min(1),
  kind: z.enum(["fees", "collateral"]),
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
    if (!ARC_ADMIN_KEY) {
      return NextResponse.json({ error: "ARC_ADMIN_PRIVATE_KEY not configured" }, { status: 500 });
    }
    if (!TREASURY_ADDRESS) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_TREASURY_ADDRESS not configured" },
        { status: 500 }
      );
    }

    const market = await prisma.market.findUnique({ where: { id: parsed.data.marketId } });
    if (!market?.arcAddress) {
      return NextResponse.json({ error: "Market has no on-chain contract" }, { status: 400 });
    }
    const { createWalletClient, createPublicClient, http } = require("viem");
    const { privateKeyToAccount } = require("viem/accounts");

    const chain = {
      id: ARC_CHAIN_ID,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [ARC_RPC] } },
    } as const;

    const keyRaw = ARC_ADMIN_KEY.trim();
    const key = (keyRaw.startsWith("0x") ? keyRaw : `0x${keyRaw}`) as `0x${string}`;
    const account = privateKeyToAccount(key);
    const wallet = createWalletClient({ account, chain, transport: http(ARC_RPC) });
    const pub = createPublicClient({ chain, transport: http(ARC_RPC) });

    const functionName = parsed.data.kind === "fees" ? "sweepFees" : "sweepCollateral";

    // Simulate first so we surface clean revert reasons (e.g. InGracePeriod).
    await pub.simulateContract({
      account,
      address: market.arcAddress as `0x${string}`,
      abi: LMSR_MARKET_ABI,
      functionName,
      args: [TREASURY_ADDRESS],
    });

    const txHash: string = await wallet.writeContract({
      address: market.arcAddress as `0x${string}`,
      abi: LMSR_MARKET_ABI,
      functionName,
      args: [TREASURY_ADDRESS],
    });

    return NextResponse.json({
      kind: parsed.data.kind,
      marketId: parsed.data.marketId,
      txHash,
      to: TREASURY_ADDRESS,
    });
  } catch (err) {
    const e = err as Error & { status?: number };
    const msg = e?.message ?? "Internal server error";
    const status =
      e?.status ??
      (msg.toLowerCase().includes("forbidden") ? 403
        : msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401
          : 500);
    if (status === 500) console.error("[admin/treasury/sweep]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
