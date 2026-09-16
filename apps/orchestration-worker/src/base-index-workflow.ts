import { BaseIndexer, type IndexerStore } from "../../../packages/db/src/base-indexer.js";
import type { QueueJob } from "./queue-jobs";

type Indexer = Pick<BaseIndexer, "runOnce">;
type Queue = { send(message: QueueJob): Promise<unknown> };

/** Runs one bounded finalized-log batch and durably schedules the next batch.
 * Queue/workflow delivery is at-least-once; range identity and DB uniqueness
 * make replay safe. */
export async function runBaseIndexJob(
  input: { rpcUrl: string; deploymentBlock: bigint; finalityConfirmations: bigint; idempotencyKey: string },
  dependencies: { store: IndexerStore; queue: Queue; indexer?: Indexer },
) {
  const indexer = dependencies.indexer ?? new BaseIndexer({
    rpcUrl: input.rpcUrl,
    deploymentBlock: input.deploymentBlock,
    finalityConfirmations: input.finalityConfirmations,
    store: dependencies.store,
  });
  const batch = await indexer.runOnce();
  const nextBlock = batch.toBlock + 1n;
  if (!batch.caughtUp) {
    await dependencies.queue.send({
      kind: "base-index",
      chainId: 84532,
      fromBlock: nextBlock.toString(),
      idempotencyKey: `base-index:84532:${nextBlock}`,
    });
  }
  return { ...batch, nextBlock, scheduledContinuation: !batch.caughtUp };
}

export function createPgIndexerStore(pool: {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}): IndexerStore {
  return {
    async cursor(chainId) {
      const result = await pool.query(
        `SELECT "deploymentBlock", "nextBlock", "lastBlockHash" FROM "genetia_app"."IndexerCursor" WHERE "chainId"=$1`,
        [chainId],
      );
      const row = result.rows[0];
      return row ? {
        deploymentBlock: BigInt(String(row.deploymentBlock)),
        nextBlock: BigInt(String(row.nextBlock)),
        lastBlockHash: row.lastBlockHash === null || row.lastBlockHash === undefined ? null : String(row.lastBlockHash),
      } : null;
    },
    async persistEvents(events) {
      if (!events.length) return;
      const records = events.map((event) => ({
        chainId: event.chainId,
        transactionHash: event.transactionHash,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber.toString(),
        blockHash: event.blockHash,
        transactionIndex: event.transactionIndex ?? null,
        contractAddress: event.contractAddress,
        eventName: event.eventName,
        payload: event.payload,
      }));
      await pool.query(
        `INSERT INTO "genetia_app"."ChainEvent"
          ("chainId","transactionHash","logIndex","blockNumber","blockHash","transactionIndex","contractAddress","eventName","payload")
         SELECT e."chainId",e."transactionHash",e."logIndex",e."blockNumber",e."blockHash",e."transactionIndex",e."contractAddress",e."eventName",e."payload"
         FROM jsonb_to_recordset($1::jsonb) AS e(
           "chainId" integer,"transactionHash" text,"logIndex" integer,"blockNumber" bigint,"blockHash" text,
           "transactionIndex" integer,"contractAddress" text,"eventName" text,"payload" jsonb)
         ON CONFLICT ("chainId","transactionHash","logIndex") DO NOTHING`,
        [JSON.stringify(records)],
      );
    },
    async advanceCursor(cursor) {
      // Out-of-order overlapping jobs can never move the shared cursor back.
      await pool.query(
        `INSERT INTO "genetia_app"."IndexerCursor" ("chainId","deploymentBlock","nextBlock","lastBlockHash","updatedAt")
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT ("chainId") DO UPDATE SET "nextBlock"=EXCLUDED."nextBlock", "lastBlockHash"=EXCLUDED."lastBlockHash", "updatedAt"=now()
         WHERE "genetia_app"."IndexerCursor"."nextBlock" < EXCLUDED."nextBlock"`,
        [cursor.chainId, cursor.deploymentBlock.toString(), cursor.nextBlock.toString(), cursor.lastBlockHash],
      );
    },
  };
}
