import { abi as genlayerAbi, isSuccessful } from "genlayer-js";
import type { DebugTraceResult, GenLayerTransaction, TransactionHash } from "genlayer-js/types";
import { hexToBytes, type Address, type Hex } from "viem";

export type TerminalOutcome = "YES" | "NO" | "VOID";

export interface ResolutionAttemptState {
  idempotencyKey: string;
  resolver: Address;
  genlayerTxId?: TransactionHash;
  submittedAt?: string;
  lifecycle: "READY" | "SUBMITTED" | "ACCEPTED" | "FINALIZED" | "FAILED";
  executionStatus?: string;
  outcome?: TerminalOutcome;
}

export interface AttemptStore {
  load(idempotencyKey: string): Promise<ResolutionAttemptState | null>;
  createIfAbsent(state: ResolutionAttemptState): Promise<ResolutionAttemptState>;
  /** Atomically changes READY -> SUBMITTING. Implementations must do this in durable storage. */
  claimSubmission?: (idempotencyKey: string) => Promise<boolean>;
  persistSubmission(idempotencyKey: string, txId: TransactionHash, submittedAt: string): Promise<void>;
  persistObservation(idempotencyKey: string, patch: Partial<ResolutionAttemptState>): Promise<void>;
}

export interface ResolutionClient {
  writeContract(args: { address: Address; functionName: string; args: readonly unknown[] }): Promise<unknown>;
  getTransaction(args: { hash: TransactionHash }): Promise<GenLayerTransaction>;
  debugTraceTransaction(args: { hash: TransactionHash }): Promise<DebugTraceResult>;
}

export interface ResolutionSubmission {
  idempotencyKey: string;
  resolver: Address;
  marketId: string;
  attempt: number;
}

export function resolutionIdempotencyKey(marketId: string, attempt: number): string {
  if (!marketId || !Number.isInteger(attempt) || attempt < 0) throw new Error("invalid resolution identity");
  return `resolution:${marketId}:attempt:${attempt}`;
}

function transactionHash(value: unknown): TransactionHash {
  const candidate = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? ((value as { txId?: unknown; hash?: unknown; transaction_hash?: unknown }).txId
        ?? (value as { hash?: unknown }).hash
        ?? (value as { transaction_hash?: unknown }).transaction_hash)
      : undefined;
  if (typeof candidate !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(candidate)) {
    throw new Error("GenLayer submission did not return a transaction ID");
  }
  return candidate as TransactionHash;
}

export async function submitOnce(
  client: ResolutionClient,
  store: AttemptStore,
  submission: ResolutionSubmission,
  now: () => Date = () => new Date(),
): Promise<TransactionHash> {
  const state = await store.createIfAbsent({
    ...submission,
    lifecycle: "READY",
  });
  if (state.genlayerTxId) return state.genlayerTxId;

  // A durable claim closes the only safe coordination boundary before an
  // external submission. Stores backed by WorkflowState implement this as a
  // conditional UPDATE; an in-memory fallback is retained for existing local
  // adapters, but is never the production coordination primitive.
  if (store.claimSubmission && !(await store.claimSubmission(submission.idempotencyKey))) {
    const concurrent = await store.load(submission.idempotencyKey);
    if (concurrent?.genlayerTxId) return concurrent.genlayerTxId;
    throw new Error("resolution submission is already owned by another worker");
  }

  const submitted = await client.writeContract({
    address: submission.resolver,
    functionName: "resolve",
    args: [submission.marketId, BigInt(submission.attempt)],
  });
  const txId = transactionHash(submitted);
  // This write is deliberately the first awaited operation after submission.
  // A retry always loads this ID and follows the same transaction.
  await store.persistSubmission(submission.idempotencyKey, txId, now().toISOString());
  return txId;
}

export function decodeTerminalOutcome(returnData: Hex): TerminalOutcome {
  const decoded = genlayerAbi.calldata.decode(hexToBytes(returnData));
  if (decoded === "YES" || decoded === "NO" || decoded === "VOID") return decoded;
  throw new Error("finalized resolver returned a non-terminal result");
}

export function classifyFinality(
  transaction: GenLayerTransaction,
  trace?: DebugTraceResult,
): { lifecycle: ResolutionAttemptState["lifecycle"]; executionStatus?: string; outcome?: TerminalOutcome; attestable: boolean } {
  const lifecycle = transaction.lifecycle.state;
  if (lifecycle !== "finalized") {
    return {
      lifecycle: lifecycle === "decided" ? "ACCEPTED" : "SUBMITTED",
      executionStatus: transaction.txExecutionResultName,
      attestable: false,
    };
  }
  if (!isSuccessful(transaction) || transaction.txExecutionResultName !== "FINISHED_WITH_RETURN") {
    return { lifecycle: "FAILED", executionStatus: transaction.txExecutionResultName, attestable: false };
  }
  if (!trace || trace.result_code !== 1 || trace.stderr.length !== 0) {
    return { lifecycle: "FAILED", executionStatus: "TRACE_FAILED", attestable: false };
  }
  const outcome = decodeTerminalOutcome(trace.return_data as Hex);
  return { lifecycle: "FINALIZED", executionStatus: "FINISHED_WITH_RETURN", outcome, attestable: true };
}

export async function followPersistedTransaction(client: ResolutionClient, store: AttemptStore, idempotencyKey: string) {
  const state = await store.load(idempotencyKey);
  if (!state?.genlayerTxId) throw new Error("resolution transaction was not persisted");
  const transaction = await client.getTransaction({ hash: state.genlayerTxId });
  const trace = transaction.lifecycle.state === "finalized" && isSuccessful(transaction)
    ? await client.debugTraceTransaction({ hash: state.genlayerTxId })
    : undefined;
  const observation = classifyFinality(transaction, trace);
  await store.persistObservation(idempotencyKey, observation);
  return { txId: state.genlayerTxId, ...observation };
}
