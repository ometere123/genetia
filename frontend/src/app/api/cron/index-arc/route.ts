export const dynamic = "force-dynamic";

/**
 * POST /api/cron/index-arc
 *
 * Polls Arc for LMSRMarketFactory + LMSRMarket events, mirrors them into
 * Postgres. Same auth pattern as resolve-markets — Bearer CRON_SECRET.
 *
 * Suggested cadence: every 30s. Indexer is idempotent; running it
 * concurrently with itself is safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { indexArcOnce } from "@/lib/arc-indexer";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");

  if (secret && header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await indexArcOnce();
    return NextResponse.json({
      ...result,
      factoryFromBlock: result.factoryFromBlock.toString(),
      factoryToBlock: result.factoryToBlock.toString(),
    });
  } catch (err) {
    console.error("[cron/index-arc]", err);
    const msg = err instanceof Error ? err.message : "internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
