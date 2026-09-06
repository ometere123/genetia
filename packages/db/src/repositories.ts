import { PrismaClient, type Prisma } from "@prisma/client";
import type { ChainEventInput, IndexedChainEvent } from "./indexer";

/**
 * Persistence boundary for indexed/application data. No method here computes
 * or stores a user cash balance: Base contracts remain the financial source
 * of truth and these records are rebuildable projections.
 */
export class GenetiaRepositories {
  constructor(private readonly db: PrismaClient) {}

  users = {
    upsert: (input: Prisma.UserCreateInput) => this.db.user.upsert({ where: { privyUserId: input.privyUserId }, create: input, update: { displayName: input.displayName, avatarUrl: input.avatarUrl } }),
    wallet: (userId: string, input: Prisma.WalletCreateWithoutUserInput) => this.db.wallet.upsert({ where: { chainId_address: { chainId: input.chainId, address: input.address } }, create: { ...input, user: { connect: { id: userId } } }, update: { kind: input.kind } }),
  };

  proposals = {
    create: (input: Prisma.ProposalCreateInput) => this.db.proposal.create({ data: input }),
    get: (proposalKey: string) => this.db.proposal.findUnique({ where: { proposalKey } }),
    updateState: (proposalKey: string, data: Prisma.ProposalUpdateInput) => this.db.proposal.update({ where: { proposalKey }, data }),
  };

  markets = {
    upsert: (input: Prisma.MarketCreateInput) => this.db.market.upsert({ where: { marketId: input.marketId }, create: input, update: input }),
    get: (marketId: string) => this.db.market.findUnique({ where: { marketId } }),
  };

  resolutions = {
    attempt: (marketId: string, input: Omit<Prisma.ResolutionAttemptCreateInput, "market">) => this.db.resolutionAttempt.upsert({ where: { id: input.id }, create: { ...input, market: { connect: { id: marketId } } }, update: input }),
    evidence: (marketId: string, input: Omit<Prisma.EvidenceCreateInput, "market">) => this.db.evidence.upsert({ where: { marketId_attemptNo_sourceIdentity_url: { marketId, attemptNo: input.attemptNo, sourceIdentity: input.sourceIdentity, url: input.url } }, create: { ...input, market: { connect: { id: marketId } } }, update: input }),
    attestation: (marketId: string, input: Omit<Prisma.WatcherAttestationCreateInput, "market">) => this.db.watcherAttestation.upsert({ where: { id: input.id }, create: { ...input, market: { connect: { id: marketId } } }, update: input }),
  };

  async persistEvents(events: readonly ChainEventInput[]): Promise<IndexedChainEvent[]> {
    if (!events.length) return [];
    await this.db.$transaction(async (tx) => {
      await tx.chainEvent.createMany({
        data: events.map((event) => ({ chainId: event.chainId, transactionHash: event.transactionHash, logIndex: event.logIndex, blockNumber: event.blockNumber, blockHash: event.blockHash, contractAddress: event.contractAddress, eventName: event.eventName, payload: event.payload })),
        skipDuplicates: true,
      });
      const last = events.reduce((max, event) => event.blockNumber > max ? event.blockNumber : max, 0n);
      const first = events.reduce((min, event) => event.blockNumber < min ? event.blockNumber : min, events[0]!.blockNumber);
      await tx.indexerCursor.upsert({ where: { chainId: events[0]!.chainId }, create: { chainId: events[0]!.chainId, deploymentBlock: first, nextBlock: last + 1n, lastBlockHash: events.at(-1)!.blockHash }, update: { nextBlock: last + 1n, lastBlockHash: events.at(-1)!.blockHash } });
    });
    return events.map((event) => ({ ...event, identity: `${event.chainId}:${event.transactionHash.toLowerCase()}:${event.logIndex}` }));
  }

  async cursor(chainId: number) { return this.db.indexerCursor.findUnique({ where: { chainId } }); }
}
