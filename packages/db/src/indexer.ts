export type ChainEventInput = {
  chainId: number;
  transactionHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionIndex?: number;
  contractAddress: `0x${string}`;
  eventName: string;
  payload: Record<string, unknown>;
};

export type IndexedChainEvent = ChainEventInput & { identity: string };

/** Canonical event identity; user, amount, and payload are deliberately excluded. */
export function chainEventIdentity(event: Pick<ChainEventInput, "chainId" | "transactionHash" | "logIndex">): string {
  return `${event.chainId}:${event.transactionHash.toLowerCase()}:${event.logIndex}`;
}

export function indexEvents(existing: readonly IndexedChainEvent[], incoming: readonly ChainEventInput[]): IndexedChainEvent[] {
  const byIdentity = new Map(existing.map((event) => [event.identity, event]));
  for (const event of incoming) {
    const identity = chainEventIdentity(event);
    if (!byIdentity.has(identity)) byIdentity.set(identity, { ...event, identity });
  }
  return [...byIdentity.values()].sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : (a.transactionIndex ?? 0) - (b.transactionIndex ?? 0) || a.logIndex - b.logIndex);
}

export function rebuildFromDeploymentBlock(events: readonly ChainEventInput[], deploymentBlock: bigint): IndexedChainEvent[] {
  return indexEvents([], events.filter((event) => event.blockNumber >= deploymentBlock));
}

export type IndexedCursor = { deploymentBlock: bigint; nextBlock: bigint; lastBlockHash?: `0x${string}` | null };

/** Finds the highest indexed common ancestor using the node's canonical block hashes. */
export function findReorgRollbackPoint(
  events: readonly IndexedChainEvent[],
  cursor: IndexedCursor,
  canonicalHashes: ReadonlyMap<bigint, `0x${string}`>,
): bigint | null {
  if (!cursor.lastBlockHash || cursor.nextBlock <= cursor.deploymentBlock) return null;
  for (let block = cursor.nextBlock - 1n; block >= cursor.deploymentBlock; block--) {
    const canonical = canonicalHashes.get(block);
    const indexed = events.find((event) => event.blockNumber === block)?.blockHash;
    if (canonical && indexed && canonical.toLowerCase() === indexed.toLowerCase()) return block;
  }
  return cursor.deploymentBlock - 1n;
}

export function rollbackToBlock(events: readonly IndexedChainEvent[], rollbackBlock: bigint): IndexedChainEvent[] {
  return events.filter((event) => event.blockNumber <= rollbackBlock);
}
