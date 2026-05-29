/**
 * Canonical market resolution pipeline (server-only) for the LMSR / Arc stack.
 *
 * Arc handles trading, collateral, finality, and redemption. GenLayer handles
 * evidence-based outcome resolution. The bridge between them is currently a
 * trusted app/relayer pipeline, so every verdict is validated and logged as a
 * resolver attestation before the relayer proposes settlement on Arc.
 *
 * Triggered by:
 * - POST /api/cron/resolve-markets
 * - admin "Resolve now" action
 */

import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  submitResolveRequest,
  getResolution,
  type GenLayerVerdict,
} from "@/lib/genlayer";
import { LMSR_MARKET_ABI, OUTCOME } from "@/lib/lmsr-abi";

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
const ARC_RESOLVER_KEY = process.env.ARC_RESOLVER_PRIVATE_KEY ?? "";
const ARC_ADMIN_KEY = process.env.ARC_ADMIN_PRIVATE_KEY ?? "";
const EXPECTED_GENLAYER_CONTRACT =
  process.env.GENLAYER_CONTRACT_ADDRESS ??
  process.env.NEXT_PUBLIC_GENLAYER_RESOLVER_ADDRESS ??
  "";
const PUBLIC_GENLAYER_CONTRACT = process.env.NEXT_PUBLIC_GENLAYER_RESOLVER_ADDRESS ?? "";
const SUBMITTED_BY =
  process.env.ARC_RESOLVER_ADDRESS ??
  process.env.NEXT_PUBLIC_ARC_RESOLVER_ADDRESS ??
  "trusted-relayer-app";

export type ResolverOutcome = "YES" | "NO" | "INVALID";

export type ResolverAttestation = {
  marketId: string;
  genLayerContract: string;
  genLayerVerdictId?: string;
  proposedOutcome: ResolverOutcome;
  confidence?: number;
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
      status: { in: ["pending_resolve", "resolving"] },
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
    },
  });

  const inFlightSettlements = await loadInFlightSettlements();
  result.scanned = expiredActiveMarkets.length + inFlightSettlements.length;

  for (const market of expiredActiveMarkets) {
    try {
      const sources = extractSources(market.resolutionSource);
      await prisma.settlement.create({
        data: {
          marketId: market.id,
          status: "pending_resolve",
          sources,
        },
      });
      result.steps.push({
        type: "pending",
        marketId: market.id,
        reason: "expired market queued for GenLayer resolution",
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
  result: TickResult
): Promise<ResolverPipelineStep> {
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

    const sources = parseSources(settlement.sources) ?? extractSources(market.resolutionSource);
    const sourceValidation = validateEvidenceSources(sources);
    if (!sourceValidation.ok) {
      await markFailed(settlement.marketId, sourceValidation.reason);
      return { type: "invalid_verdict", marketId: settlement.marketId, reason: sourceValidation.reason };
    }

    const configValidation = validateGenLayerConfig();
    if (!configValidation.ok) {
      await markFailed(settlement.marketId, configValidation.reason);
      return { type: "invalid_verdict", marketId: settlement.marketId, reason: configValidation.reason };
    }

    if (settlement.status === "pending_resolve" || !settlement.genlayerTxHash) {
      const { txHash } = await submitResolveRequest({
        marketId: settlement.marketId,
        question: market.title,
        resolutionCriteria: market.resolutionCriteria ?? market.title,
        sources,
      });

      await prisma.settlement.update({
        where: { marketId: settlement.marketId },
        data: {
          status: "resolving",
          genlayerTxHash: txHash,
          submittedAt: new Date(),
          sources,
        },
      });

      result.submittedToGenlayer++;
      return {
        type: "pending",
        marketId: settlement.marketId,
        reason: `submitted to GenLayer: ${txHash}`,
      };
    }

    const verdict = await getResolution(settlement.marketId);
    if (!verdict) {
      return {
        type: "pending",
        marketId: settlement.marketId,
        reason: "GenLayer verdict not finalized yet",
      };
    }

    const validation = validateVerdict({
      settlement,
      verdict,
      evidenceUrls: sources,
    });

    if (!validation.ok) {
      await markFailed(settlement.marketId, validation.reason);
      console.error("[resolver] rejected verdict", {
        marketId: settlement.marketId,
        reason: validation.reason,
        verdict,
      });
      return {
        type: "invalid_verdict",
        marketId: settlement.marketId,
        reason: validation.reason,
      };
    }

    const attestation = validation.attestation;
    console.info("[resolver] validated attestation", attestation);

    if (attestation.proposedOutcome === "INVALID") {
      const arcTxHash = await adminResolveOnArc(
        market.arcAddress as `0x${string}`,
        OUTCOME.INVALID
      );
      const submitted = { ...attestation, arcTxHash, status: "submitted" as const };
      await prisma.settlement.update({
        where: { marketId: settlement.marketId },
        data: {
          status: "consensus_failure",
          resolution: null,
          reasoning: attestation.reasoningSummary ?? "GenLayer consensus failure",
          confidence: attestation.confidence,
          finalizedAt: new Date(),
          arcTxHash,
          arcResolvedAt: new Date(),
        },
      });
      result.invalidatedOnArc++;
      console.info("[resolver] submitted INVALID admin resolution", submitted);
      return {
        type: "proposed_settlement",
        marketId: settlement.marketId,
        attestation: submitted,
      };
    }

    const onChainOutcome =
      attestation.proposedOutcome === "YES" ? OUTCOME.YES : OUTCOME.NO;
    const arcTxHash = await proposeResolutionOnArc(
      market.arcAddress as `0x${string}`,
      onChainOutcome
    );
    const submitted = { ...attestation, arcTxHash, status: "submitted" as const };

    await prisma.settlement.update({
      where: { marketId: settlement.marketId },
      data: {
        status: "proposed_on_arc",
        resolution: attestation.proposedOutcome,
        reasoning: attestation.reasoningSummary,
        confidence: attestation.confidence,
        arcTxHash,
        arcResolvedAt: new Date(),
      },
    });

    result.proposedOnArc++;
    console.info("[resolver] proposed settlement on Arc", submitted);
    return {
      type: "proposed_settlement",
      marketId: settlement.marketId,
      attestation: submitted,
    };
  } catch (err) {
    const message = (err as Error).message;
    result.errors.push({ marketId: settlement.marketId, error: message });
    await markFailed(settlement.marketId, message).catch(() => undefined);
    return { type: "failed_proposal", marketId: settlement.marketId, reason: message };
  }
}

async function proposeResolutionOnArc(
  marketAddress: `0x${string}`,
  outcome: number
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

async function adminResolveOnArc(
  marketAddress: `0x${string}`,
  outcome: number
): Promise<string> {
  const key = ARC_ADMIN_KEY || ARC_RESOLVER_KEY;
  if (!key) {
    throw new Error("ARC_ADMIN_PRIVATE_KEY or ARC_RESOLVER_PRIVATE_KEY is required for INVALID admin resolution");
  }
  return arcWriteContract({
    privateKey: key,
    address: marketAddress,
    functionName: "adminResolve",
    args: [outcome],
  });
}

async function arcWriteContract(opts: {
  privateKey: string;
  address: `0x${string}`;
  functionName: "proposeResolution" | "adminResolve";
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
  if (status === 3) throw new Error("Arc market is already finalized");
  if (opts.functionName === "proposeResolution" && status !== 0) {
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

function validateVerdict(args: {
  settlement: InFlightSettlement;
  verdict: GenLayerVerdict;
  evidenceUrls: string[];
}):
  | { ok: true; attestation: ResolverAttestation }
  | { ok: false; reason: string } {
  const { settlement, verdict, evidenceUrls } = args;
  const market = settlement.market;

  if (!market?.id || market.id !== settlement.marketId) {
    return { ok: false, reason: "verdict market id does not match settlement market id" };
  }
  if (!market.arcAddress || !/^0x[a-fA-F0-9]{40}$/.test(market.arcAddress)) {
    return { ok: false, reason: "market has no valid Arc contract address" };
  }
  if (market.status !== "active") {
    return { ok: false, reason: `market status is ${market.status}, not active` };
  }
  if (market.lmsrStatus && market.lmsrStatus !== "Active") {
    return { ok: false, reason: `Arc market is ${market.lmsrStatus}, not Active` };
  }
  if (settlement.arcTxHash) {
    return { ok: false, reason: "verdict already submitted to Arc for this market" };
  }

  const confidence = verdict.confidence;
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    return { ok: false, reason: "confidence must be between 0 and 1 when provided" };
  }

  const sourceValidation = validateEvidenceSources(evidenceUrls);
  if (!sourceValidation.ok) return { ok: false, reason: sourceValidation.reason };

  const proposedOutcome = isConsensusFailure(verdict)
    ? "INVALID"
    : verdict.outcome === true
      ? "YES"
      : verdict.outcome === false
        ? "NO"
        : null;

  if (!proposedOutcome) {
    return { ok: false, reason: "unsupported GenLayer outcome payload" };
  }

  const reasoning = String(verdict.reasoning ?? "").trim();
  if (!reasoning) {
    return { ok: false, reason: "verdict reasoning is required" };
  }

  return {
    ok: true,
    attestation: {
      marketId: settlement.marketId,
      genLayerContract: EXPECTED_GENLAYER_CONTRACT,
      genLayerVerdictId: verdict.verdictId ?? settlement.genlayerTxHash ?? undefined,
      proposedOutcome,
      confidence,
      evidenceHash: evidenceHash(evidenceUrls),
      evidenceUrls,
      reasoningSummary: reasoning.slice(0, 500),
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

function validateEvidenceSources(sources: string[]): { ok: true } | { ok: false; reason: string } {
  if (sources.length === 0) {
    return { ok: false, reason: "at least one evidence URL is required" };
  }
  if (sources.length > 5) {
    return { ok: false, reason: "at most five evidence URLs are supported" };
  }
  const bad = sources.find((source) => !/^https?:\/\/[^\s]+$/i.test(source));
  if (bad) {
    return { ok: false, reason: `invalid evidence URL: ${bad}` };
  }
  return { ok: true };
}

function isConsensusFailure(verdict: GenLayerVerdict): boolean {
  return verdict.reasoning.trim().toLowerCase() === "consensus failure";
}

function extractSources(resolutionSource: string | null): string[] {
  if (!resolutionSource) return [];

  const filterHttp = (xs: unknown[]) =>
    xs
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s))
      .slice(0, 5);

  const trimmed = resolutionSource.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return filterHttp(parsed);
    } catch {
      // Fall through to plain text split.
    }
  }
  return filterHttp(trimmed.split(/[\n,]+/));
}

function parseSources(json: unknown): string[] | null {
  if (!json) return null;
  if (Array.isArray(json)) {
    return json
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
  }
  return null;
}

function evidenceHash(urls: string[]): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(urls.map((url) => url.trim()).sort()))
    .digest("hex")}`;
}

async function markFailed(marketId: string, reason: string): Promise<void> {
  console.error("[resolver] failed", { marketId, reason });
  await prisma.settlement.update({
    where: { marketId },
    data: { status: "failed", reasoning: reason },
  });
}
