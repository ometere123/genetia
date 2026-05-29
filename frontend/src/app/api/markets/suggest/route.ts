export const dynamic = "force-dynamic";

/**
 * POST /api/markets/suggest
 *
 * Public-but-authenticated market suggestion. Any signed-in user can call
 * this. It writes a row to `market_suggestions` with status='pending'.
 * Admins review and approve from the dashboard — approval mints a real
 * Market row and links the two.
 *
 * GET /api/markets/suggest      — the calling user's own suggestions
 *
 * Identity from verified Privy Bearer token.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";

const schema = z.object({
  question: z.string().min(10).max(500),
  description: z.string().max(2000).optional(),
  category: z.enum(["crypto", "politics", "sports", "science", "entertainment", "other"]),
  expiry: z.string().datetime(),
  criteria: z.string().min(20).max(2000),
  sources: z.array(z.string().url()).min(1).max(5),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const user = await createOrGetUserFromPrivyAuth(auth);

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { question, description, category, expiry, criteria, sources } = parsed.data;

    const expiryDate = new Date(expiry);
    if (expiryDate.getTime() <= Date.now() + 60 * 60 * 1000) {
      return NextResponse.json(
        { error: "Expiry must be at least one hour from now" },
        { status: 400 }
      );
    }

    const suggestion = await prisma.marketSuggestion.create({
      data: {
        userId: user.id,
        question,
        description: description ?? null,
        category,
        expiry: expiryDate,
        criteria,
        sources,
        status: "pending",
      },
    });

    return NextResponse.json({ suggestion }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[markets/suggest]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const user = await createOrGetUserFromPrivyAuth(auth);

    const suggestions = await prisma.marketSuggestion.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ suggestions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[markets/suggest GET]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
