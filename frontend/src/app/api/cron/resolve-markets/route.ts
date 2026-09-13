export const dynamic = "force-dynamic";

/**
 * POST /api/cron/resolve-markets
 *
 * Scheduled trigger for the resolver pipeline.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` header.
 *       Vercel cron jobs supply this automatically if you set CRON_SECRET
 *       in the project env and reference it in vercel.json.
 *
 * Returns a JSON summary of work done this tick.
 */

import { NextRequest, NextResponse } from "next/server";
import { runResolverTick } from "@/lib/resolver-pipeline";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");

  if (secret && header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runResolverTick();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron/resolve-markets]", err);
    const msg = err instanceof Error ? err.message : "internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Allow GET for Vercel cron compatibility (older runtime sends GET).
export async function GET(req: NextRequest) {
  return POST(req);
}
