/**
 * Shared admin gate for every `/api/admin/*` route.
 *
 * Verifies the Privy bearer token, loads/creates the matching User row,
 * and requires either `user.isAdmin` OR a linked wallet matching
 * `ADMIN_WALLET_ADDRESS`. Throws an Error with `.status` set so the
 * route handler can return a clean 401/403 via `adminErrorResponse`.
 */

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { verifyPrivyAuth, type PrivyAuthUser } from "@/lib/privy-server";
import { createOrGetUserFromPrivyAuth } from "@/lib/user-service";

export interface AdminContext {
  user: Awaited<ReturnType<typeof createOrGetUserFromPrivyAuth>>;
  auth: PrivyAuthUser;
}

export async function requireAdmin(req: NextRequest): Promise<AdminContext> {
  const auth = await verifyPrivyAuth(req);
  const user = await createOrGetUserFromPrivyAuth(auth);

  const adminEnv = (process.env.ADMIN_WALLET_ADDRESS ?? "").toLowerCase();
  const linkedLower = auth.linkedWallets.map((a) => a.toLowerCase());
  const matchesAdminEnv =
    !!adminEnv &&
    (linkedLower.includes(adminEnv) ||
      (user.primaryExternalWallet ?? "").toLowerCase() === adminEnv);

  if (!user.isAdmin && !matchesAdminEnv) {
    const err = new Error("Forbidden — admin only") as Error & { status: number };
    err.status = 403;
    throw err;
  }
  return { user, auth };
}

export function adminErrorResponse(err: unknown): NextResponse {
  const e = err as Error & { status?: number };
  const msg = e?.message ?? "Internal server error";
  const lower = msg.toLowerCase();
  const status =
    e?.status ??
    (lower.includes("forbidden") ? 403
     : lower.includes("privy") || msg.includes("Authorization") || lower.includes("bearer") ? 401
     : 500);
  if (status === 500) console.error("[admin]", err);
  return NextResponse.json({ error: msg }, { status });
}
