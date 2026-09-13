export const dynamic = "force-dynamic";

/**
 * POST /api/auth/sync-user
 *
 * Called by the frontend immediately after Privy login. Identity is read
 * STRICTLY from the verified Privy auth token — the request body is
 * ignored. Idempotent: returns the same user + Genetia Wallet on every
 * call.
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
    const genetiaWallet = await createOrGetCircleWalletForUser(user);

    return NextResponse.json({
      user: {
        id: user.id,
        privyUserId: user.privyUserId,
        email: user.email,
        primaryExternalWallet: user.primaryExternalWallet,
      },
      genetiaWallet,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg.toLowerCase().includes("privy") || msg.includes("Authorization") ? 401 : 500;
    if (status === 500) console.error("[auth/sync-user]", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
