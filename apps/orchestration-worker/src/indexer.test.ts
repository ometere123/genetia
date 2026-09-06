import { describe, expect, it } from "vitest";
import { chainEventIdentity, findReorgRollbackPoint, indexEvents, rebuildFromDeploymentBlock, rollbackToBlock, type ChainEventInput } from "../../../packages/db/src/indexer.js";
import { GenetiaRepositories } from "../../../packages/db/src/repositories.js";
import { decodeBaseLog } from "../../../packages/db/src/base-events.js";
import { emptyProjection, projectEvents, serialiseProjection } from "../../../packages/db/src/projections.js";
import { BaseIndexer } from "../../../packages/db/src/base-indexer.js";
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
    const rollback = findReorgRollbackPoint(indexed, { deploymentBlock: 20n, nextBlock: 22n, lastBlockHash: second.blockHash }, new Map<bigint, `0x${string}`>([[20n, first.blockHash], [21n, `0x${"aa".repeat(32)}`]]));
    expect(rollback).toBe(20n);
    expect(rollbackToBlock(indexed, rollback!)).toEqual([indexed[0]]);
  });

  it("rebuilds the complete derived projection from the event stream", () => {
    const pool = `0x${"aa".repeat(20)}` as `0x${string}`;
    const factory = `0x${"bb".repeat(20)}` as `0x${string}`;
    const marketId = "0x" + "11".repeat(32);
    const alice = `0x${"cc".repeat(20)}`;
    const events = [
      { ...event(`0x${"10".repeat(32)}`, 0, 1n, { releaseId: "pool-a", implementation: "0x1" }), eventName: "ReleaseRegistered", contractAddress: factory },
      { ...event(`0x${"11".repeat(32)}`, 0, 2n, { marketId, market: pool, releaseId: "pool-a" }), eventName: "PoolCreated", contractAddress: factory },
      { ...event(`0x${"12".repeat(32)}`, 0, 3n, { account: alice, yes: true, amount: "7" }), eventName: "Staked", contractAddress: pool },
      { ...event(`0x${"13".repeat(32)}`, 0, 4n, { outcome: 0, fee: "1" }), eventName: "Settled", contractAddress: pool },
      { ...event(`0x${"14".repeat(32)}`, 0, 5n, { account: alice, amount: "8" }), eventName: "Claimed", contractAddress: pool },
    ];
    const expected = serialiseProjection(projectEvents(indexEvents([], events)));
    const destroyed = emptyProjection();
    expect(serialiseProjection(projectEvents(indexEvents([], events)))).toBe(expected);
    expect(serialiseProjection(destroyed)).not.toBe(expected);
    expect(JSON.parse(expected).markets[marketId].positions[alice].yes).toBe("7");
  });

  it("replays a replacement canonical block after rollback", () => {
    const pool = `0x${"dd".repeat(20)}` as `0x${string}`;
    const marketId = "0x" + "22".repeat(32);
    const created = { ...event(`0x${"20".repeat(32)}`, 0, 10n, { marketId, market: pool, releaseId: "pool-a" }), eventName: "PoolCreated", contractAddress: `0x${"ee".repeat(20)}` as `0x${string}` };
    const orphan = { ...event(`0x${"21".repeat(32)}`, 0, 11n, { account: `0x${"01".repeat(20)}`, yes: true, amount: "3" }), eventName: "Staked", contractAddress: pool, blockHash: `0x${"ef".repeat(32)}` as `0x${string}` };
    const replacement = { ...orphan, transactionHash: `0x${"22".repeat(32)}` as `0x${string}`, blockHash: `0x${"f0".repeat(32)}` as `0x${string}`, payload: { account: `0x${"01".repeat(20)}`, yes: false, amount: "4" } };
    const indexed = indexEvents([], [created, orphan]);
    const rollback = findReorgRollbackPoint(indexed, { deploymentBlock: 10n, nextBlock: 12n, lastBlockHash: orphan.blockHash }, new Map<bigint, `0x${string}`>([[10n, created.blockHash], [11n, replacement.blockHash]]));
    const rebuilt = projectEvents(indexEvents([], [...rollbackToBlock(indexed, rollback!), replacement]));
    expect(rebuilt.markets[marketId].positions[`0x${"01".repeat(20)}`]).toMatchObject({ yes: 0n, no: 4n });
  });

  it("reads a bounded RPC batch, decodes logs, persists them, and advances the cursor", async () => {
    const account = `0x${"11".repeat(20)}` as `0x${string}`;
    const signature = keccak256(toBytes("Staked(address,bool,uint256)"));
    const indexed = encodeAbiParameters(parseAbiParameters(["address", "bool"]), [account, true]);
    const client = {
      getBlockNumber: async () => 12n,
      getBlock: async () => ({ hash: `0x${"55".repeat(32)}` as `0x${string}` }),
      getLogs: async () => [{ address: `0x${"22".repeat(20)}` as `0x${string}`, topics: [signature, `0x${indexed.slice(2, 66)}`, `0x${indexed.slice(66)}`] as [`0x${string}`, ...`0x${string}`[]], data: encodeAbiParameters(parseAbiParameters(["uint256"]), [9n]), transactionHash: `0x${"33".repeat(32)}` as `0x${string}`, blockHash: `0x${"44".repeat(32)}` as `0x${string}`, blockNumber: 12n, transactionIndex: 2, logIndex: 0 }],
    };
    const persisted: ChainEventInput[] = []; let advanced: unknown;
    const indexer = new BaseIndexer({ rpcUrl: "http://unused", deploymentBlock: 10n, batchSize: 3n, client, store: { cursor: async () => ({ deploymentBlock: 10n, nextBlock: 10n, lastBlockHash: null }), persistEvents: async (events) => persisted.push(...events), advanceCursor: async (value) => { advanced = value; } } });
    await expect(indexer.runOnce()).resolves.toMatchObject({ fromBlock: 10n, toBlock: 12n, decoded: 1 });
    expect(persisted[0]?.eventName).toBe("Staked");
    expect(persisted[0]?.transactionIndex).toBe(2);
    expect(advanced).toMatchObject({ nextBlock: 13n, lastBlockHash: `0x${"55".repeat(32)}` });
  });

  it("persists only rebuildable projection records", async () => {
    const calls: string[] = [];
    const fake = { $transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
      derivedProjection: {
        deleteMany: async () => { calls.push("delete"); },
        createMany: async (args: { data: unknown[] }) => { calls.push(`create:${args.data.length}`); },
      },
    }) } as never;
    const repository = new GenetiaRepositories(fake);
    const marketId = "0x" + "33".repeat(32);
    const projected = projectEvents(indexEvents([], [{ ...event(`0x${"30".repeat(32)}`, 0, 1n, { marketId, market: `0x${"44".repeat(20)}`, releaseId: "pool-a" }), eventName: "PoolCreated", contractAddress: `0x${"55".repeat(20)}` }]));
    await expect(repository.replaceProjection(projected)).resolves.toBe(2);
    expect(calls).toEqual(["delete", "create:2"]);
  });
});
