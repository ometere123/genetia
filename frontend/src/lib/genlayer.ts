/**
 * GenLayer relayer service (server-only).
 *
 * Targets genlayer-js v1.1.8 against GenLayer Studionet
 * (chain id 61999, RPC https://studio.genlayer.com/api).
 *
 * SDK shape:
 *   createAccount(privateKey: \`0x${string}\`)
 *   createClient({ chain, endpoint?, account? })
 *   client.writeContract({ address, functionName, args, value, kwargs? })
 *     - args: CalldataEncodable[] — strings/bools/bigints/arrays nest naturally
 *     - value: required bigint
 *   client.readContract({ address, functionName, args })
 *
 * Timestamps stay off-chain (Settlement table). The contract stores only
 * the semantic verdict (outcome boolean + reasoning string).
 */

import "server-only";

export interface GenLayerVerdict {
  outcome: boolean;
  reasoning: string;
  confidence?: number;
  verdictId?: string;
  evidenceUrls?: string[];
}

export interface ResolveRequestArgs {
  marketId: string;
  question: string;
  resolutionCriteria: string;
  sources: string[];
}

export interface ResolveResult {
  txHash: string;
  verdict: GenLayerVerdict | null;
  finalizedAt: Date | null;
}

const GENLAYER_RPC =
  process.env.GENLAYER_RPC ?? process.env.GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api";
const CONTRACT_ADDRESS = (process.env.GENLAYER_CONTRACT_ADDRESS ?? "") as `0x${string}`;
const RELAYER_KEY = process.env.GENLAYER_RELAYER_PRIVATE_KEY ?? "";

function devStubEnabled(): boolean {
  return !CONTRACT_ADDRESS || !RELAYER_KEY;
}

function normaliseKey(): `0x${string}` {
  const trimmed = RELAYER_KEY.trim();
  const hexKey = (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hexKey)) {
    throw new Error(
      "GENLAYER_RELAYER_PRIVATE_KEY must be a 64-character hex string (with or without 0x prefix)"
    );
  }
  return hexKey;
}

function buildClient() {
  // Lazy require so the build doesn't depend on genlayer-js being installed
  // when the env vars aren't set (CI etc.).
  const { createAccount, createClient } = require("genlayer-js");
  const { studionet } = require("genlayer-js/chains");

  const account = createAccount(normaliseKey());
  const client  = createClient({
    chain: studionet,
    endpoint: GENLAYER_RPC,
    account,
  });
  return { client, account };
}

/**
 * Fire `resolve_market` on the MarketResolver contract. Returns the
 * transaction hash; the caller should poll `getResolution` to detect
 * finality.
 *
 * NB: the contract signature is
 *   resolve_market(market_id: str, question: str,
 *                  resolution_criteria: str, sources: DynArray[str])
 * so the args here must match positionally.
 */
export async function submitResolveRequest(
  args: ResolveRequestArgs
): Promise<{ txHash: string }> {
  if (devStubEnabled()) {
    const stub = `0xstub-${args.marketId.slice(0, 12)}-${Date.now().toString(16)}`;
    console.warn(
      "[genlayer] dev stub — set GENLAYER_CONTRACT_ADDRESS and " +
        "GENLAYER_RELAYER_PRIVATE_KEY in .env to enable real calls. " +
        `Stub tx: ${stub}`
    );
    return { txHash: stub };
  }

  const { client, account } = buildClient();

  const hash = await client.writeContract({
    account,
    address: CONTRACT_ADDRESS,
    functionName: "resolve_market",
    args: [
      args.marketId,
      args.question,
      args.resolutionCriteria,
      args.sources.slice(0, 5),
    ],
    value: 0n,
  });

  return { txHash: String(hash) };
}

/**
 * Read `get_resolution(market_id)` view. The contract returns the JSON
 * string `"null"` while the market is unresolved, otherwise a JSON-encoded
 * `{ outcome: bool, reasoning: str }`.
 */
export async function getResolution(
  marketId: string
): Promise<GenLayerVerdict | null> {
  if (devStubEnabled()) return null;
  const { createClient } = require("genlayer-js");
  const { studionet } = require("genlayer-js/chains");

  const client = createClient({ chain: studionet, endpoint: GENLAYER_RPC });

  let raw: unknown;
  try {
    raw = await client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_resolution",
      args: [marketId],
    });
  } catch (err) {
    console.warn("[genlayer] readContract failed", err);
    return null;
  }

  const text = typeof raw === "string" ? raw : raw == null ? "null" : String(raw);
  if (!text || text === "null") return null;

  try {
    const parsed = JSON.parse(text);
    if (parsed === null) return null;
    if (typeof parsed.outcome !== "boolean") {
      console.error("[genlayer] resolution outcome must be boolean", parsed);
      return null;
    }
    const confidence =
      typeof parsed.confidence === "number" ? parsed.confidence : undefined;
    const evidenceUrls = Array.isArray(parsed.evidenceUrls)
      ? parsed.evidenceUrls.filter((u: unknown): u is string => typeof u === "string")
      : undefined;
    return {
      outcome: parsed.outcome,
      reasoning: String(parsed.reasoning ?? ""),
      confidence,
      verdictId: typeof parsed.verdictId === "string" ? parsed.verdictId : undefined,
      evidenceUrls,
    };
  } catch (err) {
    console.error("[genlayer] failed to parse resolution JSON", err, text);
    return null;
  }
}

/**
 * Poll getResolution every `intervalMs` for up to `timeoutMs`.
 */
export async function waitForResolution(
  marketId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<{ verdict: GenLayerVerdict; finalizedAt: Date }> {
  const intervalMs = opts.intervalMs ?? 5_000;
  const timeoutMs  = opts.timeoutMs  ?? 5 * 60_000;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await getResolution(marketId);
    if (v) return { verdict: v, finalizedAt: new Date() };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`GenLayer resolution timed out for market ${marketId}`);
}

export const genlayerExplorerTxUrl = (txHash: string) =>
  `https://explorer-studio.genlayer.com/tx/${txHash}`;

export const genlayerExplorerAddressUrl = (address: string) =>
  `https://explorer-studio.genlayer.com/address/${address}`;
