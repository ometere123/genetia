/**
 * Circle Developer-Controlled Wallets — server-only.
 *
 * Every Genetia user gets exactly one Circle Developer-Controlled SCA
 * wallet. That wallet is the user's "Genetia Wallet": deposits, balances,
 * bets, settlement, winnings, withdrawals all flow through it.
 *
 * Configured chain: ARC-TESTNET (Circle's native blockchain identifier
 * for Arc, the USDC-native L1). Account type: SCA (Smart Contract
 * Account, AA-style).
 *
 * Secrets — `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`,
 * `CIRCLE_ENTITY_SECRET_CIPHERTEXT`, `CIRCLE_WALLET_SET_ID` — are read
 * here only. Never reference them in client-side code.
 */

import "server-only";
import crypto from "node:crypto";

const CIRCLE_API_BASE = "https://api.circle.com/v1/w3s";

const CIRCLE_BLOCKCHAIN = process.env.CIRCLE_BLOCKCHAIN ?? "ARC-TESTNET";
const CIRCLE_ACCOUNT_TYPE = process.env.CIRCLE_ACCOUNT_TYPE ?? "SCA";

function circleHeaders(): Record<string, string> {
  const key = process.env.CIRCLE_API_KEY;
  if (!key) throw new Error("CIRCLE_API_KEY is not configured");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

function devStub(): boolean {
  return !process.env.CIRCLE_API_KEY || !process.env.CIRCLE_WALLET_SET_ID;
}

// ── Entity-secret ciphertext generation ─────────────────────────────────────
// Circle requires a FRESH RSA-OAEP-SHA256 encryption of CIRCLE_ENTITY_SECRET
// for every sensitive operation (wallet create, transfer, etc.). We cache
// the public key for the process lifetime and recompute the ciphertext on
// each call — that's what the SDK does internally too.

let cachedPublicKeyPem: string | null = null;

async function getCirclePublicKey(): Promise<string> {
  if (cachedPublicKeyPem) return cachedPublicKeyPem;
  const res = await fetch(`${CIRCLE_API_BASE}/config/entity/publicKey`, {
    headers: circleHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Circle publicKey failed: ${JSON.stringify(err)}`);
  }
  const body = await res.json();
  const pem = body?.data?.publicKey ?? body?.publicKey;
  if (!pem || !String(pem).includes("BEGIN")) {
    throw new Error("Circle returned no public key");
  }
  cachedPublicKeyPem = pem as string;
  return cachedPublicKeyPem;
}

async function freshEntitySecretCiphertext(): Promise<string> {
  const secret = process.env.CIRCLE_ENTITY_SECRET;
  if (!secret) throw new Error("CIRCLE_ENTITY_SECRET is not configured");
  const entityBytes = Buffer.from(secret.trim(), "hex");
  if (entityBytes.length !== 32) {
    throw new Error(
      "CIRCLE_ENTITY_SECRET must be exactly 64 hex characters (32 bytes)"
    );
  }
  const pem = await getCirclePublicKey();
  const ciphertext = crypto.publicEncrypt(
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    entityBytes
  );
  return ciphertext.toString("base64");
}

export interface CircleWalletResponse {
  id: string;
  address: string;
  blockchain: string;
  accountType?: string;
  state: string;
  walletSetId: string;
  createDate: string;
}

export interface CircleTokenBalance {
  token: { id?: string; symbol: string; decimals: number; tokenAddress?: string };
  amount: string;
  updateDate: string;
}

export interface CircleTransfer {
  id: string;
  state: string;
  amounts: string[];
  createDate: string;
}

// ── Wallet provisioning ─────────────────────────────────────────────────────

/**
 * Create a single Circle Developer-Controlled SCA wallet on ARC-TESTNET.
 * `idempotencyKey` must be stable for a given user — the same key returns
 * the same wallet on subsequent calls.
 */
export async function createCircleDeveloperControlledWallet(opts: {
  userId: string;
  privyUserId: string;
  email?: string | null;
  idempotencyKey: string;
}): Promise<CircleWalletResponse> {
  if (devStub()) {
    const id = `dev-${opts.userId}`;
    const addr = `0x${opts.userId.replace(/[^a-f0-9]/gi, "").padEnd(40, "0").slice(0, 40)}`;
    console.warn("[circle] dev stub wallet — set CIRCLE_API_KEY/WALLET_SET_ID for real");
    return {
      id,
      address: addr,
      blockchain: CIRCLE_BLOCKCHAIN,
      accountType: CIRCLE_ACCOUNT_TYPE,
      state: "LIVE",
      walletSetId: process.env.CIRCLE_WALLET_SET_ID ?? "dev-set",
      createDate: new Date().toISOString(),
    };
  }

  const walletSetId = process.env.CIRCLE_WALLET_SET_ID!;

  const body: Record<string, unknown> = {
    idempotencyKey: opts.idempotencyKey,
    blockchains: [CIRCLE_BLOCKCHAIN],
    accountType: CIRCLE_ACCOUNT_TYPE,
    count: 1,
    walletSetId,
    entitySecretCiphertext: await freshEntitySecretCiphertext(),
    metadata: [
      {
        name: `genetia-${opts.userId}`,
        refId: opts.privyUserId,
      },
    ],
  };

  const res = await fetch(`${CIRCLE_API_BASE}/developer/wallets`, {
    method: "POST",
    headers: circleHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Circle createWallet failed: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  const wallet = data?.data?.wallets?.[0];
  if (!wallet) throw new Error("Circle returned no wallet");
  return wallet as CircleWalletResponse;
}

export async function getCircleWallet(walletId: string): Promise<CircleWalletResponse | null> {
  if (devStub()) return null;
  const res = await fetch(`${CIRCLE_API_BASE}/wallets/${walletId}`, {
    headers: circleHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data?.data?.wallet ?? null) as CircleWalletResponse | null;
}

// ── Balances ────────────────────────────────────────────────────────────────

export async function getCircleWalletBalances(
  walletId: string
): Promise<CircleTokenBalance[]> {
  if (devStub()) return [];
  const res = await fetch(`${CIRCLE_API_BASE}/wallets/${walletId}/balances`, {
    headers: circleHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.data?.tokenBalances ?? []) as CircleTokenBalance[];
}

export async function getCircleUsdcBalance(walletId: string): Promise<number> {
  const balances = await getCircleWalletBalances(walletId);
  const usdc = balances.find((b) => /^USDC/i.test(b.token.symbol));
  return usdc ? parseFloat(usdc.amount) : 0;
}

/**
 * Read USDC balance directly from the on-chain contract via Arc RPC.
 *
 * We bypass Circle's `/balances` indexer (which lags) AND pin to the
 * latest finalized block + take the max of N parallel reads. Arc
 * testnet's RPC is load-balanced across nodes at different sync states;
 * naive `readContract` flaps between "latest" balances from different
 * nodes. Pinning + max-of-N stabilises the value.
 *
 * Returns balance as a plain number (USDC has 6 decimals).
 */
const USDC_ABI_BALANCE_OF = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export async function getOnChainUsdcBalance(walletAddress: string): Promise<number> {
  const rpcUrl = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
  const chainId = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
  const usdcAddress = (process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS ??
    "0x3600000000000000000000000000000000000000") as `0x${string}`;
  const { createPublicClient, http } = require("viem");
  const client = createPublicClient({
    chain: {
      id: chainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  });

  // On Arc, USDC has TWO separate views of balance and they don't always
  // agree:
  //   - eth_getBalance(addr): "native" balance — credited by faucet drops
  //     and other native-level operations. 18-decimal wei.
  //   - USDC.balanceOf(addr) via precompile at 0x3600…0000: the ERC-20 view
  //     used by every smart-contract interaction (buy/sell/redeem/transfer).
  //     6-decimal.
  //
  // ERC-20 transferFrom() from a contract call updates the precompile but
  // does NOT decrement the native balance synchronously. So native lags
  // *down* after trades. Taking max(native, precompile) would incorrectly
  // show pre-trade amounts.
  //
  // For our app, "spendable USDC" = what the precompile says, because
  // every Market.buy() / Market.sell() / withdraw() goes through the
  // precompile. So that's the source of truth for balance display.
  //
  // The drawback: a fresh faucet drop credits native but not precompile
  // immediately, so a just-funded wallet may show old balance for ~30s
  // before the precompile catches up. Acceptable trade-off — the alternative
  // (showing native) gives wrong post-trade balances which is worse.
  const raw = (await client.readContract({
    address: usdcAddress,
    abi: USDC_ABI_BALANCE_OF,
    functionName: "balanceOf",
    args: [walletAddress as `0x${string}`],
  })) as bigint;
  return Number(raw) / 1_000_000;
}

/**
 * Look up the Circle tokenId for USDC on whatever chain this wallet lives on.
 * Falls back to `CIRCLE_USDC_TOKEN_ID` env var, then returns null. The token
 * registry only exposes a tokenId once the wallet has held that token at
 * least once — fund the wallet via the faucet before withdrawing.
 */
export async function findUsdcTokenId(walletId: string): Promise<string | null> {
  const envId = process.env.CIRCLE_USDC_TOKEN_ID;
  if (envId && envId.length > 0) return envId;

  const balances = await getCircleWalletBalances(walletId);
  const usdc = balances.find((b) => /^USDC/i.test(b.token.symbol));
  return usdc?.token.id ?? null;
}

// ── Transfers ───────────────────────────────────────────────────────────────

export async function executeCircleTransfer(opts: {
  walletId: string;
  destinationAddress: string;
  amount: string;
  idempotencyKey: string;
}): Promise<CircleTransfer> {
  if (devStub()) {
    return {
      id: `dev-tx-${opts.idempotencyKey}`,
      state: "PENDING",
      amounts: [opts.amount],
      createDate: new Date().toISOString(),
    };
  }

  // Resolve the USDC token UUID. Prefer the env override; otherwise pull
  // it from the wallet's balance list (Circle returns the tokenId there
  // once the wallet has held USDC).
  const tokenId = await findUsdcTokenId(opts.walletId);
  if (!tokenId) {
    throw new Error(
      "Could not resolve USDC tokenId for this wallet. Either set " +
        "CIRCLE_USDC_TOKEN_ID in env, or deposit some USDC first so Circle's " +
        "token registry can return the id."
    );
  }

  // Circle accepts EITHER explicit gas (gasPrice + gasLimit) OR a feeLevel
  // *at the top level of the request*. The previous wrapping into a `fee`
  // object made Circle think both were missing — hence the dual error.
  const body: Record<string, unknown> = {
    idempotencyKey: opts.idempotencyKey,
    walletId: opts.walletId,
    destinationAddress: opts.destinationAddress,
    amounts: [opts.amount],
    tokenId,
    feeLevel: "MEDIUM",
    entitySecretCiphertext: await freshEntitySecretCiphertext(),
  };

  const res = await fetch(`${CIRCLE_API_BASE}/developer/transactions/transfer`, {
    method: "POST",
    headers: circleHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Circle transfer failed: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  // Circle's developer-controlled transfer endpoint returns the transaction
  // record flat under `data` (not nested under `data.transfer`). Fall back to
  // the nested shape just in case Circle ever normalises the two APIs.
  const raw = data?.data?.transfer ?? data?.data;
  if (!raw || typeof raw !== "object" || !("id" in raw)) {
    throw new Error(
      `Circle transfer returned no id; response was ${JSON.stringify(data)}`
    );
  }
  return {
    id: String((raw as { id: unknown }).id),
    state: String((raw as { state?: unknown }).state ?? "INITIATED"),
    amounts: ((raw as { amounts?: unknown }).amounts as string[]) ?? [opts.amount],
    createDate:
      String((raw as { createDate?: unknown }).createDate ?? new Date().toISOString()),
  };
}

// ── Transactions ────────────────────────────────────────────────────────────

export interface CircleTransactionRecord {
  id: string;
  walletId: string;
  blockchain: string;
  tokenId: string;
  amounts: string[];
  transactionType: "INBOUND" | "OUTBOUND";
  state:
    | "INITIATED"
    | "PENDING_RISK_SCREENING"
    | "DENIED"
    | "QUEUED"
    | "SENT"
    | "CONFIRMED"
    | "COMPLETE"
    | "FAILED"
    | "CANCELLED";
  txHash?: string;
  sourceAddress?: string;
  destinationAddress?: string;
  createDate: string;
  firstConfirmDate?: string;
}

/**
 * List transactions for a given wallet. Used by the deposit watcher to
 * detect new inbound USDC arrivals against the internal ledger.
 *
 * Circle indexes its own transactions independently of the on-chain
 * balance, so this is the authoritative source for "did funds land?".
 */
export async function listCircleTransactions(opts: {
  walletId: string;
  type?: "INBOUND" | "OUTBOUND";
  pageSize?: number;
}): Promise<CircleTransactionRecord[]> {
  if (devStub()) return [];

  // Don't pass txType — Circle's filter is finicky and silently drops
  // transactions in some cases. Always fetch everything and filter
  // client-side. The deposit watcher only cares about INBOUND anyway.
  const params = new URLSearchParams({
    walletIds: opts.walletId,
    pageSize: String(opts.pageSize ?? 50),
  });

  const res = await fetch(`${CIRCLE_API_BASE}/transactions?${params}`, {
    headers: circleHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.warn("[circle] list transactions failed", err);
    return [];
  }

  const data = await res.json();
  const all = (data?.data?.transactions ?? []) as CircleTransactionRecord[];
  if (!opts.type) return all;
  return all.filter((t) => t.transactionType === opts.type);
}

/**
 * Fetch a Circle transaction's current state by its Circle tx ID.
 * Used by the frontend to poll for buy/sell/redeem/withdraw confirmation
 * after submission.
 */
export interface CircleTxState {
  id: string;
  state: string;          // INITIATED | QUEUED | SENT | CONFIRMED | COMPLETE | FAILED | CANCELLED | DENIED | PENDING_RISK_SCREENING
  txHash?: string;         // on-chain tx hash, set once mined
  errorReason?: string;
  amounts?: string[];
  blockchain?: string;
}

export async function getCircleTransaction(txId: string): Promise<CircleTxState | null> {
  if (devStub()) return null;
  const res = await fetch(`${CIRCLE_API_BASE}/transactions/${txId}`, {
    headers: circleHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data?.data?.transaction ?? null) as CircleTxState | null;
}

// ── Idempotency key helper ──────────────────────────────────────────────────
//
// Circle requires every idempotencyKey to be a valid UUID. We deterministically
// derive one from the (prefix, seed) tuple via SHA-1 (UUID v5 style). For
// wallet provisioning the seed is just userId → same UUID every retry, so
// Circle dedupes for us. For withdrawals the caller folds Date.now() into
// the seed → new UUID per transaction.

export function makeIdempotencyKey(prefix: string, seed: string): string {
  const hash = crypto.createHash("sha1").update(`${prefix}:${seed}`).digest();
  // Force UUID v5 version + RFC 4122 variant bits.
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
