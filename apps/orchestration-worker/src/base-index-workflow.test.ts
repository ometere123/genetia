import { describe, expect, it } from "vitest";
import { createPgIndexerStore, runBaseIndexJob } from "./base-index-workflow";

describe("Base index Workflow continuation", () => {
  it("continues bounded ingestion with a deterministic next-range identity", async () => {
    const sent: unknown[] = [];
    const result = await runBaseIndexJob(
      { rpcUrl: "https://base.example", deploymentBlock: 100n, finalityConfirmations: 64n, idempotencyKey: "cron:one" },
      {
        store: { cursor: async () => null, persistEvents: async () => undefined },
        queue: { send: async (message) => { sent.push(message); } },
        indexer: { runOnce: async () => ({ fromBlock: 100n, toBlock: 2099n, decoded: 4, caughtUp: false }) },
      },
    );
    expect(result).toMatchObject({ toBlock: 2099n, nextBlock: 2100n, scheduledContinuation: true });
    expect(sent).toEqual([{ kind: "base-index", chainId: 84532, fromBlock: "2100", idempotencyKey: "base-index:84532:2100" }]);
  });

  it("does not enqueue when the finalized head is caught up", async () => {
    const sent: unknown[] = [];
    await runBaseIndexJob(
      { rpcUrl: "https://base.example", deploymentBlock: 100n, finalityConfirmations: 64n, idempotencyKey: "cron:two" },
      {
        store: { cursor: async () => null, persistEvents: async () => undefined },
        queue: { send: async (message) => { sent.push(message); } },
        indexer: { runOnce: async () => ({ fromBlock: 100n, toBlock: 199n, decoded: 0, caughtUp: true }) },
      },
    );
    expect(sent).toEqual([]);
  });

  it("stores decoded events idempotently and advances the cursor monotonically", async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const store = createPgIndexerStore({ query: async (text, values) => { calls.push({ text, values }); return { rows: [] }; } });
    await store.persistEvents([{
      chainId: 84532,
      transactionHash: `0x${"11".repeat(32)}`,
      logIndex: 2,
      blockNumber: 123n,
      blockHash: `0x${"22".repeat(32)}`,
      contractAddress: `0x${"33".repeat(20)}`,
      eventName: "PoolCreated",
      payload: { marketId: `0x${"44".repeat(32)}` },
    }]);
    await store.advanceCursor!({ chainId: 84532, deploymentBlock: 100n, nextBlock: 124n, lastBlockHash: `0x${"22".repeat(32)}` });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain("jsonb_to_recordset");
    expect(calls[0]?.text).toContain("ON CONFLICT (\"chainId\",\"transactionHash\",\"logIndex\") DO NOTHING");
    expect(calls[1]?.text).toContain("WHERE \"genetia_app\".\"IndexerCursor\".\"nextBlock\" < EXCLUDED.\"nextBlock\"");
    expect(JSON.parse(String(calls[0]?.values?.[0]))[0]).toMatchObject({ blockNumber: "123", eventName: "PoolCreated" });
  });
});
