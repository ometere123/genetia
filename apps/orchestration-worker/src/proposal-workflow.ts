export type AdmissibilityDecision = "APPROVED" | "NEEDS_REVISION" | "REJECTED";
export type BondDisposition = "APPROVED" | "ORDINARY_REJECTION" | "MALICIOUS_ABUSE" | "INFRASTRUCTURE_TIMEOUT";
export type ProposalWorkflowState =
  | "PRECHECKED" | "BONDED" | "REVISION_REQUIRED" | "RESOLVER_DEPLOYING"
  | "RESOLVER_FINALIZED" | "BASE_BOUND" | "BOND_REFUNDED" | "REJECTED" | "TIMED_OUT";

export interface ProposalWorkflowRecord {
  proposalId: string;
  proposer: `0x${string}`;
  idempotencyKey: string;
  state: ProposalWorkflowState;
  revisions: number;
  resolverTxId?: string;
  baseMarket?: `0x${string}`;
}

export interface ProposalBondClient {
  lock(proposalId: string, proposer: `0x${string}`): Promise<void>;
  recordRevision(proposalId: string): Promise<void>;
  approve(proposalId: string): Promise<void>;
  bindMarket(proposalId: string, baseMarket: `0x${string}`): Promise<void>;
  rejectOrdinary(proposalId: string): Promise<void>;
  retainForAbuse(proposalId: string): Promise<void>;
  timeoutRefund(proposalId: string): Promise<void>;
}

export interface ProposalWorkflowStore {
  load(proposalId: string): Promise<ProposalWorkflowRecord | null>;
  createIfAbsent(record: ProposalWorkflowRecord): Promise<ProposalWorkflowRecord>;
  save(proposalId: string, patch: Partial<ProposalWorkflowRecord>): Promise<ProposalWorkflowRecord>;
}

export async function beginProposal(
  store: ProposalWorkflowStore,
  bond: ProposalBondClient,
  input: { proposalId: string; proposer: `0x${string}`; idempotencyKey: string; precheckPassed: boolean },
): Promise<ProposalWorkflowRecord> {
  const existing = await store.load(input.proposalId);
  if (existing) return existing;
  if (!input.precheckPassed) {
    return store.createIfAbsent({ ...input, state: "PRECHECKED", revisions: 0 });
  }
  await bond.lock(input.proposalId, input.proposer);
  const created = await store.createIfAbsent({ ...input, state: "BONDED", revisions: 0 });
  return created;
}

export async function applyAdmissibility(
  store: ProposalWorkflowStore,
  bond: ProposalBondClient,
  proposalId: string,
  decision: AdmissibilityDecision,
): Promise<ProposalWorkflowRecord> {
  const current = await requireRecord(store, proposalId);
  if (current.state === "BOND_REFUNDED" || current.state === "REJECTED" || current.state === "TIMED_OUT") return current;
  if (decision === "APPROVED") return store.save(proposalId, { state: "RESOLVER_DEPLOYING" });
  if (decision === "NEEDS_REVISION") {
    if (current.revisions >= 2) throw new Error("revision limit reached");
    await bond.recordRevision(proposalId);
    return store.save(proposalId, { revisions: current.revisions + 1, state: "REVISION_REQUIRED" });
  }
  if (current.revisions < 2) throw new Error("ordinary rejection requires allowed revisions");
  await bond.rejectOrdinary(proposalId);
  return store.save(proposalId, { state: "REJECTED" });
}

export async function markResolverFinalized(store: ProposalWorkflowStore, proposalId: string, resolverTxId: string): Promise<ProposalWorkflowRecord> {
  const current = await requireRecord(store, proposalId);
  if (current.state !== "RESOLVER_DEPLOYING") throw new Error("resolver not deploying");
  return store.save(proposalId, { state: "RESOLVER_FINALIZED", resolverTxId });
}

export async function bindBaseMarket(store: ProposalWorkflowStore, bond: ProposalBondClient, proposalId: string, baseMarket: `0x${string}`): Promise<ProposalWorkflowRecord> {
  const current = await requireRecord(store, proposalId);
  if (current.state !== "RESOLVER_FINALIZED") throw new Error("resolver not finalized");
  const bound = await store.save(proposalId, { state: "BASE_BOUND", baseMarket });
  await bond.bindMarket(proposalId, baseMarket);
  await bond.approve(proposalId);
  return store.save(proposalId, { state: "BOND_REFUNDED" });
}

export async function markAbuse(store: ProposalWorkflowStore, bond: ProposalBondClient, proposalId: string): Promise<ProposalWorkflowRecord> {
  const current = await requireRecord(store, proposalId);
  if (["BOND_REFUNDED", "REJECTED", "TIMED_OUT"].includes(current.state)) return current;
  await bond.retainForAbuse(proposalId);
  return store.save(proposalId, { state: "REJECTED" });
}

export async function timeoutProposal(store: ProposalWorkflowStore, bond: ProposalBondClient, proposalId: string): Promise<ProposalWorkflowRecord> {
  const current = await requireRecord(store, proposalId);
  if (["BOND_REFUNDED", "REJECTED", "TIMED_OUT"].includes(current.state)) return current;
  await bond.timeoutRefund(proposalId);
  return store.save(proposalId, { state: "TIMED_OUT" });
}

async function requireRecord(store: ProposalWorkflowStore, proposalId: string): Promise<ProposalWorkflowRecord> {
  const record = await store.load(proposalId);
  if (!record) throw new Error("proposal not found");
  return record;
}
