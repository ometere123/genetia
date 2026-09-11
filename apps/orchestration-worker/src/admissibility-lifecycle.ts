import { abi as genlayerAbi, createAccount, createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import type { DebugTraceResult, GenLayerTransaction, TransactionHash } from "genlayer-js/types";
import { TransactionHashVariant } from "genlayer-js/types";
import { hexToBytes, type Address, type Hex } from "viem";

export interface StudioAdmissibilityEnv {
  GENLAYER_RPC: string;
  GENLAYER_PRIVATE_KEY?: Hex;
  MARKET_ADMISSIBILITY_ADDRESS?: Address;
}

/** Creates the real Studio Dev client. Missing signer or contract configuration
 * is a hard failure; no local/direct-mode result is accepted as production
 * admissibility. */
export function createStudioAdmissibilityClient(env: StudioAdmissibilityEnv): AdmissibilityClient {
  if (env.GENLAYER_RPC !== "https://studio-dev.genlayer.com/api") throw new Error("wrong GenLayer network");
  if (!env.GENLAYER_PRIVATE_KEY) throw new Error("GenLayer signer is not configured");
  if (!env.MARKET_ADMISSIBILITY_ADDRESS) throw new Error("MarketAdmissibility address is not configured");
  const client = createClient({ chain: studioDevnet, endpoint: env.GENLAYER_RPC, account: createAccount(env.GENLAYER_PRIVATE_KEY) });
  return {
    writeContract: ({ address, functionName, args }) => client.writeContract({ address, functionName, args: [...args] as never }),
    getTransaction: ({ hash }) => client.getTransaction({ hash }),
    debugTraceTransaction: ({ hash }) => client.debugTraceTransaction({ hash }),
    readAssessment: ({ address, proposalId }) => client.readContract({ address, functionName: "get_assessment", args: [proposalId], transactionHashVariant: TransactionHashVariant.LATEST_FINAL }),
  };
}

export type AdmissibilityDecision = "APPROVED" | "NEEDS_REVISION" | "REJECTED";
export interface AdmissibilityClient {
  writeContract(args: { address: Address; functionName: "assess"; args: readonly unknown[] }): Promise<unknown>;
  getTransaction(args: { hash: TransactionHash }): Promise<GenLayerTransaction>;
  debugTraceTransaction(args: { hash: TransactionHash }): Promise<DebugTraceResult>;
  readAssessment?(args: { address: Address; proposalId: string }): Promise<unknown>;
}
export interface AdmissibilityOperation { proposalId: string; operationId: string; txId?: TransactionHash; lifecycle: "READY" | "SUBMITTING" | "SUBMITTED" | "ACCEPTED" | "FINALIZED" | "FAILED"; decision?: AdmissibilityDecision; issues?: string[]; }
export interface AdmissibilityStore {
  createIfAbsent(value: AdmissibilityOperation): Promise<AdmissibilityOperation>;
  load(operationId: string): Promise<AdmissibilityOperation | null>;
  claimSubmission?(operationId: string): Promise<boolean>;
  persistSubmission(operationId: string, txId: TransactionHash): Promise<void>;
  persistObservation(operationId: string, patch: Partial<AdmissibilityOperation>): Promise<void>;
}
function txHash(value: unknown): TransactionHash {
  const candidate = typeof value === "string" ? value : value && typeof value === "object" ? ((value as { txId?: unknown; hash?: unknown }).txId ?? (value as { hash?: unknown }).hash) : undefined;
  if (typeof candidate !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(candidate)) throw new Error("admissibility submission did not return a transaction ID");
  return candidate as TransactionHash;
}
export function admissibilityOperationId(proposalId: string): string { if (!proposalId) throw new Error("proposal id required"); return `admissibility:${proposalId}`; }
export async function submitAdmissibilityOnce(client: AdmissibilityClient, store: AdmissibilityStore, input: { proposalId: string; contract: Address; manifest: string }): Promise<TransactionHash> {
  const operationId = admissibilityOperationId(input.proposalId);
  const existing = await store.createIfAbsent({ proposalId: input.proposalId, operationId, lifecycle: "READY" });
  if (existing.txId) return existing.txId;
  if (store.claimSubmission && !(await store.claimSubmission(operationId))) {
    const concurrent = await store.load(operationId);
    if (concurrent?.txId) return concurrent.txId;
    throw new Error("admissibility submission is already owned by another worker");
  }
  const submitted = await client.writeContract({ address: input.contract, functionName: "assess", args: [input.proposalId, input.manifest] });
  const id = txHash(submitted);
  await store.persistSubmission(operationId, id);
  return id;
}
export function classifyAdmissibility(transaction: GenLayerTransaction, trace?: DebugTraceResult): Pick<AdmissibilityOperation, "lifecycle" | "decision" | "issues"> & { attestable: boolean } {
  if (transaction.lifecycle.state !== "finalized") return { lifecycle: transaction.lifecycle.state === "decided" ? "ACCEPTED" : "SUBMITTED", attestable: false };
  if (!isSuccessful(transaction) || transaction.txExecutionResultName !== "FINISHED_WITH_RETURN" || !trace || trace.result_code !== 1 || trace.stderr.length !== 0) return { lifecycle: "FAILED", attestable: false };
  const decoded = genlayerAbi.calldata.decode(hexToBytes(trace.return_data as Hex));
  if (decoded !== "APPROVED" && decoded !== "NEEDS_REVISION" && decoded !== "REJECTED") return { lifecycle: "FAILED", attestable: false };
  return { lifecycle: "FINALIZED", decision: decoded, attestable: true };
}
function parseAssessment(value: unknown): { decision: AdmissibilityDecision; issues: string[] } {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) throw new Error("admissibility readback was empty");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("admissibility readback was not valid JSON"); }
  if (!parsed || typeof parsed !== "object") throw new Error("admissibility readback was not an object");
  const record = parsed as Record<string, unknown>;
  const decision = record.decision;
  const issues = record.issue_codes;
  if (decision !== "APPROVED" && decision !== "NEEDS_REVISION" && decision !== "REJECTED") throw new Error("admissibility readback has invalid decision");
  if (!Array.isArray(issues) || issues.some((issue) => typeof issue !== "string")) throw new Error("admissibility readback has invalid issue codes");
  if (decision === "APPROVED" && issues.length !== 0) throw new Error("approved admissibility readback contains issues");
  if (decision !== "APPROVED" && issues.length === 0) throw new Error("non-approved admissibility readback has no issue codes");
  return { decision, issues };
}
export async function followAdmissibility(client: AdmissibilityClient, store: AdmissibilityStore, proposalId: string) {
  const operationId = admissibilityOperationId(proposalId); const state = await store.load(operationId);
  if (!state?.txId) throw new Error("admissibility transaction was not persisted");
  const transaction = await client.getTransaction({ hash: state.txId });
  if (transaction.lifecycle.state !== "finalized") {
    const observation = classifyAdmissibility(transaction); await store.persistObservation(operationId, observation); return { txId: state.txId, ...observation };
  }
  if (!isSuccessful(transaction) || transaction.txExecutionResultName !== "FINISHED_WITH_RETURN") {
    const observation = classifyAdmissibility(transaction); await store.persistObservation(operationId, observation); return { txId: state.txId, ...observation };
  }
  const trace = await client.debugTraceTransaction({ hash: state.txId });
  const base = classifyAdmissibility(transaction, trace);
  if (!client.readAssessment) throw new Error("admissibility finalized readback is not configured");
  const readback = parseAssessment(await client.readAssessment({ address: transaction.recipient as Address, proposalId }));
  if (base.decision !== readback.decision) throw new Error("admissibility trace/readback decision mismatch");
  const observation = { ...base, issues: readback.issues };
  await store.persistObservation(operationId, observation);
  return { txId: state.txId, ...observation };
}
