/**
 * Arc on-chain indexer (server-only).
 *
 * Walks the LMSRMarketFactory and every deployed LMSRMarket, polls their
 * events from `lastIndexedBlock` forward, and mirrors the state into
 * Postgres. The chain is the source of truth; this table is just a fast
 * cache so frontend reads don't have to RPC-fan-out per request.
 *
 * Triggered by:
 *   - POST /api/cron/index-arc  (every 30s, same cron path as the resolver)
 *   - Manual admin button
 *
 * Idempotency:
 *   - `IndexerCursor.factory` tracks last block scanned for factory events.
 *   - Each Market's `lastIndexedBlock` column tracks per-market progress.
 *   - `ArcTrade.@@unique([txHash, action, userAddress, shares])` rejects dups
 *     on retry — replaying the same range is safe.
 */

import "server-only";

import { createPublicClient, http, getAddress, type Address, type Log } from "viem";
import { prisma } from "@/lib/db";
import { Decimal } from "@/lib/decimal";
import { LMSR_FACTORY_ABI, LMSR_MARKET_ABI, statusLabel, outcomeLabel } from "./lmsr-abi";

// ── Chain wiring ──────────────────────────────────────────────────────────

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
const FACTORY_ADDRESS = (process.env.NEXT_PUBLIC_LMSR_FACTORY_ADDRESS ?? "") as Address | "";

function makeClient() {
  return createPublicClient({
    chain: {
      id: ARC_CHAIN_ID,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [ARC_RPC] } },
    },
    transport: http(ARC_RPC),
  });
}

function devStub() {
  return !FACTORY_ADDRESS;
}

// ── Cursor helpers ────────────────────────────────────────────────────────

const FACTORY_CURSOR = "lmsr-factory";

async function getCursor(name: string): Promise<bigint> {
  const row = await prisma.indexerCursor.findUnique({ where: { name } });
  return row ? BigInt(row.blockNumber.toString()) : 0n;
}

async function setCursor(name: string, blockNumber: bigint): Promise<void> {
  await prisma.indexerCursor.upsert({
    where: { name },
    create: { name, blockNumber: new Decimal(blockNumber.toString()) },
    update: { blockNumber: new Decimal(blockNumber.toString()) },
  });
}

// ── Factory: new market deployments ───────────────────────────────────────

interface FactoryDeployment {
  marketId: bigint;
  marketAddress: Address;
  b: bigint;
  expiry: bigint;
  blockNumber: bigint;
}

async function readFactoryDeployments(
  fromBlock: bigint,
  toBlock: bigint
): Promise<FactoryDeployment[]> {
  const client = makeClient();
  const logs = await client.getLogs({
    address: FACTORY_ADDRESS as Address,
    event: {
      type: "event",
      name: "MarketCreated",
      inputs: [
        { name: "marketId", type: "uint256", indexed: true },
        { name: "market", type: "address", indexed: true },
        { name: "b", type: "uint256", indexed: false },
        { name: "expiry", type: "uint256", indexed: false },
      ],
    },
    fromBlock,
    toBlock,
  });

  return logs.map((log) => {
    const args = (log as unknown as { args: { marketId: bigint; market: Address; b: bigint; expiry: bigint } }).args;
    return {
      marketId: args.marketId,
      marketAddress: getAddress(args.market),
      b: args.b,
      expiry: args.expiry,
      blockNumber: log.blockNumber!,
    };
  });
}

/**
 * Reconcile a single on-chain MarketCreated event into a DB Market row.
 *
 * If the Market row already exists (created off-chain when the suggestion
 * was approved and the factory tx was broadcast), we just stamp the on-
 * chain ID, b, and address. If it doesn't exist yet (unlikely but possible
 * for direct-deploy testing), we create a placeholder row.
 */
async function applyFactoryDeployment(d: FactoryDeployment): Promise<void> {
  const existing = await prisma.market.findUnique({
    where: { arcAddress: d.marketAddress },
  });
  if (existing) {
    await prisma.market.update({
      where: { id: existing.id },
      data: {
        marketIdOnChain: new Decimal(d.marketId.toString()),
        lmsrB: new Decimal(d.b.toString()).div(1_000_000),
        lmsrStatus: "Active",
      },
    });
  } else {
    // Unknown market discovered on-chain — log it so admin can investigate.
    console.warn(
      `[arc-indexer] MarketCreated event for ${d.marketAddress} has no matching Market row`
    );
  }
}

// ── Per-market: Bought / Sold / Redeemed / status changes ────────────────

interface TradeRow {
  marketId: string;
  userAddress: Address;
  action: "buy" | "sell" | "redeem";
  side: "YES" | "NO";
  amount: bigint; // 6-dec USDC
  shares: bigint; // 6-dec
  fee: bigint;
  effectivePrice: bigint; // 1e18
  txHash: `0x${string}`;
  blockNumber: bigint;
  blockTime: Date;
}

function sideOf(outcome: number): "YES" | "NO" {
  return outcome === 1 ? "YES" : "NO";
}

function divUd(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  // amount and shares both 6-dec; output is 1e18 fixed point price
  return (numerator * 10n ** 18n) / denominator;
}

async function readMarketEvents(
  marketAddress: Address,
  fromBlock: bigint,
  toBlock: bigint
): Promise<{
  trades: Omit<TradeRow, "marketId">[];
  statusUpdates: {
    type: "proposed" | "disputed" | "finalized" | "admin";
    outcome?: number;
    pendingUntil?: bigint;
    challenger?: Address;
    bond?: bigint;
    blockNumber: bigint;
    blockTime: Date;
    txHash: `0x${string}`;
  }[];
}> {
  const client = makeClient();

  const logs = await client.getLogs({
    address: marketAddress,
    fromBlock,
    toBlock,
  });

  // Need block timestamps for ArcTrade.blockTime
  const blockCache = new Map<bigint, Date>();
  async function blockTimeOf(bn: bigint): Promise<Date> {
    if (blockCache.has(bn)) return blockCache.get(bn)!;
    const blk = await client.getBlock({ blockNumber: bn });
    const t = new Date(Number(blk.timestamp) * 1000);
    blockCache.set(bn, t);
    return t;
  }

  const trades: Omit<TradeRow, "marketId">[] = [];
  const statusUpdates: Awaited<ReturnType<typeof readMarketEvents>>["statusUpdates"] = [];

  for (const raw of logs) {
    const log = raw as Log & { eventName?: string; args?: Record<string, unknown> };
    const evt = parseLog(log);
    if (!evt) continue;

    const blockTime = await blockTimeOf(log.blockNumber!);

    if (evt.name === "Bought") {
      const args = evt.args as { user: Address; outcome: number; shares: bigint; cost: bigint; fee: bigint };
      trades.push({
        userAddress: getAddress(args.user),
        action: "buy",
        side: sideOf(args.outcome),
        amount: args.cost + args.fee,
        shares: args.shares,
        fee: args.fee,
        effectivePrice: divUd(args.cost, args.shares),
        txHash: log.transactionHash!,
        blockNumber: log.blockNumber!,
        blockTime,
      });
    } else if (evt.name === "Sold") {
      const args = evt.args as { user: Address; outcome: number; shares: bigint; ret: bigint };
      trades.push({
        userAddress: getAddress(args.user),
        action: "sell",
        side: sideOf(args.outcome),
        amount: args.ret,
        shares: args.shares,
        fee: 0n,
        effectivePrice: divUd(args.ret, args.shares),
        txHash: log.transactionHash!,
        blockNumber: log.blockNumber!,
        blockTime,
      });
    } else if (evt.name === "Redeemed") {
      const args = evt.args as { user: Address; yesBurned: bigint; noBurned: bigint; paid: bigint };
      const sharesTotal = args.yesBurned + args.noBurned;
      trades.push({
        userAddress: getAddress(args.user),
        action: "redeem",
        side: args.yesBurned >= args.noBurned ? "YES" : "NO",
        amount: args.paid,
        shares: sharesTotal,
        fee: 0n,
        effectivePrice: divUd(args.paid, sharesTotal),
        txHash: log.transactionHash!,
        blockNumber: log.blockNumber!,
        blockTime,
      });
    } else if (evt.name === "ResolutionProposed") {
      const args = evt.args as { outcome: number; pendingUntil: bigint };
      statusUpdates.push({
        type: "proposed",
        outcome: args.outcome,
        pendingUntil: args.pendingUntil,
        blockNumber: log.blockNumber!,
        blockTime,
        txHash: log.transactionHash!,
      });
    } else if (evt.name === "Disputed") {
      const args = evt.args as { challenger: Address; bond: bigint };
      statusUpdates.push({
        type: "disputed",
        challenger: getAddress(args.challenger),
        bond: args.bond,
        blockNumber: log.blockNumber!,
        blockTime,
        txHash: log.transactionHash!,
      });
    } else if (evt.name === "Finalized" || evt.name === "AdminResolved") {
      const args = evt.args as { outcome: number };
      statusUpdates.push({
        type: evt.name === "Finalized" ? "finalized" : "admin",
        outcome: args.outcome,
        blockNumber: log.blockNumber!,
        blockTime,
        txHash: log.transactionHash!,
      });
    }
  }

  return { trades, statusUpdates };
}

/** Minimal event-name extraction; viem includes it on the log when an ABI is passed. */
function parseLog(log: Log & { eventName?: string; args?: Record<string, unknown> }): {
  name: string;
  args: Record<string, unknown>;
} | null {
  // We didn't pass the ABI to getLogs (we want everything from the address),
  // so viem won't auto-decode. Fall back to topic-matching using the known ABI.
  try {
    const { decodeEventLog } = require("viem") as typeof import("viem");
    const decoded = decodeEventLog({
      abi: LMSR_MARKET_ABI,
      data: log.data,
      topics: log.topics,
    });
    return { name: decoded.eventName, args: decoded.args as Record<string, unknown> };
  } catch {
    return null;
  }
}

// ── Main indexer step ─────────────────────────────────────────────────────

export interface IndexResult {
  factoryFromBlock: bigint;
  factoryToBlock: bigint;
  newMarkets: number;
  marketsScanned: number;
  tradesInserted: number;
  statusUpdatesApplied: number;
}

/**
 * Run one pass of the indexer. Safe to call concurrently — Postgres unique
 * constraints reject duplicate inserts.
 *
 * `maxRange` caps the block window per call (default 5000) to keep RPC
 * responses small. Resume on next call.
 *
 * First-run / catch-up: if the cursor is more than `maxRange × 2` behind
 * tip, we jump straight to `tip − lookback`. Without this, on chains like
 * Arc Testnet (~42M blocks) we'd spend days slowly creeping forward from
 * block 0 instead of indexing actual market activity.
 */
const FAR_BEHIND_LOOKBACK = 5_000n;

export async function indexArcOnce(opts: { maxRange?: bigint } = {}): Promise<IndexResult> {
  if (devStub()) {
    console.warn("[arc-indexer] dev stub — NEXT_PUBLIC_LMSR_FACTORY_ADDRESS not set");
    return {
      factoryFromBlock: 0n,
      factoryToBlock: 0n,
      newMarkets: 0,
      marketsScanned: 0,
      tradesInserted: 0,
      statusUpdatesApplied: 0,
    };
  }

  const maxRange = opts.maxRange ?? 5_000n;
  const client = makeClient();
  const tip = await client.getBlockNumber();

  // ── Factory: discover new markets ──
  const factoryCursor = await getCursor(FACTORY_CURSOR);
  // Jump to `tip - lookback` if the cursor is far behind tip (first run, or
  // restored from a long downtime). Avoids the multi-day catch-up scan on
  // long-lived chains.
  const isFarBehind = factoryCursor === 0n || tip - factoryCursor > maxRange * 2n;
  const factoryFrom = isFarBehind
    ? (tip > FAR_BEHIND_LOOKBACK ? tip - FAR_BEHIND_LOOKBACK : 0n)
    : factoryCursor + 1n;
  const factoryTo = factoryFrom + maxRange > tip ? tip : factoryFrom + maxRange;

  let newMarkets = 0;
  if (factoryTo >= factoryFrom) {
    const deployments = await readFactoryDeployments(factoryFrom, factoryTo);
    for (const d of deployments) {
      await applyFactoryDeployment(d);
      newMarkets++;
    }
    await setCursor(FACTORY_CURSOR, factoryTo);
  }

  // ── Per-market: scan events ──
  const markets = await prisma.market.findMany({
    where: { arcAddress: { not: null }, marketIdOnChain: { not: null } },
    select: { id: true, arcAddress: true, lastIndexedBlock: true },
  });

  let tradesInserted = 0;
  let statusUpdatesApplied = 0;

  for (const m of markets) {
    if (!m.arcAddress) continue;
    const lastIndexed = m.lastIndexedBlock
      ? BigInt(m.lastIndexedBlock.toString())
      : 0n;
    // Same far-behind catch-up logic as the factory cursor.
    const farBehind = lastIndexed === 0n || tip - lastIndexed > maxRange * 2n;
    const fromBlock = farBehind
      ? (tip > FAR_BEHIND_LOOKBACK ? tip - FAR_BEHIND_LOOKBACK : 0n)
      : lastIndexed + 1n;
    const toBlock = fromBlock + maxRange > tip ? tip : fromBlock + maxRange;
    if (toBlock < fromBlock) continue;

    const { trades, statusUpdates } = await readMarketEvents(
      m.arcAddress as Address,
      fromBlock,
      toBlock
    );

    for (const t of trades) {
      try {
        await prisma.arcTrade.create({
          data: {
            marketId: m.id,
            userAddress: t.userAddress,
            action: t.action,
            side: t.side,
            amount: new Decimal(t.amount.toString()).div(1_000_000),
            shares: new Decimal(t.shares.toString()).div(1_000_000),
            fee: new Decimal(t.fee.toString()).div(1_000_000),
            effectivePrice: new Decimal(t.effectivePrice.toString()).div(
              new Decimal(10).pow(18)
            ),
            txHash: t.txHash,
            blockNumber: new Decimal(t.blockNumber.toString()),
            blockTime: t.blockTime,
          },
        });
        tradesInserted++;
      } catch (err) {
        // Unique constraint hit → already inserted, fine.
        if (!String(err).includes("Unique")) {
          console.warn("[arc-indexer] trade insert failed", err);
        }
      }
    }

    for (const s of statusUpdates) {
      await applyStatusUpdate(m.id, s);
      statusUpdatesApplied++;
    }

    // Pull canonical state from chain to update cached q/collateral/status.
    await reconcileMarketState(m.id, m.arcAddress as Address, toBlock);
  }

  return {
    factoryFromBlock: factoryFrom,
    factoryToBlock: factoryTo,
    newMarkets,
    marketsScanned: markets.length,
    tradesInserted,
    statusUpdatesApplied,
  };
}

async function applyStatusUpdate(
  marketId: string,
  s: Awaited<ReturnType<typeof readMarketEvents>>["statusUpdates"][number]
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (s.type === "proposed" && s.outcome !== undefined) {
    data.lmsrStatus = "Pending";
    data.proposedOutcome = outcomeLabel(s.outcome);
    data.pendingSince = s.blockTime;
  } else if (s.type === "disputed") {
    data.lmsrStatus = "Disputed";
    if (s.challenger) data.disputeBondHolder = s.challenger;
    if (s.bond !== undefined) {
      data.disputeBondAmount = new Decimal(s.bond.toString()).div(1_000_000);
    }
  } else if ((s.type === "finalized" || s.type === "admin") && s.outcome !== undefined) {
    data.lmsrStatus = "Finalized";
    data.proposedOutcome = outcomeLabel(s.outcome);
    data.status = "resolved";
    // Mirror onto settlement too.
    const outcomeText = outcomeLabel(s.outcome);
    if (outcomeText === "YES" || outcomeText === "NO" || outcomeText === "INVALID") {
      await prisma.settlement.upsert({
        where: { marketId },
        create: {
          marketId,
          status: "submitted_to_arc",
          resolution: outcomeText === "INVALID" ? null : outcomeText,
          finalizedAt: s.blockTime,
          arcResolvedAt: s.blockTime,
          arcTxHash: s.txHash,
        },
        update: {
          status: "submitted_to_arc",
          resolution: outcomeText === "INVALID" ? null : outcomeText,
          finalizedAt: s.blockTime,
          arcResolvedAt: s.blockTime,
          arcTxHash: s.txHash,
        },
      });
    }
  }
  await prisma.market.update({ where: { id: marketId }, data });
}

/**
 * Read the current on-chain snapshot (qYes, qNo, collateral, status) and
 * update the Market row + lastIndexedBlock cursor.
 */
async function reconcileMarketState(
  marketId: string,
  marketAddress: Address,
  asOfBlock: bigint
): Promise<void> {
  const client = makeClient();
  const [qYes, qNo, collateral, statusU] = await Promise.all([
    client.readContract({ address: marketAddress, abi: LMSR_MARKET_ABI, functionName: "qYes" }),
    client.readContract({ address: marketAddress, abi: LMSR_MARKET_ABI, functionName: "qNo" }),
    client.readContract({ address: marketAddress, abi: LMSR_MARKET_ABI, functionName: "collateral" }),
    client.readContract({ address: marketAddress, abi: LMSR_MARKET_ABI, functionName: "status" }),
  ]);

  await prisma.market.update({
    where: { id: marketId },
    data: {
      yesPool: new Decimal((qYes as bigint).toString()).div(1_000_000),
      noPool: new Decimal((qNo as bigint).toString()).div(1_000_000),
      lmsrCollateral: new Decimal((collateral as bigint).toString()).div(1_000_000),
      lmsrStatus: statusLabel(Number(statusU)),
      lastIndexedBlock: new Decimal(asOfBlock.toString()),
    },
  });
}
