import { describe, expect, it } from "vitest";
import { chainEventIdentity, findReorgRollbackPoint, indexEvents, rebuildFromDeploymentBlock, rollbackToBlock, type ChainEventInput } from "../../../packages/db/src/indexer.js";
import { GenetiaRepositories } from "../../../packages/db/src/repositories.js";
import { decodeBaseLog } from "../../../packages/db/src/base-events.js";
import { encodeAbiParameters, keccak256, parseAbiParameters, toHex, toBytes } from "viem";

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

  it("persists events and advances the cursor transactionally", async () => {
    const calls: unknown[] = [];
    const fake = {
      $transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
        chainEvent: { createMany: async (args: unknown) => calls.push(args) },
        indexerCursor: { upsert: async (args: unknown) => calls.push(args) },
      }),
    } as never;
    const repository = new GenetiaRepositories(fake);
    const item = event(`0x${"05".repeat(32)}`, 0, 20n);
    await expect(repository.persistEvents([item])).resolves.toHaveLength(1);
    expect(calls).toHaveLength(2);
    const serialise = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
    expect(serialise(calls[0])).toContain("skipDuplicates");
    expect(serialise(calls[1])).toContain("nextBlock");
  });

  it("decodes a Solidity event through the ABI and ignores unknown logs", () => {
    const account = `0x${"11".repeat(20)}` as `0x${string}`;
    const signature = keccak256(toBytes("Staked(address,bool,uint256)"));
    const indexed = encodeAbiParameters(parseAbiParameters(["address", "bool"]), [account, true]);
    const amount = encodeAbiParameters(parseAbiParameters(["uint256"]), [123n]);
    const decoded = decodeBaseLog({
      address: `0x${"22".repeat(20)}`, topics: [signature, `0x${indexed.slice(2, 66)}`, `0x${indexed.slice(66)}`], data: amount,
      transactionHash: `0x${"33".repeat(32)}`, blockHash: `0x${"44".repeat(32)}`, blockNumber: 42n, logIndex: 0,
    });
    expect(decoded?.eventName).toBe("Staked");
    expect(decoded?.payload).toMatchObject({ account, yes: true, amount: "123" });
    expect(decodeBaseLog({ address: `0x${"22".repeat(20)}`, topics: [toHex("unknown")], data: "0x", transactionHash: `0x${"33".repeat(32)}`, blockHash: `0x${"44".repeat(32)}`, blockNumber: 42n, logIndex: 1 })).toBeNull();
  });

  it("detects a changed canonical block hash and rolls back only the orphaned suffix", () => {
    const first = event(`0x${"06".repeat(32)}`, 0, 20n);
    const second = { ...event(`0x${"07".repeat(32)}`, 0, 21n), blockHash: `0x${"ef".repeat(32)}` as `0x${string}` };
    const indexed = indexEvents([], [first, second]);
    const rollback = findReorgRollbackPoint(indexed, { deploymentBlock: 20n, nextBlock: 22n, lastBlockHash: second.blockHash }, new Map([[20n, first.blockHash], [21n, `0x${"aa".repeat(32)}`]]));
    expect(rollback).toBe(20n);
    expect(rollbackToBlock(indexed, rollback!)).toEqual([indexed[0]]);
  });
});
