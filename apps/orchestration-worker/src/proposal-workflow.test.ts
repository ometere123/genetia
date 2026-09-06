import { describe, expect, it } from "vitest";
import { applyAdmissibility, beginProposal, bindBaseMarket, markAbuse, markResolverFinalized, timeoutProposal, type ProposalBondClient, type ProposalWorkflowRecord, type ProposalWorkflowStore } from "./proposal-workflow";

class MemoryStore implements ProposalWorkflowStore {
  records = new Map<string, ProposalWorkflowRecord>();
  async load(id: string) { return this.records.get(id) ?? null; }
  async createIfAbsent(record: ProposalWorkflowRecord) { const current = this.records.get(record.proposalId); if (current) return current; this.records.set(record.proposalId, record); return record; }
  async save(id: string, patch: Partial<ProposalWorkflowRecord>) { const current = this.records.get(id)!; const next = { ...current, ...patch }; this.records.set(id, next); return next; }
}

class BondSpy implements ProposalBondClient {
  calls: string[] = [];
  async lock() { this.calls.push("lock"); }
  async recordRevision() { this.calls.push("revision"); }
  async approve() { this.calls.push("approve"); }
  async bindMarket() { this.calls.push("bind"); }
  async rejectOrdinary() { this.calls.push("ordinary"); }
  async retainForAbuse() { this.calls.push("abuse"); }
  async timeoutRefund() { this.calls.push("timeout"); }
}

const input = { proposalId: "p1", proposer: "0x0000000000000000000000000000000000000001" as `0x${string}`, idempotencyKey: "proposal:p1:bond", precheckPassed: true };

describe("proposal bond workflow", () => {
  it("locks once and refunds only after finalized resolver and Base binding", async () => {
    const store = new MemoryStore(); const bond = new BondSpy();
    await beginProposal(store, bond, input); await beginProposal(store, bond, input);
    expect(bond.calls).toEqual(["lock"]);
    await applyAdmissibility(store, bond, "p1", "APPROVED");
    await markResolverFinalized(store, "p1", "0xtx");
    await bindBaseMarket(store, bond, "p1", "0x0000000000000000000000000000000000000002");
    expect(bond.calls).toEqual(["lock", "bind", "approve"]);
    expect((await store.load("p1"))?.state).toBe("BOND_REFUNDED");
  });

  it("keeps bond locked through two revisions then splits ordinary rejection", async () => {
    const store = new MemoryStore(); const bond = new BondSpy(); await beginProposal(store, bond, input);
    await applyAdmissibility(store, bond, "p1", "NEEDS_REVISION"); await applyAdmissibility(store, bond, "p1", "NEEDS_REVISION");
    expect((await store.load("p1"))?.state).toBe("REVISION_REQUIRED");
    await applyAdmissibility(store, bond, "p1", "REJECTED"); expect(bond.calls).toEqual(["lock", "revision", "revision", "ordinary"]);
  });

  it("supports deterministic abuse retention and infrastructure timeout refund", async () => {
    const abuseStore = new MemoryStore(); const abuse = new BondSpy(); await beginProposal(abuseStore, abuse, input); await markAbuse(abuseStore, abuse, "p1"); expect(abuse.calls).toEqual(["lock", "abuse"]);
    const timeoutStore = new MemoryStore(); const timeout = new BondSpy(); await beginProposal(timeoutStore, timeout, input); await timeoutProposal(timeoutStore, timeout, "p1"); expect(timeout.calls).toEqual(["lock", "timeout"]);
  });
});
