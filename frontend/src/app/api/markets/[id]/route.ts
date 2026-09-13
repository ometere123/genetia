/**
 * GET   /api/markets/[id]   — get market detail
 * PATCH /api/markets/[id]   — update market (admin)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  status: z.enum(["pending", "active", "paused", "resolved", "archived"]).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  arcAddress: z.string().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Accept either the DB cuid or the on-chain Arc address as the slug —
    // both forms can appear in URLs depending on how the market was created.
    const isArcAddress = /^0x[a-fA-F0-9]{40}$/.test(params.id);
    const market = await prisma.market.findFirst({
      where: isArcAddress
        ? { arcAddress: { equals: params.id, mode: "insensitive" } }
        : { id: params.id },
      include: {
        _count: { select: { arcTrades: true } },
        settlement: true,
        positions: { select: { userId: true, exposure: true, pnl: true } },
      },
    });

    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    return NextResponse.json({ market });
  } catch (err) {
    console.error("[markets/[id] GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const market = await prisma.market.update({
      where: { id: params.id },
      data: parsed.data,
    });

    return NextResponse.json({ market });
  } catch (err) {
    console.error("[markets/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
