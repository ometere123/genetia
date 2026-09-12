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
  const account = createAccount(env.GENLAYER_PRIVATE_KEY);
  const client = createClient({ chain: studioDevnet, endpoint: env.GENLAYER_RPC, account });
  return {
    writeContract: ({ address, functionName, args }) => client.writeContract({ address, functionName, args: [...args] as never }),
    getTransaction: ({ hash }) => client.getTransaction({ hash }),
    debugTraceTransaction: ({ hash }) => client.debugTraceTransaction({ hash }),
    readAssessment: ({ address, proposalId }) => client.readContract({ address, functionName: "get_assessment", args: [proposalId], transactionHashVariant: TransactionHashVariant.LATEST_FINAL }),
    findSubmission: async ({ address, proposalId }) => {
      // Studio Dev's address-history RPC returns full transaction records. The
      // search is read-only and matches signer, recipient, method and proposal
      // ID; a matching record is recovered instead of resubmitting.
      const result = await client.request({ method: "sim_getTransactionsForAddress", params: [account.address] });
      if (!Array.isArray(result)) throw new Error("GenLayer address history returned an unsupported response");
      const candidates: TransactionHash[] = [];
      for (const raw of result as Array<Record<string, unknown>>) {
        const hash = raw.hash;
        const sender = raw.from_address;
        const recipient = raw.to_address;
        if (typeof hash !== "string" || typeof sender !== "string" || typeof recipient !== "string" || sender.toLowerCase() !== account.address.toLowerCase() || recipient.toLowerCase() !== address.toLowerCase()) continue;
        const transaction = await client.getTransaction({ hash: hash as TransactionHash });
        const call = transaction.data as { calldata?: { raw?: number[]; base64?: string } } | undefined;
        const encoded = call?.calldata?.raw
          ? Uint8Array.from(call.calldata.raw)
          : call?.calldata?.base64
            ? Uint8Array.from(atob(call.calldata.base64), (character) => character.charCodeAt(0))
            : undefined;
        if (!encoded) continue;
        const decoded = genlayerAbi.calldata.decode(encoded);
        if (!(decoded instanceof Map) || decoded.get("") !== "assess") continue;
        const args = decoded.get("args");
        if (Array.isArray(args) && args[0] === proposalId) candidates.push(hash as TransactionHash);
      }
      if (candidates.length > 1) throw new Error("multiple matching GenLayer assessments found for one durable operation");
      return candidates[0];
    },
  };
}

export type AdmissibilityDecision = "APPROVED" | "NEEDS_REVISION" | "REJECTED";
export interface AdmissibilityClient {
  writeContract(args: { address: Address; functionName: "assess"; args: readonly unknown[] }): Promise<unknown>;
  getTransaction(args: { hash: TransactionHash }): Promise<GenLayerTransaction>;
  debugTraceTransaction(args: { hash: TransactionHash }): Promise<DebugTraceResult>;
  findSubmission?(args: { address: Address; proposalId: string }): Promise<TransactionHash | undefined>;
  readAssessment?(args: { address: Address; proposalId: string }): Promise<unknown>;
}
export interface AdmissibilityOperation { proposalId: string; operationId: string; txId?: TransactionHash; lifecycle: "READY" | "SUBMITTING" | "SUBMITTED" | "ACCEPTED" | "FINALIZED" | "FAILED" | "RETRY"; decision?: AdmissibilityDecision; issues?: string[]; submissionRecoveryRequired?: boolean; startedAt?: string; }
export interface AdmissibilityStore {
  createIfAbsent(value: AdmissibilityOperation): Promise<AdmissibilityOperation>;
  load(operationId: string): Promise<AdmissibilityOperation | null>;
  claimSubmission?(operationId: string): Promise<boolean>;
  persistSubmission(operationId: string, txId: TransactionHash): Promise<void>;
  persistObservation(operationId: string, patch: Partial<AdmissibilityOperation>): Promise<void>;
  deferSubmissionRecovery?(operationId: string, retryAt: Date, reason: string): Promise<void>;
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
  if (existing.lifecycle === "SUBMITTING" || existing.submissionRecoveryRequired) {
    let recovered: TransactionHash | undefined;
    try { recovered = await client.findSubmission?.({ address: input.contract, proposalId: input.proposalId }); }
    catch { throw new Error("admissibility submission outcome is uncertain; reconciliation must search again"); }
    if (recovered) {
      await store.persistSubmission(operationId, recovered);
      return recovered;
    }
    // Absence from the current RPC history is not proof that the remote write
    // was never accepted. Keep the deterministic operation in recovery and
    // make a later lookup; never turn an ambiguous external write into a
    // second transaction.
    throw new Error("admissibility submission outcome is uncertain; reconciliation must search again");
  }
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
export function classifyAdmissibility(transaction: GenLayerTransaction, trace?: DebugTraceResult): Pick<AdmissibilityOperation, "lifecycle" | "decision" | "issues"> & { attestable: boolean; traceDecisionVerified?: boolean } {
  if (transaction.lifecycle.state !== "finalized") return { lifecycle: transaction.lifecycle.state === "decided" ? "ACCEPTED" : "SUBMITTED", attestable: false };
  if (!isSuccessful(transaction) || transaction.txExecutionResultName !== "FINISHED_WITH_RETURN" || ((transaction as GenLayerTransaction & { result_name?: string }).result_name !== undefined && (transaction as GenLayerTransaction & { result_name?: string }).result_name !== "MAJORITY_AGREE")) return { lifecycle: "FAILED", attestable: false };
  // Studio Dev currently does not expose gen_dbg_traceTransaction. A missing
  // trace is not a failed contract execution: the finalized LATEST_FINAL
  // assessment is the authoritative decision. If a trace is available, it is
  // decoded and cross-checked below; malformed available traces fail closed.
  if (!trace) return { lifecycle: "FINALIZED", attestable: true, traceDecisionVerified: false };
  if (trace.result_code !== 1 || trace.stderr.length !== 0) return { lifecycle: "FAILED", attestable: false };
  const decoded = genlayerAbi.calldata.decode(hexToBytes(trace.return_data as Hex));
  if (decoded !== "APPROVED" && decoded !== "NEEDS_REVISION" && decoded !== "REJECTED") return { lifecycle: "FAILED", attestable: false };
  return { lifecycle: "FINALIZED", decision: decoded, attestable: true, traceDecisionVerified: true };
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
  let trace: DebugTraceResult | undefined;
  try { trace = await client.debugTraceTransaction({ hash: state.txId }); } catch { /* Studio Dev RC may not expose debug trace RPC. */ }
  const base = classifyAdmissibility(transaction, trace);
  if (!client.readAssessment) throw new Error("admissibility finalized readback is not configured");
  const readback = parseAssessment(await client.readAssessment({ address: transaction.recipient as Address, proposalId }));
  if (base.lifecycle !== "FINALIZED" || !base.attestable) throw new Error("admissibility finalized execution did not pass verification");
  if (base.decision && base.decision !== readback.decision) throw new Error("admissibility trace/readback decision mismatch");
  const observation = { ...base, decision: readback.decision, issues: readback.issues };
  await store.persistObservation(operationId, observation);
  return { txId: state.txId, ...observation };
}
