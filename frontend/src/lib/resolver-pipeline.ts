/**
 * Canonical market resolution pipeline (server-only) for the LMSR / Arc stack.
 *
 * Arc handles trading, collateral, finality, and redemption. GenLayer handles
 * evidence-based outcome resolution via a manifest-bound resolver contract.
 */

import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  getRegisteredMarket,
  getResolution,
  getResolutionStatus,
  registerMarket,
  resolveMarket,
  type GenLayerVerdict,
  type ResolutionOutcome,
} from "@/lib/genlayer";
import {
  buildResolutionManifest,
  canonicalStringify,
  extractTrustedSources,
  hashResolutionManifestString,
  type ManifestMarketInput,
} from "@/lib/resolution-manifest";
import { LMSR_MARKET_ABI, OUTCOME } from "@/lib/lmsr-abi";

// Structured log helper — each line is JSON for easy grep / log-drain parsing.
function rlog(step: string, data: Record<string, unknown>): void {
  console.log(
    `[resolver:${step}]`,
    JSON.stringify({ ...data, ts: new Date().toISOString() }),
  );
}

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
const ARC_RESOLVER_KEY = process.env.ARC_RESOLVER_PRIVATE_KEY ?? "";
const EXPECTED_GENLAYER_CONTRACT =
  process.env.GENLAYER_CONTRACT_ADDRESS ??
  process.env.NEXT_PUBLIC_GENLAYER_RESOLVER_ADDRESS ??
  "0x7DE5e141bCD9c8c7f7Ab40396FF517859ec80172";
const PUBLIC_GENLAYER_CONTRACT = process.env.NEXT_PUBLIC_GENLAYER_RESOLVER_ADDRESS ?? "";
const SUBMITTED_BY =
  process.env.ARC_RESOLVER_ADDRESS ??
  process.env.NEXT_PUBLIC_ARC_RESOLVER_ADDRESS ??
  "trusted-relayer-app";

export type ResolverOutcome = ResolutionOutcome;

export type ResolutionAttemptStatus =
  | "READY_TO_RESOLVE"
  | "REGISTERING_MANIFEST"
  | "MANIFEST_REGISTERED"
  | "RESOLUTION_TX_SUBMITTED"
  | "WAITING_FOR_GENLAYER_FINALITY"
  | "GENLAYER_FINALIZED"
  | "READING_RESOLUTION"
  | "MANIFEST_MISMATCH"
  | "RESOLUTION_ACCEPTED"
  | "UNRESOLVED_RETRY_LATER"
  | "INVALID_NEEDS_RETRY"
  | "SETTLEMENT_READY"
  | "VOID_BLOCKED_NO_REFUND_PATH"
  | "SETTLED_ON_ARC"
  | "GENLAYER_FAILED"
  | "GENLAYER_TIMEOUT"
  | "GENLAYER_UNDETERMINED"
  | "FAILED";

type SettlementMeta = {
  trustedSources: string[];
  manifestJson?: string;
  manifestHash?: string;
  registerTxHash?: string;
  resolveTxHash?: string;
  resolutionStatus?: string | null;
  lastOutcome?: string | null;
  lastError?: string | null;
  attemptStatus?: ResolutionAttemptStatus;
};

export type ResolverAttestation = {
  marketId: string;
  genLayerContract: string;
  genLayerVerdictId?: string;
  proposedOutcome: ResolverOutcome;
  confidence?: number;
  manifestHash: string;
  evidenceHash?: string;
  evidenceUrls?: string[];
  reasoningSummary?: string;
  submittedBy: string;
  submittedAt: string;
  arcTxHash?: string;
  status: "validated" | "submitted" | "rejected" | "failed";
};

export type ResolverPipelineStep =
  | { type: "pending"; marketId: string; reason: string }
  | { type: "valid_verdict"; marketId: string; attestation: ResolverAttestation }
  | { type: "invalid_verdict"; marketId: string; reason: string; attestation?: ResolverAttestation }
  | { type: "proposed_settlement"; marketId: string; attestation: ResolverAttestation }
  | { type: "failed_proposal"; marketId: string; reason: string; attestation?: ResolverAttestation }
  | { type: "already_resolved"; marketId: string; reason: string }
  | { type: "challenge_window_active"; marketId: string; reason: string }
  | { type: "settlement_finalised"; marketId: string; reason: string };

export interface TickResult {
  scanned: number;
  submittedToGenlayer: number;
  proposedOnArc: number;
  invalidatedOnArc: number;
  errors: { marketId: string; error: string }[];
  steps: ResolverPipelineStep[];
}

async function loadInFlightSettlements() {
  return prisma.settlement.findMany({
    where: {
      status: {
        in: ["pending_resolve", "resolving", "retry_later"],
      },
    },
    include: {
      market: {
        select: {
          id: true,
          title: true,
          resolutionCriteria: true,
          resolutionSource: true,
          arcAddress: true,
          status: true,
          expiry: true,
          lmsrStatus: true,
          proposedOutcome: true,
          pendingSince: true,
        },
      },
    },
  });
}

type InFlightSettlement = Awaited<ReturnType<typeof loadInFlightSettlements>>[number];

type ResolutionValidationResult =
  | { ok: true; attestation: ResolverAttestation }
  | { ok: false; reason: string; code?: ResolutionAttemptStatus };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSettlementMeta(value: unknown): SettlementMeta {
  if (Array.isArray(value)) {
    return { trustedSources: value.filter((item): item is string => typeof item === "string") };
  }
  if (!isObject(value)) {
    return { trustedSources: [] };
  }
  const trustedSources = Array.isArray(value.trustedSources)
    ? value.trustedSources.filter((item): item is string => typeof item === "string")
    : [];

  return {
    trustedSources,
    manifestJson: typeof value.manifestJson === "string" ? value.manifestJson : undefined,
    manifestHash: typeof value.manifestHash === "string" ? value.manifestHash : undefined,
    registerTxHash: typeof value.registerTxHash === "string" ? value.registerTxHash : undefined,
    resolveTxHash: typeof value.resolveTxHash === "string" ? value.resolveTxHash : undefined,
    resolutionStatus: typeof value.resolutionStatus === "string" ? value.resolutionStatus : null,
    lastOutcome: typeof value.lastOutcome === "string" ? value.lastOutcome : null,
    lastError: typeof value.lastError === "string" ? value.lastError : null,
    attemptStatus:
      typeof value.attemptStatus === "string" ? (value.attemptStatus as ResolutionAttemptStatus) : undefined,
  };
}

function mergeMeta(
  base: SettlementMeta,
  patch: Partial<SettlementMeta>,
): SettlementMeta {
  return {
    ...base,
    ...patch,
    trustedSources: patch.trustedSources ?? base.trustedSources,
  };
}

function marketToManifestInput(market: InFlightSettlement["market"]): ManifestMarketInput {
  return {
    id: market.id,
    title: market.title,
    expiry: market.expiry,
    arcAddress: market.arcAddress,
    resolutionCriteria: market.resolutionCriteria,
    resolutionSource: market.resolutionSource,
  };
}

function classifyWriteFailure(status: string): ResolutionAttemptStatus {
  if (status === "TIMEOUT") {
    return "GENLAYER_TIMEOUT";
  }
  if (status === "UNDETERMINED") {
    return "GENLAYER_UNDETERMINED";
  }
  return "GENLAYER_FAILED";
}

async function updateSettlementState(args: {
  marketId: string;
  status: string;
  meta: SettlementMeta;
  resolution?: string | null;
  reasoning?: string | null;
  confidence?: number | null;
  genlayerTxHash?: string | null;
  arcTxHash?: string | null;
  submittedAt?: Date | null;
  finalizedAt?: Date | null;
  arcResolvedAt?: Date | null;
}) {
  await prisma.settlement.update({
    where: { marketId: args.marketId },
    data: {
      status: args.status,
      resolution: args.resolution === undefined ? undefined : args.resolution,
      reasoning: args.reasoning === undefined ? undefined : args.reasoning,
      confidence:
        args.confidence === undefined
          ? undefined
          : args.confidence === null
            ? null
            : args.confidence / 100,
      sources: args.meta,
      genlayerTxHash: args.genlayerTxHash === undefined ? undefined : args.genlayerTxHash,
      arcTxHash: args.arcTxHash === undefined ? undefined : args.arcTxHash,
      submittedAt: args.submittedAt === undefined ? undefined : args.submittedAt,
      finalizedAt: args.finalizedAt === undefined ? undefined : args.finalizedAt,
      arcResolvedAt: args.arcResolvedAt === undefined ? undefined : args.arcResolvedAt,
    },
  });
}

async function markFailed(
  marketId: string,
  reason: string,
  meta: SettlementMeta,
  attemptStatus: ResolutionAttemptStatus = "FAILED",
): Promise<void> {
  console.error("[resolver] failed", { marketId, reason, attemptStatus });
  await updateSettlementState({
    marketId,
    status: "failed",
    meta: mergeMeta(meta, {
      attemptStatus,
      lastError: reason,
    }),
    reasoning: reason,
  });
}

export async function runResolverTick(): Promise<TickResult> {
  const now = new Date();
  const result: TickResult = {
    scanned: 0,
    submittedToGenlayer: 0,
    proposedOnArc: 0,
    invalidatedOnArc: 0,
    errors: [],
    steps: [],
  };

  const expiredActiveMarkets = await prisma.market.findMany({
    where: {
      status: "active",
      expiry: { lt: now },
      settlement: { is: null },
    },
    select: {
      id: true,
      title: true,
      resolutionCriteria: true,
      resolutionSource: true,
      arcAddress: true,
      expiry: true,
    },
  });

  const inFlightSettlements = await loadInFlightSettlements();
  result.scanned = expiredActiveMarkets.length + inFlightSettlements.length;

  for (const market of expiredActiveMarkets) {
    try {
      const trustedSources = extractTrustedSources(market.resolutionSource);
      await prisma.settlement.create({
        data: {
          marketId: market.id,
          status: "pending_resolve",
          sources: {
            trustedSources,
            attemptStatus: "READY_TO_RESOLVE",
          },
        },
      });
      result.steps.push({
        type: "pending",
        marketId: market.id,
        reason: "expired market queued for manifest-bound GenLayer resolution",
      });
    } catch (err) {
      const error = `seed settlement: ${(err as Error).message}`;
      result.errors.push({ marketId: market.id, error });
      result.steps.push({ type: "failed_proposal", marketId: market.id, reason: error });
    }
  }

  for (const settlement of inFlightSettlements) {
    const step = await advanceSettlement(settlement, result);
    result.steps.push(step);
  }

  return result;
}

async function advanceSettlement(
  settlement: InFlightSettlement,
  result: TickResult,
): Promise<ResolverPipelineStep> {
  const meta = parseSettlementMeta(settlement.sources);

  try {
    const market = settlement.market;
    if (!market) {
      throw new Error("settlement has no market relation");
    }

    if (market.status === "resolved" || market.lmsrStatus === "Finalized") {
      return {
        type: "settlement_finalised",
        marketId: settlement.marketId,
        reason: "market is already finalized on Arc/indexer",
      };
    }

    if (market.lmsrStatus === "Pending" || market.lmsrStatus === "Disputed") {
      return {
        type: "challenge_window_active",
        marketId: settlement.marketId,
        reason: `market is already ${market.lmsrStatus}; waiting for challenge/finalization flow`,
      };
    }

    if (settlement.arcTxHash) {
      return {
        type: "already_resolved",
        marketId: settlement.marketId,
        reason: "settlement already has an Arc transaction hash",
      };
    }

    const configValidation = validateGenLayerConfig();
    if (!configValidation.ok) {
      await markFailed(settlement.marketId, configValidation.reason, meta);
      return { type: "invalid_verdict", marketId: settlement.marketId, reason: configValidation.reason };
    }

    const manifest = buildResolutionManifest(marketToManifestInput(market));
    const manifestJson = canonicalStringify(manifest);
    const manifestHash = hashResolutionManifestString(manifestJson);
    rlog("manifest-built", {
      marketId: settlement.marketId,
      manifestHash,
      sourcesCount: manifest.trusted_sources.length,
      trustedSources: manifest.trusted_sources,
    });
    const trustedSources =
      meta.trustedSources.length > 0 ? meta.trustedSources : manifest.trusted_sources;
    const workingMeta = mergeMeta(meta, {
      trustedSources,
      manifestJson,
      manifestHash,
    });

    const registration = await ensureManifestRegistration(
      settlement.marketId,
      manifestJson,
      manifestHash,
      workingMeta,
    );
    if (!registration.ok) {
      return {
        type: "invalid_verdict",
        marketId: settlement.marketId,
        reason: registration.reason,
      };
    }

    let currentMeta = registration.meta;

    await updateSettlementState({
      marketId: settlement.marketId,
      status: "resolving",
      meta: mergeMeta(currentMeta, { attemptStatus: "WAITING_FOR_GENLAYER_FINALITY" }),
    });

    rlog("resolve-tx-submitting", { marketId: settlement.marketId });
    const resolveResult = await resolveMarket(settlement.marketId);
    rlog("resolve-tx-result", {
      marketId: settlement.marketId,
      txHash: resolveResult.hash,
      status: resolveResult.status,
    });
    if (resolveResult.status !== "SUCCESS") {
      const attemptStatus = classifyWriteFailure(resolveResult.status);
      const reason = resolveResult.message ?? `GenLayer resolve tx ${resolveResult.status.toLowerCase()}`;
      await markFailed(
        settlement.marketId,
        reason,
        mergeMeta(currentMeta, { resolveTxHash: resolveResult.hash }),
        attemptStatus,
      );
      return { type: "failed_proposal", marketId: settlement.marketId, reason };
    }

    currentMeta = mergeMeta(currentMeta, {
      attemptStatus: "GENLAYER_FINALIZED",
      resolveTxHash: resolveResult.hash,
    });
    await updateSettlementState({
      marketId: settlement.marketId,
      status: "resolving",
      meta: currentMeta,
      genlayerTxHash: resolveResult.hash,
      submittedAt: new Date(),
    });
    result.submittedToGenlayer++;

    await updateSettlementState({
      marketId: settlement.marketId,
      status: "resolving",
      meta: mergeMeta(currentMeta, { attemptStatus: "READING_RESOLUTION" }),
    });

    const resolutionStatus = await getResolutionStatus(settlement.marketId);
    const verdict = await getResolution(settlement.marketId);
    rlog("verdict-read", {
      marketId: settlement.marketId,
      resolutionStatus,
      hasVerdict: !!verdict,
      outcome: verdict?.outcome ?? null,
      confidence: verdict?.confidence ?? null,
      verdictManifestHash: verdict?.manifest_hash ?? null,
    });
    if (!verdict) {
      const reason = "GenLayer resolution payload not yet readable after finalized tx";
      await markFailed(
        settlement.marketId,
        reason,
        mergeMeta(currentMeta, { resolutionStatus }),
      );
      return { type: "failed_proposal", marketId: settlement.marketId, reason };
    }

    const validation = validateResolution({
      settlement,
      verdict,
      expectedManifestHash: manifestHash,
      evidenceUrls: trustedSources,
    });

    rlog("hash-check", {
      marketId: settlement.marketId,
      expected: manifestHash,
      got: verdict.manifest_hash,
      match: validation.ok,
      reason: validation.ok ? null : (validation as { reason: string }).reason,
    });
    if (!validation.ok) {
      const attemptStatus = validation.code ?? "FAILED";
      const nextStatus = attemptStatus === "MANIFEST_MISMATCH" ? "manifest_mismatch" : "failed";
      await updateSettlementState({
        marketId: settlement.marketId,
        status: nextStatus,
        meta: mergeMeta(currentMeta, {
          attemptStatus,
          resolutionStatus,
          lastOutcome: verdict.outcome,
          lastError: validation.reason,
        }),
        resolution: verdict.outcome,
        reasoning: validation.reason,
        confidence: verdict.confidence,
        finalizedAt: new Date(),
      });
      return {
        type: "invalid_verdict",
        marketId: settlement.marketId,
        reason: validation.reason,
      };
    }

    const attestation = validation.attestation;
    currentMeta = mergeMeta(currentMeta, {
      attemptStatus: "RESOLUTION_ACCEPTED",
      resolutionStatus,
      lastOutcome: attestation.proposedOutcome,
      lastError: null,
    });

    await updateSettlementState({
      marketId: settlement.marketId,
      status: "resolving",
      meta: currentMeta,
      resolution: attestation.proposedOutcome,
      reasoning: attestation.reasoningSummary,
      confidence: attestation.confidence,
      finalizedAt: new Date(),
    });

    rlog("outcome-branch", {
      marketId: settlement.marketId,
      outcome: attestation.proposedOutcome,
      confidence: attestation.confidence,
      manifestHash: attestation.manifestHash,
    });

    if (attestation.proposedOutcome === "UNRESOLVED") {
      await updateSettlementState({
        marketId: settlement.marketId,
        status: "retry_later",
        meta: mergeMeta(currentMeta, { attemptStatus: "UNRESOLVED_RETRY_LATER" }),
        resolution: "UNRESOLVED",
        reasoning: attestation.reasoningSummary ?? verdict.unresolved_reason,
        confidence: attestation.confidence,
        finalizedAt: new Date(),
      });
      return {
        type: "pending",
        marketId: settlement.marketId,
        reason: verdict.unresolved_reason || "GenLayer returned UNRESOLVED; retry later",
      };
    }

    if (attestation.proposedOutcome === "INVALID") {
      await updateSettlementState({
        marketId: settlement.marketId,
        status: "retry_later",
        meta: mergeMeta(currentMeta, { attemptStatus: "INVALID_NEEDS_RETRY" }),
        resolution: "INVALID",
        reasoning: attestation.reasoningSummary ?? "GenLayer returned INVALID",
        confidence: attestation.confidence,
        finalizedAt: new Date(),
      });
      return {
        type: "pending",
        marketId: settlement.marketId,
        reason: attestation.reasoningSummary ?? "GenLayer returned INVALID; retry required",
      };
    }

    if (attestation.proposedOutcome === "VOID") {
      await updateSettlementState({
        marketId: settlement.marketId,
        status: "blocked",
        meta: mergeMeta(currentMeta, { attemptStatus: "VOID_BLOCKED_NO_REFUND_PATH" }),
        resolution: "VOID",
        reasoning:
          "VOID outcome returned; Arc refund/void settlement is not wired yet.",
        confidence: attestation.confidence,
        finalizedAt: new Date(),
      });
      return {
        type: "invalid_verdict",
        marketId: settlement.marketId,
        reason: "VOID outcome returned; Arc refund/void settlement is not wired yet.",
        attestation,
      };
    }

    await updateSettlementState({
      marketId: settlement.marketId,
      status: "resolving",
      meta: mergeMeta(currentMeta, { attemptStatus: "SETTLEMENT_READY" }),
      resolution: attestation.proposedOutcome,
      reasoning: attestation.reasoningSummary,
      confidence: attestation.confidence,
      finalizedAt: new Date(),
    });

    const onChainOutcome =
      attestation.proposedOutcome === "YES" ? OUTCOME.YES : OUTCOME.NO;
    const arcTxHash = await proposeResolutionOnArc(
      market.arcAddress as `0x${string}`,
      onChainOutcome,
    );
    rlog("arc-settled", {
      marketId: settlement.marketId,
      outcome: attestation.proposedOutcome,
      onChainOutcomeEnum: onChainOutcome,
      arcTxHash,
      manifestHash: attestation.manifestHash,
    });
    const submitted = { ...attestation, arcTxHash, status: "submitted" as const };

    await updateSettlementState({
      marketId: settlement.marketId,
      status: "proposed_on_arc",
      meta: mergeMeta(currentMeta, { attemptStatus: "SETTLED_ON_ARC" }),
      resolution: attestation.proposedOutcome,
      reasoning: attestation.reasoningSummary,
      confidence: attestation.confidence,
      arcTxHash,
      arcResolvedAt: new Date(),
    });

    result.proposedOnArc++;
    return {
      type: "proposed_settlement",
      marketId: settlement.marketId,
      attestation: submitted,
    };
  } catch (err) {
    const message = (err as Error).message;
    result.errors.push({ marketId: settlement.marketId, error: message });
    await markFailed(settlement.marketId, message, meta).catch(() => undefined);
    return { type: "failed_proposal", marketId: settlement.marketId, reason: message };
  }
}

async function ensureManifestRegistration(
  marketId: string,
  manifestJson: string,
  manifestHash: string,
  meta: SettlementMeta,
): Promise<{ ok: true; meta: SettlementMeta } | { ok: false; reason: string }> {
  await updateSettlementState({
    marketId,
    status: "resolving",
    meta: mergeMeta(meta, { attemptStatus: "REGISTERING_MANIFEST" }),
  });

  const registered = await getRegisteredMarket(marketId);
  if (registered) {
    if (registered.manifestHash && registered.manifestHash !== manifestHash) {
      await updateSettlementState({
        marketId,
        status: "manifest_mismatch",
        meta: mergeMeta(meta, {
          attemptStatus: "MANIFEST_MISMATCH",
          lastError: "Existing GenLayer manifest hash does not match expected manifest hash",
        }),
        reasoning: "Existing GenLayer manifest hash does not match expected manifest hash",
      });
      return {
        ok: false,
        reason: "Existing GenLayer manifest hash does not match expected manifest hash",
      };
    }

    const nextMeta = mergeMeta(meta, {
      manifestJson: registered.manifestJson,
      manifestHash: registered.manifestHash || manifestHash,
      attemptStatus: "MANIFEST_REGISTERED",
    });
    await updateSettlementState({
      marketId,
      status: "resolving",
      meta: nextMeta,
    });
    return { ok: true, meta: nextMeta };
  }

  rlog("manifest-registering", { marketId, manifestHash });
  const registration = await registerMarket(marketId, manifestJson, manifestHash);
  rlog("manifest-register-result", {
    marketId,
    txHash: registration.hash,
    status: registration.status,
  });
  if (registration.status !== "SUCCESS") {
    const reason = registration.message ?? `GenLayer register tx ${registration.status.toLowerCase()}`;
    const alreadyRegistered = /market already registered/i.test(reason);
    if (alreadyRegistered) {
      const afterConflict = await getRegisteredMarket(marketId);
      if (afterConflict?.manifestHash === manifestHash) {
        const nextMeta = mergeMeta(meta, {
          manifestJson: afterConflict.manifestJson,
          manifestHash: afterConflict.manifestHash,
          registerTxHash: registration.hash,
          attemptStatus: "MANIFEST_REGISTERED",
        });
        await updateSettlementState({
          marketId,
          status: "resolving",
          meta: nextMeta,
        });
        return { ok: true, meta: nextMeta };
      }
    }

    await markFailed(
      marketId,
      reason,
      mergeMeta(meta, { registerTxHash: registration.hash }),
      classifyWriteFailure(registration.status),
    );
    return { ok: false, reason };
  }

  const nextMeta = mergeMeta(meta, {
    registerTxHash: registration.hash,
    attemptStatus: "MANIFEST_REGISTERED",
  });
  await updateSettlementState({
    marketId,
    status: "resolving",
    meta: nextMeta,
  });
  return { ok: true, meta: nextMeta };
}

async function proposeResolutionOnArc(
  marketAddress: `0x${string}`,
  outcome: number,
): Promise<string> {
  if (!ARC_RESOLVER_KEY) {
    throw new Error("ARC_RESOLVER_PRIVATE_KEY is required to propose settlement on Arc");
  }
  return arcWriteContract({
    privateKey: ARC_RESOLVER_KEY,
    address: marketAddress,
    functionName: "proposeResolution",
    args: [outcome],
  });
}

async function arcWriteContract(opts: {
  privateKey: string;
  address: `0x${string}`;
  functionName: "proposeResolution";
  args: unknown[];
}): Promise<string> {
  const { createWalletClient, createPublicClient, http } = require("viem");
  const { privateKeyToAccount } = require("viem/accounts");

  const chain = {
    id: ARC_CHAIN_ID,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [ARC_RPC] } },
  } as const;

  const key = opts.privateKey.startsWith("0x") ? opts.privateKey : `0x${opts.privateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);
  const wallet = createWalletClient({ account, chain, transport: http(ARC_RPC) });
  const pub = createPublicClient({ chain, transport: http(ARC_RPC) });

  const statusU = await pub.readContract({
    address: opts.address,
    abi: LMSR_MARKET_ABI,
    functionName: "status",
  });
  const status = Number(statusU);
  if (status === 3) {
    throw new Error("Arc market is already finalized");
  }
  if (status !== 0) {
    throw new Error(`Arc market is not Active; current status enum=${status}`);
  }

  const hash: string = await wallet.writeContract({
    address: opts.address,
    abi: LMSR_MARKET_ABI,
    functionName: opts.functionName,
    args: opts.args,
  });
  return hash;
}

function validateResolution(args: {
  settlement: InFlightSettlement;
  verdict: GenLayerVerdict;
  expectedManifestHash: string;
  evidenceUrls: string[];
}): ResolutionValidationResult {
  const { settlement, verdict, expectedManifestHash, evidenceUrls } = args;
  const market = settlement.market;

  if (!market?.id || market.id !== settlement.marketId) {
    return { ok: false, reason: "resolution market id does not match settlement market id", code: "FAILED" };
  }
  if (!market.arcAddress || !/^0x[a-fA-F0-9]{40}$/.test(market.arcAddress)) {
    return { ok: false, reason: "market has no valid Arc contract address", code: "FAILED" };
  }
  if (market.status !== "active") {
    return { ok: false, reason: `market status is ${market.status}, not active`, code: "FAILED" };
  }
  if (market.lmsrStatus && market.lmsrStatus !== "Active") {
    return { ok: false, reason: `Arc market is ${market.lmsrStatus}, not Active`, code: "FAILED" };
  }
  if (settlement.arcTxHash) {
    return { ok: false, reason: "resolution already submitted to Arc for this market", code: "FAILED" };
  }
  if (verdict.market_id !== settlement.marketId) {
    return { ok: false, reason: "resolution.market_id mismatch", code: "FAILED" };
  }
  if (verdict.manifest_hash !== expectedManifestHash) {
    return { ok: false, reason: "resolution.manifest_hash does not match expected manifest hash", code: "MANIFEST_MISMATCH" };
  }
  if (!Number.isFinite(verdict.confidence) || verdict.confidence < 0 || verdict.confidence > 100) {
    return { ok: false, reason: "resolution confidence must be between 0 and 100", code: "FAILED" };
  }

  const allowed: ResolverOutcome[] = ["YES", "NO", "VOID", "UNRESOLVED", "INVALID"];
  if (!allowed.includes(verdict.outcome)) {
    return { ok: false, reason: `unsupported GenLayer outcome payload: ${verdict.outcome}`, code: "FAILED" };
  }

  const reasoning = verdict.reasoning.trim();
  if ((verdict.outcome === "YES" || verdict.outcome === "NO" || verdict.outcome === "VOID") && !reasoning) {
    return { ok: false, reason: "resolution reasoning is required", code: "FAILED" };
  }
  if (verdict.outcome === "VOID" && !verdict.void_reason.trim()) {
    return { ok: false, reason: "resolution void_reason is required for VOID outcome", code: "FAILED" };
  }
  if (verdict.outcome === "UNRESOLVED" && !verdict.unresolved_reason.trim()) {
    return { ok: false, reason: "resolution unresolved_reason is required for UNRESOLVED outcome", code: "FAILED" };
  }

  return {
    ok: true,
    attestation: {
      marketId: settlement.marketId,
      genLayerContract: EXPECTED_GENLAYER_CONTRACT,
      genLayerVerdictId: settlement.genlayerTxHash ?? undefined,
      proposedOutcome: verdict.outcome,
      confidence: verdict.confidence,
      manifestHash: expectedManifestHash,
      evidenceHash: evidenceHash(evidenceUrls),
      evidenceUrls,
      reasoningSummary:
        reasoning ||
        verdict.void_reason.trim() ||
        verdict.unresolved_reason.trim() ||
        "GenLayer returned a validated resolution payload.",
      submittedBy: SUBMITTED_BY,
      submittedAt: new Date().toISOString(),
      status: "validated",
    },
  };
}

function validateGenLayerConfig(): { ok: true } | { ok: false; reason: string } {
  if (!EXPECTED_GENLAYER_CONTRACT || !/^0x[a-fA-F0-9]{40}$/.test(EXPECTED_GENLAYER_CONTRACT)) {
    return { ok: false, reason: "GENLAYER_CONTRACT_ADDRESS is required and must be a valid address" };
  }
  if (
    PUBLIC_GENLAYER_CONTRACT &&
    PUBLIC_GENLAYER_CONTRACT.toLowerCase() !== EXPECTED_GENLAYER_CONTRACT.toLowerCase()
  ) {
    return {
      ok: false,
      reason: "GENLAYER_CONTRACT_ADDRESS and NEXT_PUBLIC_GENLAYER_RESOLVER_ADDRESS do not match",
    };
  }
  if (!process.env.GENLAYER_RELAYER_PRIVATE_KEY) {
    return { ok: false, reason: "GENLAYER_RELAYER_PRIVATE_KEY is required for resolver submission" };
  }
  return { ok: true };
}

function evidenceHash(urls: string[]): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(urls.map((url) => url.trim()).sort()))
    .digest("hex")}`;
}
