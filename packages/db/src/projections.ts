import type { IndexedChainEvent } from "./indexer";

export type ProjectionState = {
  releases: Record<string, { implementation?: string; active?: boolean }>;
  proposals: Record<string, { proposer?: string; revisions: number; disposition?: string; refunded: bigint; retained: bigint }>;
  markets: Record<string, {
    address: string; engine: "POOL" | "LMSR"; vault?: string; releaseId?: string; resolver?: string; resolverReleaseId?: string; manifestHash?: string;
    yesTotal: bigint; noTotal: bigint; terminalOutcome?: number; active: boolean; funding?: bigint; fundingTarget?: bigint;
    qYes: bigint; qNo: bigint; fees: bigint; positions: Record<string, { yes: bigint; no: bigint; shares: bigint; claimable: bigint }>;
    lp: Record<string, { assets: bigint; shares: bigint; withdrawn: bigint }>;
    resolution: { attempt?: number; txIds: string[]; settled: boolean; expired: boolean; quorum: number };
  }>;
  history: Array<{ identity: string; marketAddress: string; actor?: string; eventName: string }>;
};

export function emptyProjection(): ProjectionState {
  return { releases: {}, proposals: {}, markets: {}, history: [] };
}

function text(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function amount(value: unknown): bigint { return typeof value === "string" || typeof value === "number" || typeof value === "bigint" ? BigInt(value) : 0n; }
function marketFor(state: ProjectionState, address: string) { return Object.values(state.markets).find((market) => market.address.toLowerCase() === address.toLowerCase()); }
function position(market: ProjectionState["markets"][string], actor: string) { return market.positions[actor] ??= { yes: 0n, no: 0n, shares: 0n, claimable: 0n }; }

export function projectEvent(state: ProjectionState, event: IndexedChainEvent): ProjectionState {
  const p = event.payload;
  switch (event.eventName) {
    case "ReleaseRegistered": {
      const id = text(p.releaseId); if (id) state.releases[id] = { implementation: text(p.implementation), active: true }; break;
    }
    case "ReleaseActivationChanged": {
      const id = text(p.releaseId); if (id && state.releases[id]) state.releases[id]!.active = Boolean(p.active); break;
    }
    case "BondLocked": {
      const id = text(p.proposalId); if (id) state.proposals[id] = { proposer: text(p.proposer), revisions: 0, refunded: 0n, retained: 0n }; break;
    }
    case "BondRevision": { const id = text(p.proposalId); if (id && state.proposals[id]) state.proposals[id]!.revisions = Number(p.revision); break; }
    case "BondReleased": {
      const id = text(p.proposalId); const proposal = id ? state.proposals[id] : undefined;
      if (proposal) { proposal.refunded += amount(p.proposerAmount); proposal.retained += amount(p.reserveAmount); proposal.disposition = text(p.reason); }
      break;
    }
    case "PoolCreated": {
      const id = text(p.marketId); const address = text(p.market); if (id && address) state.markets[id] = { address, engine: "POOL", releaseId: text(p.releaseId), yesTotal: 0n, noTotal: 0n, active: true, qYes: 0n, qNo: 0n, fees: 0n, positions: {}, lp: {}, resolution: { txIds: [], settled: false, expired: false, quorum: 0 } }; break;
    }
    case "LMSRCreated": {
      const id = text(p.marketId); const address = text(p.market); if (id && address) state.markets[id] = { address, engine: "LMSR", vault: text(p.vault), releaseId: text(p.releaseId), yesTotal: 0n, noTotal: 0n, active: false, funding: 0n, qYes: 0n, qNo: 0n, fees: 0n, positions: {}, lp: {}, resolution: { txIds: [], settled: false, expired: false, quorum: 0 } }; break;
    }
    case "Staked": { const market = marketFor(state, event.contractAddress); const actor = text(p.account); if (market && actor) { const stake = amount(p.amount); const pos = position(market, actor); if (p.yes) { market.yesTotal += stake; pos.yes += stake; } else { market.noTotal += stake; pos.no += stake; } } break; }
    case "Contributed": { const market = marketFor(state, event.contractAddress); const actor = text(p.provider); if (market && actor) { const entry = market.lp[actor] ??= { assets: 0n, shares: 0n, withdrawn: 0n }; entry.assets += amount(p.assets); entry.shares += amount(p.shares); market.funding = (market.funding ?? 0n) + amount(p.assets); } break; }
    case "Bought": { const market = marketFor(state, event.contractAddress); const actor = text(p.trader); if (market && actor) { const shares = amount(p.shares); const pos = position(market, actor); pos.shares += shares; if (Number(p.side) === 1) market.qYes += shares; else market.qNo += shares; market.fees += amount(p.fee); } break; }
    case "Sold": { const market = marketFor(state, event.contractAddress); const actor = text(p.trader); if (market && actor) { const shares = amount(p.shares); const pos = position(market, actor); pos.shares -= shares; if (Number(p.side) === 1) market.qYes -= shares; else market.qNo -= shares; market.fees += amount(p.fee); } break; }
    case "Activated": { const market = marketFor(state, event.contractAddress); if (market) { market.active = true; market.funding = amount(p.funding); } break; }
    case "Settled": { const market = marketFor(state, event.contractAddress); if (market) { market.active = false; market.terminalOutcome = Number(p.outcome); market.resolution.settled = true; market.fees += amount(p.fee); } break; }
    case "Claimed": { const market = marketFor(state, event.contractAddress); const actor = text(p.account); if (market && actor) position(market, actor).claimable = 0n; break; }
    case "Redeemed": { const market = marketFor(state, event.contractAddress); const actor = text(p.holder); if (market && actor) position(market, actor).claimable = 0n; break; }
    case "FailedFundingWithdrawn": { const market = marketFor(state, event.contractAddress); const actor = text(p.provider); if (market && actor) market.lp[actor] = { ...(market.lp[actor] ?? { assets: 0n, shares: 0n, withdrawn: 0n }), withdrawn: (market.lp[actor]?.withdrawn ?? 0n) + amount(p.amount) }; break; }
    case "TerminalWithdrawn": { const market = marketFor(state, event.contractAddress); const actor = text(p.provider); if (market && actor) market.lp[actor] = { ...(market.lp[actor] ?? { assets: 0n, shares: 0n, withdrawn: 0n }), withdrawn: (market.lp[actor]?.withdrawn ?? 0n) + amount(p.assets) }; break; }
    case "MarketRegistered": { const id = text(p.marketId); const market = id ? state.markets[id] : undefined; if (market) { market.resolver = text(p.resolver); market.manifestHash = text(p.manifestHash); } break; }
    case "ResolutionConsumed": { const market = text(p.market) ? marketFor(state, text(p.market)!) : marketFor(state, event.contractAddress); if (market) { market.resolution.txIds.push(text(p.genlayerTxId) ?? ""); market.terminalOutcome = Number(p.outcome); market.resolution.settled = true; } break; }
    case "PoolDustReleased":
    case "VoidDustReleased": { const market = marketFor(state, event.contractAddress); if (market) market.resolution.expired = false; break; }
    default: break;
  }
  const actor = text(p.account) ?? text(p.trader) ?? text(p.provider) ?? text(p.holder) ?? text(p.proposer);
  state.history.push({ identity: event.identity, marketAddress: event.contractAddress, actor, eventName: event.eventName });
  return state;
}

export function projectEvents(events: readonly IndexedChainEvent[]): ProjectionState {
  return events.reduce(projectEvent, emptyProjection());
}

/** Stable, JSON-safe representation used by rebuild and reorg comparisons. */
export function serialiseProjection(state: ProjectionState): string {
  return JSON.stringify(state, (_key, value) => typeof value === "bigint" ? value.toString() : value);
}
