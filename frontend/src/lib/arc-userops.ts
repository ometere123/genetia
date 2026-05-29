/**
 * Arc on-chain executor (server-only).
 *
 * Bridges Genetia's backend intent ("buy 25 YES on market X for at most
 * $14") to actual on-chain transactions. We do NOT hand-roll ERC-4337
 * UserOperations; Circle's Developer-Controlled Wallets API does that for
 * us internally via their bundler + paymaster (Gas Station) stack on Arc.
 *
 * Why this layer exists
 * ─────────────────────
 * Frontend posts to /api/bets/place → that route calls executeContractCall
 * here with the user's wallet ID, the LMSRMarket address, and the buy
 * arguments. Circle validates, signs as the user's SCA, submits to the
 * bundler, pays gas via Gas Station (sponsored on testnet), and returns a
 * transaction ID we can poll until it confirms on Arc.
 *
 * What we do here vs Circle SDK
 * ─────────────────────────────
 * Circle's SDK accepts strings/numbers for `abiParameters` and only
 * supports a narrow subset of types. We accept proper viem-typed args,
 * stringify them for the wire, and parse responses back into clean types
 * for the rest of the codebase.
 */

import "server-only";

import { encodeFunctionData, type Abi, type AbiFunction } from "viem";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;

function devStub(): boolean {
  return !CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET;
}

let _client: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;
function client() {
  if (!_client) {
    if (devStub()) throw new Error("Circle credentials missing");
    _client = initiateDeveloperControlledWalletsClient({
      apiKey: CIRCLE_API_KEY!,
      entitySecret: CIRCLE_ENTITY_SECRET!,
    });
  }
  return _client;
}

// ── Execute a contract call through a user's Circle wallet ───────────────

export interface ContractCallArgs {
  /** Circle wallet ID of the caller (user's SCA on Arc). */
  walletId: string;
  /** Address of the contract to invoke. */
  contractAddress: `0x${string}`;
  /** Function signature in Solidity form, e.g. `"buy(uint8,uint256,uint256)"`. */
  abiFunctionSignature: string;
  /** Positional arguments matching the signature. */
  args: Array<string | number | boolean>;
  /** Idempotency key — Circle will dedupe duplicate submissions. */
  idempotencyKey: string;
  /** Optional opaque ref string for our own tracking. */
  refId?: string;
}

export interface ContractCallResult {
  /** Circle transaction ID — use this to poll for confirmation. */
  txId: string;
  /** Initial state, usually "INITIATED". */
  state: string;
}

export async function executeContractCall(
  opts: ContractCallArgs
): Promise<ContractCallResult> {
  if (devStub()) {
    const stub = `dev-tx-${opts.idempotencyKey}`;
    console.warn(
      "[arc-userops] dev stub — set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET. " +
        `Would call ${opts.contractAddress}.${opts.abiFunctionSignature} ` +
        `with ${JSON.stringify(opts.args)}; stub tx: ${stub}`
    );
    return { txId: stub, state: "INITIATED" };
  }

  const res = await client().createContractExecutionTransaction({
    walletId: opts.walletId,
    contractAddress: opts.contractAddress,
    abiFunctionSignature: opts.abiFunctionSignature,
    abiParameters: opts.args,
    idempotencyKey: opts.idempotencyKey,
    refId: opts.refId,
    // Gas Station on Arc testnet sponsors gas; fee is optional but the SDK
    // requires it. Use the cheapest tier — Circle's policy is what really
    // determines who pays.
    fee: { type: "level", config: { feeLevel: "LOW" } } as Parameters<
      ReturnType<typeof client>["createContractExecutionTransaction"]
    >[0]["fee"],
  });

  const data = (res as { data?: { id?: string; state?: string } }).data;
  if (!data?.id) {
    throw new Error(`Circle contractExecution returned no id: ${JSON.stringify(res)}`);
  }
  return { txId: data.id, state: data.state ?? "INITIATED" };
}

// ── Status polling ───────────────────────────────────────────────────────

export type ArcTxState =
  | "INITIATED"
  | "PENDING_RISK_SCREENING"
  | "DENIED"
  | "QUEUED"
  | "SENT"
  | "CONFIRMED"
  | "COMPLETE"
  | "FAILED"
  | "CANCELLED";

export interface ArcTxStatus {
  id: string;
  state: ArcTxState;
  txHash?: string;
  errorReason?: string;
}

export async function getArcTxStatus(txId: string): Promise<ArcTxStatus> {
  if (devStub()) {
    return { id: txId, state: "COMPLETE", txHash: `0x${"00".repeat(32)}` };
  }
  const res = await client().getTransaction({ id: txId });
  const tx = (res as { data?: { transaction?: { state?: string; txHash?: string; errorReason?: string } } }).data?.transaction;
  if (!tx) throw new Error(`Circle getTransaction returned no tx for ${txId}`);
  return {
    id: txId,
    state: (tx.state ?? "INITIATED") as ArcTxState,
    txHash: tx.txHash,
    errorReason: tx.errorReason,
  };
}

/**
 * Wait until a Circle transaction reaches a terminal state. Returns the
 * final status. Throws if `terminalStates` is hit with a non-success state.
 */
export async function waitForArcTx(
  txId: string,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    successStates?: ArcTxState[];
  } = {}
): Promise<ArcTxStatus> {
  const intervalMs = opts.intervalMs ?? 3_000;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const success = opts.successStates ?? ["CONFIRMED", "COMPLETE"];
  const terminalFail: ArcTxState[] = ["DENIED", "FAILED", "CANCELLED"];

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getArcTxStatus(txId);
    if (success.includes(status.state)) return status;
    if (terminalFail.includes(status.state)) {
      throw new Error(`Arc tx ${txId} ${status.state}: ${status.errorReason ?? "no reason"}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Arc tx ${txId} did not confirm within ${timeoutMs}ms`);
}

// ── High-level Genetia call builders ─────────────────────────────────────

/**
 * Convert a viem ABI function into Circle's `abiFunctionSignature` string
 * (e.g. `buy(uint8,uint256,uint256)`).
 */
function signatureOf(abi: Abi, name: string): string {
  const fn = abi.find(
    (a): a is AbiFunction => a.type === "function" && (a as AbiFunction).name === name
  );
  if (!fn) throw new Error(`abi function ${name} not found`);
  return `${fn.name}(${fn.inputs.map((i) => i.type).join(",")})`;
}

/** Convert arbitrary args to Circle-compatible string array. */
function argsToCircle(args: ReadonlyArray<unknown>): Array<string | number | boolean> {
  return args.map((a) => {
    if (typeof a === "bigint") return a.toString();
    if (typeof a === "string" || typeof a === "number" || typeof a === "boolean") return a;
    return String(a);
  });
}

/**
 * Submit a contract call via Circle, using a viem ABI for type-safety on
 * the caller side. Returns Circle's transaction id (poll with
 * `getArcTxStatus` / `waitForArcTx`).
 */
export async function callContract<TAbi extends Abi>(opts: {
  walletId: string;
  contractAddress: `0x${string}`;
  abi: TAbi;
  functionName: string;
  args: ReadonlyArray<unknown>;
  idempotencyKey: string;
  refId?: string;
}): Promise<ContractCallResult> {
  const sig = signatureOf(opts.abi, opts.functionName);
  return executeContractCall({
    walletId: opts.walletId,
    contractAddress: opts.contractAddress,
    abiFunctionSignature: sig,
    args: argsToCircle(opts.args),
    idempotencyKey: opts.idempotencyKey,
    refId: opts.refId,
  });
}

/**
 * Helper for callers that don't want to think about the function signature
 * — encodes the call locally for logging/debugging too.
 */
export function previewCalldata(
  abi: Abi,
  functionName: string,
  args: ReadonlyArray<unknown>
): `0x${string}` {
  return encodeFunctionData({
    abi,
    functionName,
    args: args as unknown[],
  } as Parameters<typeof encodeFunctionData>[0]);
}

// ── Idempotency-key helpers ──────────────────────────────────────────────

/**
 * Build a stable idempotency key for a user-action combination. Use the
 * same key for retries; use different keys for distinct actions.
 *
 * Circle requires idempotency keys in UUID v4 format, so we hash the
 * scope+parts into a deterministic UUIDv5 (so retries with the same
 * inputs hit the same key, and Circle dedupes correctly).
 */
const GENETIA_NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341";

export function makeArcIdempotencyKey(
  scope: string,
  parts: ReadonlyArray<string>
): string {
  const seed = `${scope}:${parts.join(":")}`;
  // SHA-1-based UUIDv5 (RFC 4122 §4.3) — same deterministic id for the
  // same seed, valid Circle-accepted format.
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const nsBytes = Buffer.from(GENETIA_NAMESPACE.replace(/-/g, ""), "hex");
  const h = crypto.createHash("sha1");
  h.update(nsBytes);
  h.update(Buffer.from(seed, "utf8"));
  const bytes = Buffer.from(h.digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
