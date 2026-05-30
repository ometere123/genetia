export const dynamic = "force-dynamic";

/**
 * GET /api/admin/settlements  — list settlements with GenLayer data
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
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
    return adminErrorResponse(err);
  }
}
