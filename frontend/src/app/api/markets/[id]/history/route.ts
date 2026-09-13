export const dynamic = "force-dynamic";

/**
 * GET /api/markets/[id]/history?range=1H|6H|1D|1W|ALL
 *
 * Reconstructs the YES probability over time from the arcTrades table
 * (LMSR on-chain trades indexed by the cron job).
 *
 * Algorithm:
 *   - Start at 50/50 at market creation.
 *   - For each trade in chronological order, accumulate qYes / qNo
 *     and compute the LMSR price at that point.
 *   - Append a "now" anchor so the line extends to the current moment.
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

    // Fetch the market's b parameter for LMSR price computation.
    const marketFull = await prisma.market.findUnique({
      where: { id: market.id },
      select: { lmsrB: true },
    });
    const b = marketFull?.lmsrB ? parseFloat(marketFull.lmsrB.toString()) : null;

    const trades = await prisma.arcTrade.findMany({
      where: { marketId: market.id, action: { in: ["buy", "sell"] } },
      select: { side: true, shares: true, action: true, blockTime: true },
      orderBy: { blockTime: "asc" },
    });

    /** Compute LMSR YES price (0-100) from outstanding share counts. */
    function lmsrPct(qYes: number, qNo: number): number {
      if (b && b > 0) {
        const eY = Math.exp(qYes / b);
        const eN = Math.exp(qNo  / b);
        return (eY / (eY + eN)) * 100;
      }
      const total = qYes + qNo;
      return total === 0 ? 50 : (qYes / total) * 100;
    }

    const points: HistoryPoint[] = [];
    let qYes = 0;
    let qNo  = 0;

    // Seed: market opens at 50/50.
    points.push({
      t: market.createdAt.toISOString(),
      yesPct: lmsrPct(0, 0),
      yesPool: "0",
      noPool:  "0",
    });

    for (const tr of trades) {
      const qty = parseFloat(tr.shares.toString());
      const delta = tr.action === "buy" ? qty : -qty;
      if (tr.side === "YES") qYes = Math.max(0, qYes + delta);
      else                   qNo  = Math.max(0, qNo  + delta);
      points.push({
        t: tr.blockTime.toISOString(),
        yesPct: lmsrPct(qYes, qNo),
        yesPool: qYes.toString(),
        noPool:  qNo.toString(),
      });
    }

    // Use trades.length for betCount so chart shows after first trade
    const betCount = trades.length;

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
      betCount,
    });
  } catch (err) {
    console.error("[markets/[id]/history]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
