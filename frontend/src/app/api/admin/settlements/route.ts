export const dynamic = "force-dynamic";

/**
 * GET /api/admin/settlements  — list settlements with GenLayer data
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const settlements = await prisma.settlement.findMany({
      include: {
        market: {
          select: {
            id: true,
            title: true,
            category: true,
            yesPool: true,
            noPool: true,
          },
        },
      },
      orderBy: { settledAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ settlements });
  } catch (err) {
    console.error("[admin/settlements]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
