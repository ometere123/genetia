import { abi as genlayerAbi, createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { TransactionHashVariant, type GenLayerTransaction, type TransactionHash } from "genlayer-js/types";
import { isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const STUDIO_DEV_RPC = "https://studio-dev.genlayer.com/api";
const BASE_CHAIN_ID = 84532;
const GENLAYER_CHAIN_ID = 61997;

export interface Env { WATCHER_ID: string; WATCHER_PRIVATE_KEY: Hex; GENLAYER_RPC: string }
export type ResolutionEnvelope = {
  marketId: Hex; baseMarket: Address; baseChainId: 84532; resolver: Address;
  genlayerChainId: 61997; genlayerTxId: Hex; manifestHash: Hex; resolverReleaseId: Hex;
  attempt: number; outcome: 0 | 1 | 2; evidenceCommitment: Hex; resultCommitment: Hex; gateway: Address;
};
export type FinalizedResolverState = {
  marketId: Hex;
  baseMarket: Address;
  manifestHash: Hex;
  resolverReleaseId: Hex;
  attempt: number;
  outcome: "YES" | "NO" | "VOID";
  evidence: Array<{ identity: string; url: string; contentHash: Hex }>;
  resolverResultCommitment: Hex;
  result: { terminal: boolean; reason?: string };
};
type CallData = { base64?: string; raw?: number[] };
type TransactionCallData = { calldata?: CallData };

function parseState(bindingValue: unknown, attemptValue: unknown): FinalizedResolverState {
  const binding = JSON.parse(String(bindingValue));
  const attempt = JSON.parse(String(attemptValue));
  if (!binding || !attempt || typeof binding !== "object" || typeof attempt !== "object") throw new Error("resolver state is invalid");
  const b = binding as Record<string, unknown>; const a = attempt as Record<string, unknown>;
  const evidence = a.evidence;
  if (!Array.isArray(evidence) || typeof a.evidence_commitment !== "string" || typeof a.result_commitment !== "string") throw new Error("resolver commitments are missing");
  if (!Object.prototype.hasOwnProperty.call(a, "attempt") || !Number.isInteger(a.attempt) || Number(a.attempt) < 0 || Number(a.attempt) > 4) throw new Error("resolver attempt is missing or invalid");
  if (typeof b.base_market !== "string") throw new Error("resolver base market is missing");
  return { marketId: String(b.market_id) as Hex, baseMarket: String(b.base_market) as Address, manifestHash: String(b.manifest_hash) as Hex, resolverReleaseId: String(b.resolver_release_id) as Hex, attempt: Number(a.attempt), outcome: String(a.outcome) as FinalizedResolverState["outcome"], evidence: evidence.map((item) => { const v = item as Record<string, unknown>; return { identity: String(v.identity), url: String(v.url), contentHash: `0x${String(v.content_hash).replace(/^0x/, "")}` as Hex }; }), resolverResultCommitment: String(a.result_commitment) as Hex, result: { terminal: b.status === "RESOLVED" } };
}

export function stableEvidenceJson(state: FinalizedResolverState): string {
  return JSON.stringify([...state.evidence].map((item) => ({
      content_hash: item.contentHash.toLowerCase().replace(/^0x/, ""), identity: item.identity, url: item.url,
    })).sort((a, b) => a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : a.url < b.url ? -1 : a.url > b.url ? 1 : a.content_hash < b.content_hash ? -1 : a.content_hash > b.content_hash ? 1 : 0));
}

export async function canonicalEvidenceCommitment(state: FinalizedResolverState): Promise<Hex> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableEvidenceJson(state)));
  return `0x${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
}

export function canonicalResolverResultJson(state: FinalizedResolverState, baseMarket: Address): string {
  return JSON.stringify({ attempt: state.attempt, base_market: baseMarket.toLowerCase(), evidence_commitment: state.resolverResultCommitment.toLowerCase(), manifest_hash: state.manifestHash.toLowerCase(), market_id: state.marketId.toLowerCase(), outcome: state.outcome, resolver_release_id: state.resolverReleaseId.toLowerCase() });
}

export async function canonicalResolverResultCommitment(state: FinalizedResolverState, baseMarket: Address): Promise<Hex> {
  const evidenceCommitment = await canonicalEvidenceCommitment(state);
  const preimage = canonicalResolverResultJson({ ...state, resolverResultCommitment: evidenceCommitment }, baseMarket);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(preimage));
  return `0x${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function decodeResolveCall(transaction: GenLayerTransaction): { marketId: string; attempt: number } {
  const data = transaction.data as unknown as TransactionCallData | undefined;
  const calldata = data?.calldata;
  const bytes = calldata?.raw
    ? Uint8Array.from(calldata.raw)
    : calldata?.base64
      ? Uint8Array.from(atob(calldata.base64), (character) => character.charCodeAt(0))
      : undefined;
  if (!bytes) throw new Error("transaction calldata is unavailable");
  const decoded = genlayerAbi.calldata.decode(bytes);
  if (!(decoded instanceof Map)) throw new Error("transaction calldata is malformed");
  const method = decoded.get("");
  const args = decoded.get("args");
  const attempt = Array.isArray(args) && (typeof args[1] === "bigint" || typeof args[1] === "number") ? Number(args[1]) : Number.NaN;
  if (method !== "resolve" || !Array.isArray(args) || typeof args[0] !== "string" || !Number.isSafeInteger(attempt)) throw new Error("transaction is not a valid resolve call");
  return { marketId: args[0], attempt };
}

export async function assertWatcherEligible(transaction: GenLayerTransaction, state: FinalizedResolverState, envelope: ResolutionEnvelope): Promise<void> {
  const txId = transaction.txId ?? transaction.hash;
  if (txId?.toLowerCase() !== envelope.genlayerTxId.toLowerCase()) throw new Error("wrong transaction");
  const recipient = transaction.recipient ?? transaction.to_address;
  if (recipient?.toLowerCase() !== envelope.resolver.toLowerCase()) throw new Error("wrong resolver");
  if (transaction.lifecycle.state !== "finalized") throw new Error("transaction is not finalized");
  if (!isSuccessful(transaction) || transaction.txExecutionResultName !== "FINISHED_WITH_RETURN") throw new Error("GenLayer execution was not successful");
  const decodedCall = decodeResolveCall(transaction);
  if (envelope.baseChainId !== BASE_CHAIN_ID || envelope.genlayerChainId !== GENLAYER_CHAIN_ID) throw new Error("wrong chain");
  if (decodedCall.marketId.toLowerCase() !== envelope.marketId.toLowerCase() || decodedCall.attempt !== envelope.attempt) throw new Error("resolve call arguments do not match envelope");
  if (state.marketId.toLowerCase() !== envelope.marketId.toLowerCase()) throw new Error("wrong market state");
  if (state.baseMarket.toLowerCase() !== envelope.baseMarket.toLowerCase()) throw new Error("wrong base market state");
  if (state.manifestHash.toLowerCase() !== envelope.manifestHash.toLowerCase()) throw new Error("wrong manifest state");
  if (state.resolverReleaseId.toLowerCase() !== envelope.resolverReleaseId.toLowerCase()) throw new Error("wrong resolver release state");
  if (state.attempt !== envelope.attempt || state.outcome !== (["YES", "NO", "VOID"] as const)[envelope.outcome]) throw new Error("wrong resolver result");
  if (await canonicalEvidenceCommitment(state) !== envelope.evidenceCommitment) throw new Error("wrong evidence commitment");
  const resolverResultCommitment = await canonicalResolverResultCommitment(state, envelope.baseMarket);
  if (resolverResultCommitment !== state.resolverResultCommitment.toLowerCase() || resolverResultCommitment !== envelope.resultCommitment.toLowerCase()) throw new Error("wrong result commitment");
}

type WatcherClient = {
  getTransaction(args: { hash: TransactionHash }): Promise<GenLayerTransaction>;
  readContract(args: Record<string, unknown>): Promise<unknown>;
};

const envelopeTypes = { ResolutionEnvelope: [
  { name: "marketId", type: "bytes32" }, { name: "baseMarket", type: "address" },
  { name: "baseChainId", type: "uint256" }, { name: "resolver", type: "address" },
  { name: "genlayerChainId", type: "uint256" }, { name: "genlayerTxId", type: "bytes32" },
  { name: "manifestHash", type: "bytes32" }, { name: "resolverReleaseId", type: "bytes32" },
  { name: "attempt", type: "uint8" }, { name: "outcome", type: "uint8" },
  { name: "evidenceCommitment", type: "bytes32" }, { name: "resultCommitment", type: "bytes32" },
] } as const;

export async function attestWithClient(envelope: ResolutionEnvelope, env: Env, client: WatcherClient) {
  if (env.GENLAYER_RPC !== STUDIO_DEV_RPC) throw new Error("wrong GenLayer network");
  if (envelope.baseChainId !== BASE_CHAIN_ID || envelope.genlayerChainId !== GENLAYER_CHAIN_ID) throw new Error("wrong chain");
  if (!isAddress(envelope.baseMarket) || !isAddress(envelope.resolver) || !isAddress(envelope.gateway)) throw new Error("invalid address");
  const transaction = await client.getTransaction({ hash: envelope.genlayerTxId as TransactionHash });
  const binding = await client.readContract({ address: envelope.resolver, functionName: "get_binding_state", transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
  const attempt = await client.readContract({ address: envelope.resolver, functionName: "get_attempt", args: [envelope.attempt], transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
  const state = parseState(binding, attempt);
  await assertWatcherEligible(transaction, state, envelope);
  const account = privateKeyToAccount(env.WATCHER_PRIVATE_KEY);
  const { gateway: verifyingContract, ...wireEnvelope } = envelope;
  const message = {
    ...wireEnvelope,
    baseChainId: BigInt(wireEnvelope.baseChainId),
    genlayerChainId: BigInt(wireEnvelope.genlayerChainId),
  };
  const signature = await account.signTypedData({
    domain: { name: "Genetia Resolution", version: "1", chainId: BASE_CHAIN_ID, verifyingContract },
    types: envelopeTypes, primaryType: "ResolutionEnvelope", message,
  });
  // Return the wire envelope rather than the bigint-rich EIP-712 message so
  // Response.json remains standards-compliant. The signed values are identical.
  return { watcherId: env.WATCHER_ID, watcherAddress: account.address, envelope, signature };
}

export async function attest(envelope: ResolutionEnvelope, env: Env) {
  const client = createClient({ chain: studioDevnet, endpoint: env.GENLAYER_RPC });
  return attestWithClient(envelope, env, client as unknown as WatcherClient);
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!env.WATCHER_ID || !env.WATCHER_PRIVATE_KEY) return new Response("misconfigured", { status: 503 });
  try { return Response.json(await attest((await request.json()) as ResolutionEnvelope, env)); }
  catch (error) { return Response.json({ eligible: false, reason: error instanceof Error ? error.message : "verification failed" }, { status: 422 }); }
} };
