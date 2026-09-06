import { describe, expect, it } from "vitest";
import { chainEventIdentity, indexEvents, rebuildFromDeploymentBlock, type ChainEventInput } from "../../../packages/db/src/indexer.js";

const event = (tx: `0x${string}`, logIndex: number, blockNumber: bigint, payload: Record<string, unknown> = {}): ChainEventInput => ({
  chainId: 84532,
  transactionHash: tx,
  logIndex,
  blockNumber,
  blockHash: `0x${"ab".repeat(32)}`,
  contractAddress: `0x${"cd".repeat(20)}`,
  eventName: "MarketCreated",
  payload,
});

describe("replayable Base event identity", () => {
  it("deduplicates by chain, transaction hash and log index", () => {
    const first = event(`0x${"01".repeat(32)}`, 0, 12n, { amount: "1" });
    const duplicate = event(`0x${"01".repeat(32)}`, 0, 12n, { amount: "999" });
    expect(chainEventIdentity(first)).toBe(`84532:0x${"01".repeat(32)}:0`);
    expect(indexEvents([], [first, duplicate])).toHaveLength(1);
    expect(indexEvents([], [first, duplicate])[0]?.payload).toEqual({ amount: "1" });
  });

  it("keeps distinct logs and deterministically orders a rebuild", () => {
    const a = event(`0x${"02".repeat(32)}`, 1, 14n);
    const b = event(`0x${"03".repeat(32)}`, 0, 13n);
    const beforeDeployment = event(`0x${"04".repeat(32)}`, 0, 9n);
    expect(rebuildFromDeploymentBlock([a, beforeDeployment, b], 10n).map((item) => item.identity)).toEqual([
      chainEventIdentity(b), chainEventIdentity(a),
    ]);
  });
});
