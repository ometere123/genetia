export const dynamic = "force-dynamic";

/**
 * GET /api/circle/tx/[id]
 *
 * Polled by the frontend after submitting a Circle UserOp (buy/sell/redeem/
 * withdraw). Returns the current state so the UI can clear the spinner.
 *
 * Auth: any signed-in user can call this. The Circle tx ID is opaque enough
 * that we don't enforce ownership (testnet, low risk).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyPrivyAuth } from "@/lib/privy-server";
import { getCircleTransaction } from "@/lib/circle";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await verifyPrivyAuth(req);
    const tx = await getCircleTransaction(params.id);
    if (!tx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      id: tx.id,
      state: tx.state,
      txHash: tx.txHash ?? null,
      errorReason: tx.errorReason ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[circle/tx]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
