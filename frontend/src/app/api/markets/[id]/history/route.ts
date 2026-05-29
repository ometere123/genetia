export const dynamic = "force-dynamic";

/**
 * GET /api/markets/[id]/history?range=1H|6H|1D|1W|ALL
 *
 * Reconstructs the YES probability over time from the bets table.
 *
 * Algorithm:
 *   - Start at 50% / 50% at market creation (no bets yet).
 *   - For each bet in chronological order, add its amount to the
 *     appropriate pool and emit a point.
 *   - Append a final "now" point so the chart line extends to the
 *     current moment instead of stopping at the last bet.
 *
 * Phase-1 implementation — computes from `bets` on every request.
 * Cheap until a market sees thousands of bets; at that point we'd
 * write to a pre-aggregated `market_price_history` table and serve
 * bucketed candles, same API contract.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface HistoryPoint {
  t: string;        // ISO timestamp
  yesPct: number;   // 0..100
  yesPool: string;  // string to preserve Decimal precision
  noPool: string;
}

const RANGE_MS: Record<string, number | null> = {
  "1H":  60 * 60 * 1000,
  "6H":  6 * 60 * 60 * 1000,
  "1D":  24 * 60 * 60 * 1000,
  "1W":  7 * 24 * 60 * 60 * 1000,
  "ALL": null,
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const isArcAddress = /^0x[a-fA-F0-9]{40}$/.test(params.id);
    const market = await prisma.market.findFirst({
      where: isArcAddress
        ? { arcAddress: { equals: params.id, mode: "insensitive" } }
        : { id: params.id },
      select: { id: true, createdAt: true, status: true },
    });
    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const range = (req.nextUrl.searchParams.get("range") ?? "ALL").toUpperCase();
    const cutoffMs = RANGE_MS[range] ?? null;

    const bets = await prisma.bet.findMany({
      where: { marketId: market.id },
      select: { side: true, amount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // Walk through every bet computing the cumulative pools.
    const points: HistoryPoint[] = [];
    let yes = 0;
    let no  = 0;

    // Seed: market opens at 50/50 with empty pools.
    points.push({
      t: market.createdAt.toISOString(),
      yesPct: 50,
      yesPool: "0",
      noPool:  "0",
    });

    for (const b of bets) {
      const amt = parseFloat(b.amount.toString());
      if (b.side === "YES") yes += amt; else no += amt;
      const total = yes + no;
      const yesPct = total === 0 ? 50 : (yes / total) * 100;
      points.push({
        t: b.createdAt.toISOString(),
        yesPct,
        yesPool: yes.toString(),
        noPool:  no.toString(),
      });
    }

    // Anchor the line at "now" so the chart doesn't cliff off after the
    // last bet. Only meaningful for unresolved markets.
    if (market.status !== "resolved" && market.status !== "refunded") {
      const last = points[points.length - 1];
      points.push({ ...last, t: new Date().toISOString() });
    }

    // Apply range filter — keep points within the window, but always
    // include a "first point inside window" anchor so the line has a
    // sensible left edge.
    let visible = points;
    if (cutoffMs !== null) {
      const cutoff = Date.now() - cutoffMs;
      const filtered = points.filter((p) => new Date(p.t).getTime() >= cutoff);
      if (filtered.length === 0) {
        // No events in the window — just emit the current state as a flat line.
        const last = points[points.length - 1];
        visible = [
          { ...last, t: new Date(cutoff).toISOString() },
          last,
        ];
      } else if (filtered[0].t !== points[0].t) {
        // Prepend the most recent pre-cutoff point so the line starts
        // at the right vertical position.
        const idx = points.indexOf(filtered[0]);
        const anchor = idx > 0
          ? { ...points[idx - 1], t: new Date(cutoff).toISOString() }
          : null;
        visible = anchor ? [anchor, ...filtered] : filtered;
      } else {
        visible = filtered;
      }
    }

    return NextResponse.json({
      marketId: market.id,
      range,
      points: visible,
      betCount: bets.length,
    });
  } catch (err) {
    console.error("[markets/[id]/history]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
