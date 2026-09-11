import { PrismaClient, type Prisma } from "@prisma/client";
import type { ChainEventInput, IndexedChainEvent } from "./indexer";
import type { ProjectionState } from "./projections";

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
    getByProposalId: (proposalId: string) => this.db.proposal.findUnique({ where: { proposalId } }),
    updateState: (proposalKey: string, data: Prisma.ProposalUpdateInput) => this.db.proposal.update({ where: { proposalKey }, data }),
    /** Atomically records the durable proposal projection and its outbox intent. */
    createWithWorkflowIntent: async (input: Prisma.ProposalCreateInput, workflow: Prisma.WorkflowStateCreateInput) => this.db.$transaction(async (tx) => {
      const existing = await tx.proposal.findUnique({ where: { proposalKey: input.proposalKey } });
      if (existing) {
        if (existing.canonicalProposalHash !== input.canonicalProposalHash) throw new Error("idempotency key conflicts with proposal body");
        return { proposal: existing, intent: await tx.workflowState.findUnique({ where: { idempotencyKey: workflow.idempotencyKey } }) };
      }
      const proposal = await tx.proposal.create({ data: input });
      const intent = await tx.workflowState.create({ data: workflow });
      return { proposal, intent };
    }),
  };

  workflowIntents = {
    load: (idempotencyKey: string) => this.db.workflowState.findUnique({ where: { idempotencyKey } }),
    listDue: (now = new Date()) => this.db.workflowState.findMany({ where: { state: { in: ["PENDING", "RETRY"] }, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }, orderBy: { createdAt: "asc" }, take: 100 }),
    /** Atomic lease: concurrent dispatchers can never both claim a live intent. */
    claim: async (idempotencyKey: string, now = new Date(), leaseMs = 60_000) => {
      const result = await this.db.workflowState.updateMany({
        where: { idempotencyKey, state: { in: ["PENDING", "RETRY"] }, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
        data: { state: "CLAIMED", attempts: { increment: 1 }, nextRunAt: new Date(now.getTime() + leaseMs) },
      });
      return result.count === 1;
    },
    markDispatched: (idempotencyKey: string) => this.db.workflowState.update({ where: { idempotencyKey }, data: { state: "DISPATCHED", nextRunAt: null, lastError: null } }),
    markRetry: (idempotencyKey: string, nextRunAt: Date, lastError: string) => this.db.workflowState.update({ where: { idempotencyKey }, data: { state: "RETRY", nextRunAt, lastError } }),
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
        data: events.map((event) => ({ chainId: event.chainId, transactionHash: event.transactionHash, logIndex: event.logIndex, blockNumber: event.blockNumber, blockHash: event.blockHash, transactionIndex: event.transactionIndex, contractAddress: event.contractAddress, eventName: event.eventName, payload: event.payload as Prisma.InputJsonValue })),
        skipDuplicates: true,
      });
      const last = events.reduce((max, event) => event.blockNumber > max ? event.blockNumber : max, 0n);
      const first = events.reduce((min, event) => event.blockNumber < min ? event.blockNumber : min, events[0]!.blockNumber);
      await tx.indexerCursor.upsert({ where: { chainId: events[0]!.chainId }, create: { chainId: events[0]!.chainId, deploymentBlock: first, nextBlock: last + 1n, lastBlockHash: events.at(-1)!.blockHash }, update: { nextBlock: last + 1n, lastBlockHash: events.at(-1)!.blockHash } });
    });
    return events.map((event) => ({ ...event, identity: `${event.chainId}:${event.transactionHash.toLowerCase()}:${event.logIndex}` }));
  }

  async cursor(chainId: number) { return this.db.indexerCursor.findUnique({ where: { chainId } }); }

  async advanceCursor(cursor: { chainId: number; deploymentBlock: bigint; nextBlock: bigint; lastBlockHash: string }) {
    return this.db.indexerCursor.upsert({ where: { chainId: cursor.chainId }, create: cursor, update: { nextBlock: cursor.nextBlock, lastBlockHash: cursor.lastBlockHash } });
  }

  /** Replaces rebuildable read projections; this is never a cash ledger. */
  async replaceProjection(state: ProjectionState) {
    const marketRows = Object.entries(state.markets).flatMap(([marketId, market]) => [
      { projectionKey: `market:${marketId}`, kind: "market", marketId, payload: market },
      ...Object.entries(market.positions).map(([walletAddress, payload]) => ({ projectionKey: `position:${marketId}:${walletAddress.toLowerCase()}`, kind: "position", marketId, walletAddress, payload })),
      ...Object.entries(market.lp).map(([walletAddress, payload]) => ({ projectionKey: `lp:${marketId}:${walletAddress.toLowerCase()}`, kind: "lp", marketId, walletAddress, payload })),
    ]);
    const rows = [
      ...marketRows,
      ...Object.entries(state.proposals).map(([proposalId, payload]) => ({ projectionKey: `proposal:${proposalId}`, kind: "proposal", payload })),
      ...Object.entries(state.releases).map(([releaseId, payload]) => ({ projectionKey: `release:${releaseId}`, kind: "release", payload })),
      ...state.history.map((payload) => ({ projectionKey: `history:${payload.identity}`, kind: "history", marketId: payload.marketAddress, payload })),
    ];
    await this.db.$transaction(async (tx) => {
      await tx.derivedProjection.deleteMany();
      if (rows.length) await tx.derivedProjection.createMany({ data: rows as Prisma.DerivedProjectionCreateManyInput[] });
    });
    return rows.length;
  }
}
