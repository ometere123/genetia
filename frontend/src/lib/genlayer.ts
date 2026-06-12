/**
 * GenLayer relayer service (server-only).
 *
 * Uses the manifest-bound Genetia resolver flow:
 *   register_market(market_id, manifest_json, manifest_hash)
 *   resolve_market(market_id)
 *   get_resolution(market_id)
 */

import "server-only";

export type ResolutionOutcome = "YES" | "NO" | "VOID" | "UNRESOLVED" | "INVALID";

export type GenLayerVerdict = {
  market_id: string;
  manifest_hash: string;
  outcome: ResolutionOutcome;
  confidence: number;
  sources_checked: string[];
  evidence_summary: string[];
  reasoning: string;
  void_reason: string;
  unresolved_reason: string;
  resolved_at?: string;
  prompt_version?: string;
  attempt_id?: string;
};

export type GenLayerRegisteredMarket = {
  manifestJson: string;
  manifestHash: string;
};

export type GenLayerWriteStatus =
  | "SUCCESS"
  | "FAILED"
  | "UNDETERMINED"
  | "TIMEOUT";

export type GenLayerWriteResult = {
  hash: string;
  status: GenLayerWriteStatus;
  tx?: unknown;
  message?: string;
};

const GENLAYER_RPC =
  process.env.GENLAYER_RPC ?? process.env.GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api";
const CONTRACT_ADDRESS = (
  process.env.GENLAYER_CONTRACT_ADDRESS ??
  process.env.NEXT_PUBLIC_GENLAYER_RESOLVER_ADDRESS ??
  "0x7DE5e141bCD9c8c7f7Ab40396FF517859ec80172"
) as `0x${string}`;
const RELAYER_KEY = process.env.GENLAYER_RELAYER_PRIVATE_KEY ?? "";
const CHAIN_ID = Number(process.env.GENLAYER_CHAIN_ID ?? "61999");

function devStubEnabled(): boolean {
  return !CONTRACT_ADDRESS || !RELAYER_KEY;
}

function normaliseKey(): `0x${string}` {
  const trimmed = RELAYER_KEY.trim();
  const hexKey = (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hexKey)) {
    throw new Error(
      "GENLAYER_RELAYER_PRIVATE_KEY must be a 64-character hex string (with or without 0x prefix)",
    );
  }
  return hexKey;
}

function buildChain(studionet: {
  id: number;
  rpcUrls: { default: { http: string[] } };
}) {
  return {
    ...studionet,
    id: CHAIN_ID,
    rpcUrls: {
      ...studionet.rpcUrls,
      default: {
        ...studionet.rpcUrls.default,
        http: [GENLAYER_RPC],
      },
    },
  };
}

function buildWriteClient() {
  const { createAccount, createClient } = require("genlayer-js");
  const { studionet } = require("genlayer-js/chains");

  const chain = buildChain(studionet);
  const account = createAccount(normaliseKey());
  const client = createClient({
    chain,
    endpoint: GENLAYER_RPC,
    account,
  });

  return { client, account, chain };
}

function buildReadClient() {
  const { createClient } = require("genlayer-js");
  const { studionet } = require("genlayer-js/chains");
  const chain = buildChain(studionet);
  const client = createClient({ chain, endpoint: GENLAYER_RPC });
  return { client, chain };
}

function getLeaderReceipt(tx: any) {
  const receipts = tx?.consensus_data?.leader_receipt;
  if (Array.isArray(receipts)) {
    return receipts[0] ?? null;
  }
  return receipts ?? null;
}

function getExecutionResult(tx: any): string {
  const leader = getLeaderReceipt(tx);
  return String(leader?.execution_result ?? "").toUpperCase();
}

function getFailureMessage(tx: any): string {
  const leader = getLeaderReceipt(tx);
  const stderr = leader?.stderr;
  if (typeof stderr === "string" && stderr.trim()) {
    return stderr.trim().split(/\r?\n/).slice(-2).join("\n");
  }
  if (Array.isArray(stderr) && stderr.length) {
    return stderr.map(String).slice(-2).join("\n");
  }
  if (leader?.result && typeof leader.result === "object") {
    return JSON.stringify(leader.result);
  }
  if (leader?.genvm_result) {
    return String(leader.genvm_result);
  }
  if (tx?.txExecutionResultName) {
    return String(tx.txExecutionResultName);
  }
  return "No stderr available";
}

function isAcceptedExecution(tx: any): boolean {
  const execution = getExecutionResult(tx);
  return execution === "SUCCESS" || execution === "ACCEPTED";
}

function isUndeterminedExecution(tx: any): boolean {
  const execution = getExecutionResult(tx);
  const status = String(tx?.statusName ?? tx?.status ?? "").toUpperCase();
  return execution === "UNDETERMINED" || status === "UNDETERMINED";
}

async function waitForConfirmedWrite(
  functionName: string,
  args: unknown[],
): Promise<GenLayerWriteResult> {
  const { client, account } = buildWriteClient();

  const hash = await client.writeContract({
    account,
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value: 0n,
  });

  try {
    await client.waitForTransactionReceipt({
      hash,
      retries: 200,
      interval: 3000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GenLayer receipt wait timed out";
    return {
      hash: String(hash),
      status: "TIMEOUT",
      message,
    };
  }

  const tx = await client.getTransaction({ hash });
  if (isAcceptedExecution(tx)) {
    return {
      hash: String(hash),
      status: "SUCCESS",
      tx,
    };
  }

  if (isUndeterminedExecution(tx)) {
    return {
      hash: String(hash),
      status: "UNDETERMINED",
      tx,
      message: getFailureMessage(tx),
    };
  }

  return {
    hash: String(hash),
    status: "FAILED",
    tx,
    message: getFailureMessage(tx),
  };
}

async function readContract(functionName: string, args: unknown[]): Promise<unknown> {
  const { client } = buildReadClient();
  return client.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
  });
}

async function readContractWithFallback(functionNames: string[], args: unknown[]): Promise<unknown> {
  let lastError: unknown = null;
  for (const functionName of functionNames) {
    try {
      return await readContract(functionName, args);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("GenLayer read failed");
}

function parseVerdict(raw: unknown): GenLayerVerdict | null {
  const text = typeof raw === "string" ? raw : raw == null ? "null" : String(raw);
  if (!text || text === "null") {
    return null;
  }

  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const outcome = String((parsed as Record<string, unknown>).outcome ?? "").toUpperCase() as ResolutionOutcome;
  const allowed: ResolutionOutcome[] = ["YES", "NO", "VOID", "UNRESOLVED", "INVALID"];
  if (!allowed.includes(outcome)) {
    throw new Error(`Unsupported GenLayer outcome: ${String((parsed as Record<string, unknown>).outcome ?? "")}`);
  }

  return {
    market_id: String((parsed as Record<string, unknown>).market_id ?? ""),
    manifest_hash: String((parsed as Record<string, unknown>).manifest_hash ?? ""),
    outcome,
    confidence: Number((parsed as Record<string, unknown>).confidence ?? 0),
    sources_checked: Array.isArray((parsed as Record<string, unknown>).sources_checked)
      ? ((parsed as Record<string, unknown>).sources_checked as unknown[])
          .filter((value): value is string => typeof value === "string")
      : [],
    evidence_summary: Array.isArray((parsed as Record<string, unknown>).evidence_summary)
      ? ((parsed as Record<string, unknown>).evidence_summary as unknown[])
          .filter((value): value is string => typeof value === "string")
      : [],
    reasoning: String((parsed as Record<string, unknown>).reasoning ?? ""),
    void_reason: String((parsed as Record<string, unknown>).void_reason ?? ""),
    unresolved_reason: String((parsed as Record<string, unknown>).unresolved_reason ?? ""),
    resolved_at:
      typeof (parsed as Record<string, unknown>).resolved_at === "string"
        ? String((parsed as Record<string, unknown>).resolved_at)
        : undefined,
    prompt_version:
      typeof (parsed as Record<string, unknown>).prompt_version === "string"
        ? String((parsed as Record<string, unknown>).prompt_version)
        : undefined,
    attempt_id:
      typeof (parsed as Record<string, unknown>).attempt_id === "string"
        ? String((parsed as Record<string, unknown>).attempt_id)
        : undefined,
  };
}

export async function registerMarket(
  marketId: string,
  manifestJson: string,
  manifestHash: string,
): Promise<GenLayerWriteResult> {
  if (devStubEnabled()) {
    return {
      hash: `0xstub-register-${marketId.slice(0, 12)}-${Date.now().toString(16)}`,
      status: "SUCCESS",
    };
  }

  return waitForConfirmedWrite("register_market", [marketId, manifestJson, manifestHash]);
}

export async function resolveMarket(marketId: string): Promise<GenLayerWriteResult> {
  if (devStubEnabled()) {
    return {
      hash: `0xstub-resolve-${marketId.slice(0, 12)}-${Date.now().toString(16)}`,
      status: "SUCCESS",
    };
  }

  return waitForConfirmedWrite("resolve_market", [marketId]);
}

export async function getResolution(marketId: string): Promise<GenLayerVerdict | null> {
  if (devStubEnabled()) {
    return null;
  }

  try {
    const raw = await readContract("get_resolution", [marketId]);
    return parseVerdict(raw);
  } catch (error) {
    console.warn("[genlayer] get_resolution failed", error);
    return null;
  }
}

export async function getRegisteredMarket(marketId: string): Promise<GenLayerRegisteredMarket | null> {
  if (devStubEnabled()) {
    return null;
  }

  try {
    const [manifestRaw, manifestHashRaw] = await Promise.all([
      readContractWithFallback(["get_registered_market", "get_manifest"], [marketId]),
      readContract("get_manifest_hash", [marketId]).catch(() => ""),
    ]);

    const manifestJson =
      typeof manifestRaw === "string" ? manifestRaw : manifestRaw == null ? "null" : String(manifestRaw);
    if (!manifestJson || manifestJson === "null") {
      return null;
    }

    return {
      manifestJson,
      manifestHash: typeof manifestHashRaw === "string" ? manifestHashRaw : String(manifestHashRaw ?? ""),
    };
  } catch (error) {
    console.warn("[genlayer] getRegisteredMarket failed", error);
    return null;
  }
}

export async function isResolved(marketId: string): Promise<boolean> {
  if (devStubEnabled()) {
    return false;
  }

  try {
    const raw = await readContractWithFallback(["is_settlement_ready", "is_terminal", "is_resolved"], [marketId]);
    return Boolean(raw);
  } catch (error) {
    console.warn("[genlayer] isResolved failed", error);
    return false;
  }
}

export async function getResolutionStatus(marketId: string): Promise<string | null> {
  if (devStubEnabled()) {
    return null;
  }

  try {
    const raw = await readContract("get_status", [marketId]);
    return typeof raw === "string" ? raw : String(raw ?? "");
  } catch (error) {
    console.warn("[genlayer] get_status failed", error);
    return null;
  }
}

export const genlayerExplorerTxUrl = (txHash: string) =>
  `https://explorer-studio.genlayer.com/tx/${txHash}`;

export const genlayerExplorerAddressUrl = (address: string) =>
  `https://explorer-studio.genlayer.com/address/${address}`;
