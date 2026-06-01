export const dynamic = "force-dynamic";

/**
 * GET  /api/markets        — list markets (public)
 * POST /api/markets        — create market (ADMIN ONLY)
 *
 * Per architecture spec: regular users cannot create markets. They can
 * submit suggestions (separate flow), which admins approve. The POST
 * endpoint here requires a verified Privy token whose user has
 * `is_admin = true` in the database OR an admin wallet address.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";

const createSchema = z.object({
  title: z.string().min(5).max(500),
  description: z.string().min(10),
  category: z.string().min(1),
  expiry: z.string().datetime(),
  resolutionSource: z.string().optional(),
  arcAddress: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const status   = searchParams.get("status");
    const category = searchParams.get("category");
    const limit    = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);
    const offset   = parseInt(searchParams.get("offset") ?? "0");
    const q        = searchParams.get("q");

    // Public market list — hide refunded / archived / pending unless caller
    // explicitly asks for them via ?status=…. Without this every wound-down
    // market would keep showing up under "All".
    const PUBLIC_STATUSES = ["active", "resolved", "paused"];
    const whereClause: import("@prisma/client").Prisma.MarketWhereInput = {
      ...(status && status !== "all"
        ? { status }
        : { status: { in: PUBLIC_STATUSES } }),
      ...(category && category !== "all" ? { category } : {}),
      ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    };

    const [markets, total] = await Promise.all([
      prisma.market.findMany({
        where: whereClause,
        include: {
          _count: { select: { arcTrades: true } },
          settlement: {
            select: { resolution: true, reasoning: true, confidence: true, settledAt: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.market.count({ where: whereClause }),
    ]);

    // Aggregate actual USDC volume (sum of buy amounts) per market.
    const marketIds = markets.map((m) => m.id);
    const volumeRows = await prisma.arcTrade.groupBy({
      by: ["marketId"],
      where: { marketId: { in: marketIds }, action: "buy" },
      _sum: { amount: true },
    });
    const volumeMap = Object.fromEntries(
      volumeRows.map((r) => [r.marketId, r._sum.amount?.toString() ?? "0"])
    );

    const shaped = markets.map((m) => ({
      ...m,
      usdcVolume: volumeMap[m.id] ?? "0",
    }));

    return NextResponse.json({ markets: shaped, total });
  } catch (err) {
    console.error("[markets GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Identity is read STRICTLY from the verified Privy token.
    const auth = await verifyPrivyAuth(req);
    const user = await createOrGetUserFromPrivyAuth(auth);

    // Admin check — either flagged in DB, or matches ADMIN_WALLET_ADDRESS env var.
    const adminEnv = (process.env.ADMIN_WALLET_ADDRESS ?? "").toLowerCase();
    const linkedAddrs = auth.linkedWallets.map((a) => a.toLowerCase());
    const matchesAdminAddress =
      adminEnv && (linkedAddrs.includes(adminEnv) ||
        (user.primaryExternalWallet ?? "").toLowerCase() === adminEnv);

    if (!user.isAdmin && !matchesAdminAddress) {
      return NextResponse.json(
        { error: "Forbidden — market creation is admin-only" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const market = await prisma.market.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description,
        category: parsed.data.category,
        expiry: new Date(parsed.data.expiry),
        status: "active",
        resolutionSource: parsed.data.resolutionSource,
        createdBy: user.id,
        arcAddress: parsed.data.arcAddress,
      },
    });

    return NextResponse.json({ market }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status =
      msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[markets POST]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
