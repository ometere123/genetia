import { decodeEventLog, parseAbi, type Hex } from "viem";
import type { ChainEventInput } from "./indexer";

/** Event signatures mirror the checked-in Solidity contracts; decoding is
 * performed by viem from these ABI fragments, never by positional JSON. */
export const BASE_EVENT_ABI = parseAbi([
  "event ReleaseRegistered(bytes32 indexed releaseId, address implementation, bytes32 bytecodeHash, bytes32 commitSha)",
  "event ReleaseActivationChanged(bytes32 indexed releaseId, bool active)",
  "event PoolCreated(bytes32 indexed marketId, address indexed market, bytes32 indexed releaseId)",
  "event LMSRCreated(bytes32 indexed marketId, address indexed market, address indexed vault, bytes32 releaseId, uint256 b)",
  "event BondLocked(bytes32 indexed proposalId, address indexed proposer)",
  "event BondRevision(bytes32 indexed proposalId, uint8 revision)",
  "event BondReleased(bytes32 indexed proposalId, address indexed proposer, uint256 proposerAmount, uint256 reserveAmount, bytes32 reason)",
  "event Staked(address indexed account, bool indexed yes, uint256 amount)",
  "event Settled(uint8 indexed outcome, uint256 fee)",
  "event Claimed(address indexed account, uint256 amount)",
  "event Contributed(address indexed provider, uint256 assets, uint256 shares)",
  "event Activated(uint256 funding)",
  "event FailedFundingWithdrawn(address indexed provider, uint256 amount)",
  "event TerminalAssetsAvailable(uint256 amount)",
  "event TerminalWithdrawn(address indexed provider, uint256 shares, uint256 assets)",
  "event Bought(address indexed trader, uint8 indexed side, uint256 shares, uint256 notional, uint256 fee)",
  "event Sold(address indexed trader, uint8 indexed side, uint256 shares, uint256 notional, uint256 fee)",
  "event Redeemed(address indexed holder, uint256 yesBurned, uint256 noBurned, uint256 payout)",
  "event VoidDustReleased(uint256 amount)",
  "event MarketRegistered(address indexed market, bytes32 indexed marketId, address resolver, bytes32 manifestHash, bytes32 resolverReleaseId, uint256 terminalDeadline)",
  "event ResolutionConsumed(bytes32 indexed marketId, uint8 outcome, bytes32 indexed genlayerTxId, uint8 attempt)",
]);

type RawLog = { address: `0x${string}`; topics: readonly Hex[]; data: Hex; transactionHash: `0x${string}`; blockHash: `0x${string}`; blockNumber: bigint; transactionIndex?: number; logIndex: number };

function serialise(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialise);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialise(item)]));
  return value;
}

export function decodeBaseLog(log: RawLog, chainId = 84532): ChainEventInput | null {
  try {
    if (log.topics.length === 0) return null;
    const decoded = decodeEventLog({ abi: BASE_EVENT_ABI, topics: [...log.topics] as [Hex, ...Hex[]], data: log.data, strict: true });
    return {
      chainId,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      contractAddress: log.address,
      eventName: decoded.eventName,
      payload: serialise(decoded.args) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export function decodeBaseLogs(logs: readonly RawLog[], chainId = 84532): ChainEventInput[] {
  return logs.flatMap((log) => { const decoded = decodeBaseLog(log, chainId); return decoded ? [decoded] : []; });
}
