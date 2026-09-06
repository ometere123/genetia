import { abi as genlayerAbi, createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import type { GenLayerTransaction, TransactionHash } from "genlayer-js/types";
import { encodeAbiParameters, hexToBytes, isAddress, keccak256, type Address, type Hex } from "viem";
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
type Trace = { result_code: number; return_data: string; stderr: string };

export function decodeFinalOutcome(returnData: string): 0 | 1 | 2 {
  if (!/^0x[0-9a-fA-F]*$/.test(returnData)) throw new Error("invalid GenVM return data");
  const decoded = genlayerAbi.calldata.decode(hexToBytes(returnData as Hex));
  const value = typeof decoded === "string" ? decoded : "";
  if (value === "YES") return 0;
  if (value === "NO") return 1;
  if (value === "VOID") return 2;
  throw new Error("non-terminal GenLayer result");
}

export function assertWatcherEligible(transaction: GenLayerTransaction, trace: Trace, envelope: ResolutionEnvelope): void {
  const txId = transaction.txId ?? transaction.hash;
  if (txId?.toLowerCase() !== envelope.genlayerTxId.toLowerCase()) throw new Error("wrong transaction");
  const recipient = transaction.recipient ?? transaction.to_address;
  if (recipient?.toLowerCase() !== envelope.resolver.toLowerCase()) throw new Error("wrong resolver");
  if (transaction.lifecycle.state !== "finalized") throw new Error("transaction is not finalized");
  if (!isSuccessful(transaction) || transaction.txExecutionResultName !== "FINISHED_WITH_RETURN") throw new Error("GenLayer execution was not successful");
  if (trace.result_code !== 1 || trace.stderr.length !== 0) throw new Error("GenVM trace was not successful");
  if (decodeFinalOutcome(trace.return_data) !== envelope.outcome) throw new Error("altered outcome");
  if (keccak256(trace.return_data as Hex) !== envelope.evidenceCommitment) throw new Error("wrong evidence commitment");
  if (finalizedResolutionCommitment(envelope) !== envelope.resultCommitment) throw new Error("wrong result commitment");
}

export function finalizedResolutionCommitment(envelope: ResolutionEnvelope): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }, { type: "uint8" }, { type: "bytes32" }],
    [envelope.marketId, envelope.baseMarket, BigInt(envelope.baseChainId), BigInt(envelope.genlayerChainId), envelope.resolver, envelope.resolverReleaseId, envelope.manifestHash, envelope.genlayerTxId, envelope.attempt, envelope.outcome, envelope.evidenceCommitment],
  ));
}

const envelopeTypes = { ResolutionEnvelope: [
  { name: "marketId", type: "bytes32" }, { name: "baseMarket", type: "address" },
  { name: "baseChainId", type: "uint256" }, { name: "resolver", type: "address" },
  { name: "genlayerChainId", type: "uint256" }, { name: "genlayerTxId", type: "bytes32" },
  { name: "manifestHash", type: "bytes32" }, { name: "resolverReleaseId", type: "bytes32" },
  { name: "attempt", type: "uint8" }, { name: "outcome", type: "uint8" },
  { name: "evidenceCommitment", type: "bytes32" }, { name: "resultCommitment", type: "bytes32" },
] } as const;

export async function attest(envelope: ResolutionEnvelope, env: Env) {
  if (env.GENLAYER_RPC !== STUDIO_DEV_RPC) throw new Error("wrong GenLayer network");
  if (envelope.baseChainId !== BASE_CHAIN_ID || envelope.genlayerChainId !== GENLAYER_CHAIN_ID) throw new Error("wrong chain");
  if (!isAddress(envelope.baseMarket) || !isAddress(envelope.resolver) || !isAddress(envelope.gateway)) throw new Error("invalid address");
  const client = createClient({ chain: studioDevnet, endpoint: env.GENLAYER_RPC });
  const transaction = await client.getTransaction({ hash: envelope.genlayerTxId as TransactionHash });
  const trace = await client.debugTraceTransaction({ hash: envelope.genlayerTxId as TransactionHash });
  assertWatcherEligible(transaction, trace, envelope);
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

export default { async fetch(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!env.WATCHER_ID || !env.WATCHER_PRIVATE_KEY) return new Response("misconfigured", { status: 503 });
  try { return Response.json(await attest((await request.json()) as ResolutionEnvelope, env)); }
  catch (error) { return Response.json({ eligible: false, reason: error instanceof Error ? error.message : "verification failed" }, { status: 422 }); }
} };
