/**
 * User + Circle wallet provisioning helpers — server-only.
 *
 * Two idempotent operations:
 *   - createOrGetUserFromPrivyAuth(auth)
 *       Upserts the User row, syncs email, and stores any linked external
 *       wallets reported by Privy. Returns the canonical User.
 *
 *   - createOrGetCircleWalletForUser(user)
 *       Returns the existing CircleWallet row if present; otherwise calls
 *       Circle to create exactly one Developer-Controlled SCA wallet and
 *       persists it. Safe against concurrent calls.
 *
 * Both functions must run inside a route that has already verified the
 * Privy auth token — they assume the caller is authoritative for the
 * provided identity.
 */

import "server-only";

import { prisma } from "@/lib/db";
import {
  createCircleDeveloperControlledWallet,
  makeIdempotencyKey,
} from "@/lib/circle";
import type { PrivyAuthUser } from "@/lib/privy-server";

export interface GenetiaWallet {
  provider: "circle";
  circleWalletId: string;
  address: string;
  blockchain: string;
  accountType: string;
}

export async function createOrGetUserFromPrivyAuth(
  auth: PrivyAuthUser
) {
  const user = await prisma.user.upsert({
    where: { privyUserId: auth.privyUserId },
    create: {
      privyUserId: auth.privyUserId,
      email: auth.email,
      primaryExternalWallet: auth.externalWalletAddress,
    },
    update: {
      ...(auth.email ? { email: auth.email } : {}),
      ...(auth.externalWalletAddress
        ? { primaryExternalWallet: auth.externalWalletAddress }
        : {}),
    },
  });

  // Sync linked external wallets (idempotent — composite unique on userId+address).
  for (const address of auth.linkedWallets) {
    try {
      await prisma.linkedWallet.upsert({
        where: { userId_address: { userId: user.id, address } },
        create: {
          userId: user.id,
          address,
          walletType: "EXTERNAL",
          chainType: "EVM",
          provider: "PRIVY",
        },
        update: {},
      });
    } catch (err) {
      console.warn("[user-service] linkedWallet upsert failed", err);
    }
  }

  // Make sure every user has a WalletBalance row.
  await prisma.walletBalance.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });

  return user;
}

export async function createOrGetCircleWalletForUser(
  user: { id: string; privyUserId: string; email: string | null }
): Promise<GenetiaWallet> {
  const existing = await prisma.circleWallet.findUnique({
    where: { userId: user.id },
  });
  if (existing) {
    return {
      provider: "circle",
      circleWalletId: existing.circleWalletId,
      address: existing.address,
      blockchain: existing.blockchain,
      accountType: existing.accountType,
    };
  }

  const idempotencyKey = makeIdempotencyKey("wallet-provision", user.id);
  const created = await createCircleDeveloperControlledWallet({
    userId: user.id,
    privyUserId: user.privyUserId,
    email: user.email,
    idempotencyKey,
  });

  try {
    const row = await prisma.circleWallet.create({
      data: {
        userId: user.id,
        circleWalletId: created.id,
        address: created.address,
        blockchain: created.blockchain,
        accountType: created.accountType ?? "SCA",
        walletSetId: created.walletSetId,
        provider: "CIRCLE",
        status: "ACTIVE",
      },
    });
    return {
      provider: "circle",
      circleWalletId: row.circleWalletId,
      address: row.address,
      blockchain: row.blockchain,
      accountType: row.accountType,
    };
  } catch (err) {
    // Concurrent request beat us to it — refetch and return.
    const fallback = await prisma.circleWallet.findUnique({
      where: { userId: user.id },
    });
    if (fallback) {
      return {
        provider: "circle",
        circleWalletId: fallback.circleWalletId,
        address: fallback.address,
        blockchain: fallback.blockchain,
        accountType: fallback.accountType,
      };
    }
    throw err;
  }
}
