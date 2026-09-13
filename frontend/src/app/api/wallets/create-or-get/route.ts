export const dynamic = "force-dynamic";

/**
 * POST /api/wallets/create-or-get
 *
 * Idempotent Circle Developer-Controlled SCA wallet provisioning.
 * Identity from Bearer token only — the body is ignored.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyPrivyAuth } from "@/lib/privy-server";
import {
  createOrGetUserFromPrivyAuth,
  createOrGetCircleWalletForUser,
} from "@/lib/user-service";

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyPrivyAuth(req);
    const user = await createOrGetUserFromPrivyAuth(auth);
    const wallet = await createOrGetCircleWalletForUser(user);
    return NextResponse.json({ genetiaWallet: wallet });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[wallets/create-or-get]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
