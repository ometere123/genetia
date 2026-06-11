export const dynamic = "force-dynamic";

/**
 * Admin market management routes.
 *
 * POST /api/admin/markets/resolve   — resolve market + trigger payouts
 * POST /api/admin/markets/pause     — pause / unpause market
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { Decimal } from "@/lib/decimal";
import { runResolverTick } from "@/lib/resolver-pipeline";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { createMarketOnArc } from "@/lib/arc-factory";

const genlayerResolveSchema = z.object({
  marketId: z.string().min(1),
  // Optional: override the sources stored on the market for this resolution.
  sources: z.array(z.string().url()).max(5).optional(),
});

const refundSchema = z.object({
  marketId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const { action } = body as { action?: string };

    if (action === "pause")            return handlePause(body);
    if (action === "genlayer_resolve") return handleGenlayerResolve(body);
    if (action === "refund")           return handleRefund(body);
    if (action === "deploy_arc")       return handleDeployArc(body);
    if (action === "set_featured")     return handleSetFeatured(body);
    // Old "resolve" action removed in the LMSR clean-break. Admins now use:
    //   /api/admin/dispute-resolve  (calls Market.adminResolve on-chain)

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

/**
 * Admin wind-down for legacy / stuck markets:
 *   - Refunds every active bet at full stake (locked → available + BET_RELEASE row)
 *   - Marks the market `refunded`
 *   - Marks the settlement (if any) `refunded`
 *
 * Works whether or not the market has any active bets (no-op on the
 * bet/balance side if zero). Does NOT touch on-chain — used for legacy
 * parimutuel markets whose contract pre-dates the LMSR cutover.
 */
async function handleRefund(body: unknown) {
  const parsed = refundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { marketId, reason } = parsed.data;

  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { bets: { where: { status: "active" } } },
  });
  if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 });
  if (market.status === "resolved" || market.status === "refunded") {
    return NextResponse.json({ error: `Market already ${market.status}` }, { status: 400 });
  }

  const totals = new Map<string, Decimal>();
  for (const b of market.bets) {
    const cur = totals.get(b.userId) ?? new Decimal(0);
    totals.set(b.userId, cur.add(b.amount));
  }

  await prisma.$transaction([
    prisma.market.update({
      where: { id: marketId },
      data: { status: "refunded" },
    }),
    prisma.settlement.upsert({
      where: { marketId },
      create: {
        marketId,
        status: "refunded",
        reasoning: reason ?? "admin wind-down (legacy parimutuel market)",
        finalizedAt: new Date(),
      },
      update: {
        status: "refunded",
        reasoning: reason ?? "admin wind-down (legacy parimutuel market)",
        finalizedAt: new Date(),
      },
    }),
    prisma.bet.updateMany({
      where: { marketId, status: "active" },
      data: { status: "refunded", settledAt: new Date() },
    }),
    ...Array.from(totals.entries()).map(([userId, total]) =>
      prisma.walletBalance.update({
        where: { userId },
        data: {
          lockedBalance: { decrement: total },
          availableBalance: { increment: total },
        },
      })
    ),
    ...Array.from(totals.entries()).map(([userId, total]) =>
      prisma.walletTransaction.create({
        data: {
          userId,
          amount: total,
          type: "BET_RELEASE",
          status: "confirmed",
          metadata: {
            marketId,
            reason: "admin_refund",
            note: reason ?? null,
          },
        },
      })
    ),
  ]);

  return NextResponse.json({
    refunded: true,
    marketId,
    betsRefunded: market.bets.length,
    usersAffected: totals.size,
  });
}

/**
 * Manual admin trigger: queue this market for the resolver pipeline and
 * immediately run one tick so the admin gets fresh status back.
 *
 * Timestamps:
 *   requestedAt — DB default when Settlement row is created.
 *   submittedAt — pipeline writes this once GenLayer accepts the tx.
 *   finalizedAt — pipeline writes this once the verdict is on-chain.
 *   arcResolvedAt — pipeline writes this once Arc.resolve() confirms.
 *
 * The GenLayer contract itself stores NO timestamps — per protocol design.
 */
async function handleGenlayerResolve(body: unknown) {
  const parsed = genlayerResolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { marketId, sources } = parsed.data;

  // Mark the market for resolution. The pipeline picks up `pending_resolve` rows.
  await prisma.settlement.upsert({
    where: { marketId },
    create: {
      marketId,
      status: "pending_resolve",
      sources: sources ?? [],
    },
    update: {
      status: "pending_resolve",
      requestedAt: new Date(),
      ...(sources ? { sources } : {}),
    },
  });

  // Run one tick now so the admin sees immediate progress.
  const tick = await runResolverTick();

  const settlement = await prisma.settlement.findUnique({ where: { marketId } });
  return NextResponse.json({ queued: true, tick, settlement });
}


async function handlePause(body: unknown) {
  const schema = z.object({
    marketId: z.string().min(1),
    pause: z.boolean(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const market = await prisma.market.update({
    where: { id: parsed.data.marketId },
    data: { status: parsed.data.pause ? "paused" : "active" },
  });

  return NextResponse.json({ market });
}

async function handleSetFeatured(body: unknown) {
  const schema = z.object({ marketId: z.string().min(1), featured: z.boolean() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  // Unpin any currently featured market first, then pin the new one.
  if (parsed.data.featured) {
    await prisma.market.updateMany({
      where: { isFeatured: true },
      data: { isFeatured: false },
    });
  }

  const market = await prisma.market.update({
    where: { id: parsed.data.marketId },
    data: { isFeatured: parsed.data.featured },
  });

  return NextResponse.json({ market: { id: market.id, isFeatured: market.isFeatured } });
}

async function handleDeployArc(body: unknown) {
  const schema = z.object({ marketId: z.string().min(1) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const market = await prisma.market.findUnique({ where: { id: parsed.data.marketId } });
  if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 });
  if (market.arcAddress) return NextResponse.json({ error: "Market already deployed on Arc" }, { status: 400 });

  const arc = await createMarketOnArc({
    question: market.title,
    category: market.category,
    expiry: market.expiry,
  });

  if (!arc.arcAddress) {
    return NextResponse.json({ error: arc.error ?? "Arc deployment failed" }, { status: 502 });
  }

  await prisma.market.update({
    where: { id: market.id },
    data: {
      arcAddress: arc.arcAddress,
      marketIdOnChain: arc.marketIdOnChain ?? undefined,
      lmsrB: arc.b ? new Decimal(arc.b).div(1_000_000) : undefined,
      lmsrStatus: "Active",
    },
  });

  return NextResponse.json({ deployed: true, arcAddress: arc.arcAddress, arcTxHash: arc.arcTxHash });
}

/**
 * GET /api/admin/markets
 *   ?lmsrStatus=Pending,Disputed   — comma-separated LMSR statuses to filter on
 *
 * Returns the on-chain LMSR state alongside the basic market metadata so
 * the admin dashboard can decide which markets need dispute action.
 *
 * Auth: same admin gate as the rest of /api/admin.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const lmsrStatusParam = req.nextUrl.searchParams.get("lmsrStatus");
    const lmsrStatuses = lmsrStatusParam ? lmsrStatusParam.split(",").map((s) => s.trim()) : null;

    const markets = await prisma.market.findMany({
      where: lmsrStatuses
        ? { lmsrStatus: { in: lmsrStatuses } }
        : undefined,
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        expiry: true,
        arcAddress: true,
        isFeatured: true,
        lmsrStatus: true,
        proposedOutcome: true,
        pendingSince: true,
        disputeBondHolder: true,
        disputeBondAmount: true,
        marketIdOnChain: true,
        createdAt: true,
      },
      orderBy: [{ pendingSince: "desc" }, { createdAt: "desc" }],
      take: 200,
    });

    return NextResponse.json({
      markets: markets.map((m) => ({
        ...m,
        disputeBondAmount: m.disputeBondAmount?.toString() ?? null,
        marketIdOnChain: m.marketIdOnChain?.toString() ?? null,
      })),
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
