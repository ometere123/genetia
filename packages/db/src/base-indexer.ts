import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { decodeBaseLogs } from "./base-events";
import type { ChainEventInput } from "./indexer";

export type IndexerStore = {
  cursor(chainId: number): Promise<{ deploymentBlock: bigint; nextBlock: bigint; lastBlockHash: string | null } | null>;
  persistEvents(events: readonly ChainEventInput[]): Promise<unknown>;
  advanceCursor?(cursor: { chainId: number; deploymentBlock: bigint; nextBlock: bigint; lastBlockHash: string }): Promise<unknown>;
};

type RpcLog = { address: `0x${string}`; topics: readonly `0x${string}`[]; data: `0x${string}`; transactionHash: `0x${string}`; blockHash: `0x${string}`; blockNumber: bigint; transactionIndex?: number; logIndex: number };
type RpcClient = { getBlockNumber(): Promise<bigint>; getBlock(args: { blockNumber: bigint }): Promise<{ hash: `0x${string}` }>; getLogs(args: { fromBlock: bigint; toBlock: bigint; address?: readonly `0x${string}`[] }): Promise<readonly RpcLog[]> };

export type BaseIndexerConfig = {
  rpcUrl: string;
  secondaryRpcUrl?: string;
  deploymentBlock: bigint;
  batchSize?: bigint;
  /** Keep unfinalized head blocks out of the public/event projection. */
  finalityConfirmations?: bigint;
  store: IndexerStore;
  /** Test seam for deterministic RPC fixtures; production uses rpcUrl. */
  client?: RpcClient;
  secondaryClient?: RpcClient;
};

/**
 * Restart-safe Base log reader. Financial state is never inferred here: the
 * service only decodes canonical logs and hands them to the transactional
 * repository. A later projection rebuild can replay the same event stream.
 */
export class BaseIndexer {
  readonly chainId = 84532;
  private readonly batchSize: bigint;
  private readonly primary: RpcClient;
  private readonly secondary?: RpcClient;

  constructor(private readonly config: BaseIndexerConfig) {
    this.batchSize = config.batchSize ?? 2_000n;
    this.primary = config.client ?? createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) }) as unknown as RpcClient;
    this.secondary = config.secondaryClient ?? (config.secondaryRpcUrl ? createPublicClient({ chain: baseSepolia, transport: http(config.secondaryRpcUrl) }) as unknown as RpcClient : undefined);
  }

  private async withFallback<T>(operation: (client: RpcClient) => Promise<T>): Promise<T> {
    try { return await operation(this.primary); }
    catch (primaryError) {
      if (!this.secondary) throw primaryError;
      return operation(this.secondary);
    }
  }

  async runOnce(toBlock?: bigint): Promise<{ fromBlock: bigint; toBlock: bigint; decoded: number; caughtUp: boolean }> {
    const cursor = await this.config.store.cursor(this.chainId);
    let from = cursor?.nextBlock ?? this.config.deploymentBlock;
    const latest = toBlock ?? await this.withFallback((client) => client.getBlockNumber());
    const confirmations = this.config.finalityConfirmations ?? 0n;
    const head = latest >= confirmations ? latest - confirmations : 0n;
    if (from > head) return { fromBlock: from, toBlock: head, decoded: 0, caughtUp: true };
    const end = from + this.batchSize - 1n < head ? from + this.batchSize - 1n : head;
    const logs = await this.withFallback((client) => client.getLogs({ fromBlock: from, toBlock: end }));
    const decoded = decodeBaseLogs(logs.map((log) => ({
      address: log.address,
      topics: log.topics,
      data: log.data,
      transactionHash: log.transactionHash!,
      blockHash: log.blockHash!,
      blockNumber: log.blockNumber!,
      transactionIndex: log.transactionIndex,
      logIndex: log.logIndex!,
    })));
    await this.config.store.persistEvents(decoded);
    const block = await this.withFallback((client) => client.getBlock({ blockNumber: end }));
    await this.config.store.advanceCursor?.({ chainId: this.chainId, deploymentBlock: cursor?.deploymentBlock ?? this.config.deploymentBlock, nextBlock: end + 1n, lastBlockHash: block.hash });
    return { fromBlock: from, toBlock: end, decoded: decoded.length, caughtUp: end >= head };
  }
}
