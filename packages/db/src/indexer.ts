export type ChainEventInput = {
  chainId: number;
  transactionHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  blockHash: `0x${string}`;
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
  return [...byIdentity.values()].sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex);
}

export function rebuildFromDeploymentBlock(events: readonly ChainEventInput[], deploymentBlock: bigint): IndexedChainEvent[] {
  return indexEvents([], events.filter((event) => event.blockNumber >= deploymentBlock));
}
