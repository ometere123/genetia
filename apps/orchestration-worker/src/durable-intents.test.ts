import { describe, expect, it } from "vitest";
import { dispatchIntent, proposalAdmissibilityIntent, reconcileIntents, type DurableIntent, type DurableIntentStore } from "./durable-intents";

class Store implements DurableIntentStore {
  rows = new Map<string, DurableIntent>();
  failMark = false;
  async load(key: string) { return this.rows.get(key) ?? null; }
  async listDue() { return [...this.rows.values()].filter((row) => row.state !== "DISPATCHED"); }
  async claim(key: string, now: number, leaseMs: number) {
    const row = this.rows.get(key);
    if (!row) return false;
    if (row.state === "DISPATCHED") return false;
    if (row.state === "CLAIMED" && (row.leaseUntil ?? 0) > now) return false;
    row.state = "CLAIMED"; row.leaseUntil = now + leaseMs; row.attempts++;
    return true;
  }
  async markDispatched(key: string) { if (this.failMark) throw new Error("crash after queue send"); this.rows.get(key)!.state = "DISPATCHED"; }
  async markRetry(key: string, nextRunAt: number, error: string) { const row = this.rows.get(key)!; row.state = "RETRY"; row.leaseUntil = nextRunAt; row.payload = { ...row.payload, idempotencyKey: row.payload.idempotencyKey }; void error; }
}

describe("durable proposal outbox dispatch", () => {
  it("uses one deterministic admissibility intent and is duplicate-safe", async () => {
    const store = new Store(); const queue = { sends: 0, send: async () => { queue.sends++; } };
    const intent = proposalAdmissibilityIntent("0xproposal"); store.rows.set(intent.idempotencyKey, intent);
    await expect(dispatchIntent(store, queue, intent, 1)).resolves.toBe("dispatched");
    await expect(dispatchIntent(store, queue, intent, 2)).resolves.toBe("duplicate");
    expect(queue.sends).toBe(1);
  });

  it("releases a retryable intent when enqueue fails", async () => {
    const store = new Store(); const intent = proposalAdmissibilityIntent("p2"); store.rows.set(intent.idempotencyKey, intent);
    await expect(dispatchIntent(store, { send: async () => { throw new Error("queue unavailable"); } }, intent, 100)).rejects.toThrow("queue unavailable");
    expect((await store.load(intent.idempotencyKey))?.state).toBe("RETRY");
  });

  it("prevents two consumers from holding the same live lease", async () => {
    const store = new Store(); const intent = proposalAdmissibilityIntent("p3"); store.rows.set(intent.idempotencyKey, intent);
    const queue = { send: async () => { await new Promise((resolve) => setTimeout(resolve, 1)); } };
    const result = await Promise.all([dispatchIntent(store, queue, intent, 100), dispatchIntent(store, queue, intent, 100)]);
    expect(result.filter((value) => value === "dispatched")).toHaveLength(1);
    expect(result.filter((value) => value === "busy")).toHaveLength(1);
  });

  it("reconciles an undispatched intent after the original enqueue failure", async () => {
    const store = new Store(); const intent = proposalAdmissibilityIntent("p4"); store.rows.set(intent.idempotencyKey, intent);
    await expect(dispatchIntent(store, { send: async () => { throw new Error("temporary"); } }, intent, 100)).rejects.toThrow();
    const sent: string[] = [];
    await expect(reconcileIntents(store, { send: async (payload) => { sent.push(payload.idempotencyKey); } }, 120_000)).resolves.toBe(1);
    expect(sent).toEqual([intent.idempotencyKey]);
  });

  it("does not accept a payload whose key differs from the persisted intent", async () => {
    const store = new Store(); const intent = proposalAdmissibilityIntent("p5"); store.rows.set(intent.idempotencyKey, intent);
    const bad = { ...intent, idempotencyKey: "other" };
    await expect(dispatchIntent(store, { send: async () => undefined }, bad)).rejects.toThrow("intent key");
  });
});
