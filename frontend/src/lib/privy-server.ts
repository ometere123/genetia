/**
 * Server-only Privy verification.
 *
 * Every protected route must call `verifyPrivyAuth(req)` to read the
 * user's identity from the Authorization header. NEVER trust a userId
 * passed in the request body.
 *
 * Performance:
 *   Each call to Privy's `/users/me` is a network round-trip to
 *   auth.privy.io. With a 30-second balance poll plus per-action API
 *   calls, every page-load translates to ~10 outbound HTTPS requests
 *   to Privy — slow at best, timing out at worst.
 *
 *   We cache the verified user keyed by the Bearer token's SHA-256
 *   hash for 60 seconds. Same token → instant cache hit, no network.
 *   If the user logs out or their token rotates, the cache entry
 *   simply ages out and the next call re-verifies.
 */

import "server-only";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

export interface PrivyAuthUser {
  privyUserId: string;
  email: string | null;
  externalWalletAddress: string | null;
  linkedWallets: string[];
}

/* ── Token cache ────────────────────────────────────────────────────────── */

const TOKEN_CACHE = new Map<string, { user: PrivyAuthUser; expiresAt: number }>();
const TOKEN_CACHE_TTL_MS = 60_000;     // 1 minute — safe trade-off
const TOKEN_CACHE_MAX = 500;

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cacheGet(token: string): PrivyAuthUser | null {
  const key = tokenHash(token);
  const entry = TOKEN_CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    TOKEN_CACHE.delete(key);
    return null;
  }
  return entry.user;
}

function cacheSet(token: string, user: PrivyAuthUser): void {
  // Evict oldest if over capacity (Map preserves insertion order).
  if (TOKEN_CACHE.size >= TOKEN_CACHE_MAX) {
    const first = TOKEN_CACHE.keys().next().value;
    if (first) TOKEN_CACHE.delete(first);
  }
  TOKEN_CACHE.set(tokenHash(token), {
    user,
    expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
  });
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Verify a Privy access token from the `Authorization: Bearer <token>`
 * header and return a normalised user record. Throws if the header is
 * missing or the token is invalid.
 */
export async function verifyPrivyAuth(req: NextRequest): Promise<PrivyAuthUser> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }
  const token = header.slice(7).trim();
  if (!token) throw new Error("Empty bearer token");

  // Cache hit — skip the network round trip entirely.
  const cached = cacheGet(token);
  if (cached) return cached;

  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET ?? process.env.PRIVY_SECRET;
  if (!appId) throw new Error("PRIVY_APP_ID is not configured");

  const verifyHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "privy-app-id": appId,
  };
  if (appSecret) {
    const basic = Buffer.from(`${appId}:${appSecret}`).toString("base64");
    verifyHeaders["privy-client-auth"] = `Basic ${basic}`;
  }

  // Short timeout + clean error so the caller can surface "Privy unreachable"
  // rather than a generic 500. Beats hanging for 10s.
  const PRIVY_TIMEOUT_MS = 6_000;

  let body: unknown;
  try {
    const verifyRes = await fetch("https://auth.privy.io/api/v1/users/me", {
      headers: verifyHeaders,
      signal: AbortSignal.timeout(PRIVY_TIMEOUT_MS),
    });

    if (!verifyRes.ok) {
      const legacy = await fetch("https://auth.privy.io/api/v1/sessions", {
        headers: verifyHeaders,
        signal: AbortSignal.timeout(PRIVY_TIMEOUT_MS),
      });
      if (!legacy.ok) throw new Error("Invalid Privy session token");
      const legacyBody = await legacy.json();
      const user = normalisePrivyUser(legacyBody?.user ?? legacyBody);
      cacheSet(token, user);
      return user;
    }

    body = await verifyRes.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("aborted") || msg.includes("timeout") || msg.includes("fetch failed")) {
      throw new Error("Privy auth service unreachable — please retry");
    }
    throw err;
  }

  const user = normalisePrivyUser((body as { user?: unknown })?.user ?? body);
  cacheSet(token, user);
  return user;
}

function normalisePrivyUser(raw: unknown): PrivyAuthUser {
  const r = (raw ?? {}) as {
    id?: string;
    linked_accounts?: Array<Record<string, unknown>>;
    linkedAccounts?: Array<Record<string, unknown>>;
    email?: { address?: string } | string;
  };

  const privyUserId = r.id;
  if (!privyUserId) throw new Error("Privy response missing user id");

  const linked = r.linkedAccounts ?? r.linked_accounts ?? [];

  let email: string | null = null;
  const linkedWallets: string[] = [];

  for (const acc of linked) {
    const type = (acc.type as string) ?? "";
    if (type === "email" && typeof acc.address === "string") {
      email = email ?? (acc.address as string);
    } else if (type === "wallet" && typeof acc.address === "string") {
      const addr = (acc.address as string).toLowerCase();
      if (/^0x[a-f0-9]{40}$/.test(addr)) linkedWallets.push(addr);
    } else if (type === "google_oauth" && typeof acc.email === "string") {
      email = email ?? (acc.email as string);
    }
  }

  if (!email) {
    if (typeof r.email === "string") email = r.email;
    else if (typeof r.email === "object" && r.email?.address) email = r.email.address;
  }

  return {
    privyUserId,
    email,
    externalWalletAddress: linkedWallets[0] ?? null,
    linkedWallets,
  };
}

/**
 * Legacy alias kept for older call sites.
 * @deprecated use verifyPrivyAuth(req) instead.
 */
export async function verifyPrivyToken(
  authHeader: string | null
): Promise<{ userId: string }> {
  if (!authHeader) throw new Error("Missing Authorization header");
  const fakeReq = {
    headers: { get: (k: string) => (k.toLowerCase() === "authorization" ? authHeader : null) },
  } as unknown as NextRequest;
  const user = await verifyPrivyAuth(fakeReq);
  return { userId: user.privyUserId };
}
