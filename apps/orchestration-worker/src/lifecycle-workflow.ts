import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { expectedJobKey, validateQueueJob, type QueueJob } from "./queue-jobs";
import { Client } from "pg";
import { createStudioAdmissibilityClient, followAdmissibility, submitAdmissibilityOnce, type AdmissibilityStore } from "./admissibility-lifecycle";
import { reconcileDueLifecycleIntents } from "./reconcile-due";
import { createPgIndexerStore, runBaseIndexJob } from "./base-index-workflow";
import type { Address, Hex } from "viem";

// A Workflow instance must not spend one step per 30 seconds for the whole
// protocol timeout.  The durable outbox/reconciler resumes this operation
// after this bounded observation window using the persisted nextRunAt state.
const ADMISSIBILITY_POLL_SCHEDULE = [
  "30 seconds", "30 seconds", "1 minute", "1 minute",
  "5 minutes", "5 minutes", "15 minutes", "30 minutes", "1 hour",
] as const;

export interface LifecycleWorkflowEnv {
  GENETIA_DB: Hyperdrive;
  GENETIA_JOBS: Queue;
  GENETIA_DLQ: Queue;
  GENLAYER_RPC: string;
  GENLAYER_PRIVATE_KEY?: Hex;
  MARKET_ADMISSIBILITY_ADDRESS?: Address;
  BASE_RPC: string;
  BASE_DEPLOYMENT_BLOCK: string;
}

/** Durable entry point. Each side effect belongs in a named step so a restart
 * resumes from the recorded step instead of replaying financial actions. */
export class GenetiaLifecycleWorkflow extends WorkflowEntrypoint<LifecycleWorkflowEnv, QueueJob> {
  async run(event: WorkflowEvent<QueueJob>, step: WorkflowStep): Promise<unknown> {
    const payload = validateQueueJob(event.payload);
    const workflowKey = expectedJobKey(payload);
    const initial = await step.do(`durable:${workflowKey}`, async () => {
      if (!this.env.GENETIA_DB) throw new Error("Hyperdrive binding is required for lifecycle persistence");
      const dbClient = new Client({ connectionString: this.env.GENETIA_DB.connectionString });
      try {
        await dbClient.connect();
        // Workflow delivery is at-least-once. The primary key makes replay,
        // queue redelivery, and workflow restarts converge on one operation.
        await dbClient.query(
          `INSERT INTO "genetia_app"."WorkflowState" ("idempotencyKey", "workflowType", "externalId", "state", "payload", "attempts", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 'RUNNING', $4::jsonb, 1, now(), now())
           ON CONFLICT ("idempotencyKey") DO UPDATE SET
             "attempts" = "genetia_app"."WorkflowState"."attempts" + 1,
             "state" = CASE WHEN "genetia_app"."WorkflowState"."state" IN ('COMPLETE','FAILED') THEN "genetia_app"."WorkflowState"."state" ELSE 'RUNNING' END,
             "nextRunAt" = NULL,
             "updatedAt" = now()`,
          [workflowKey, payload.kind, "proposalId" in payload ? payload.proposalId : "marketId" in payload ? payload.marketId : null, JSON.stringify(payload)],
        );
        if (payload.kind === "reconcile-due-markets") {
          const store = {
            async claimDue(now: Date, leaseUntil: Date, limit: number) {
              const connection = dbClient;
              try {
                await connection.query("BEGIN");
                const result = await connection.query(
                  `SELECT "idempotencyKey","nextRunAt","payload" FROM "genetia_app"."WorkflowState"
                   WHERE "workflowType"='MARKET_ADMISSIBILITY'
                     AND "state" IN ('RETRY','RECONCILE_CLAIMED') AND "nextRunAt" <= $1
                   ORDER BY "nextRunAt" FOR UPDATE SKIP LOCKED LIMIT $2`,
                  [now, limit],
                );
                for (const row of result.rows) await connection.query(
                  `UPDATE "genetia_app"."WorkflowState" SET "state"='RECONCILE_CLAIMED',"nextRunAt"=$2,"updatedAt"=now() WHERE "idempotencyKey"=$1`,
                  [row.idempotencyKey, leaseUntil],
                );
                await connection.query("COMMIT");
                return result.rows.map((row) => ({ idempotencyKey: String(row.idempotencyKey), nextRunAt: new Date(row.nextRunAt), payload: row.payload }));
              } catch (error) {
                await connection.query("ROLLBACK");
                throw error;
              } finally { }
            },
            async releaseForRetry(idempotencyKey: string, retryAt: Date, error: string) {
              await dbClient.query(
                `UPDATE "genetia_app"."WorkflowState" SET "state"='RETRY',"nextRunAt"=$2,"lastError"=$3,"updatedAt"=now() WHERE "idempotencyKey"=$1`,
                [idempotencyKey, retryAt, error],
              );
            },
          };
          const dispatched = await reconcileDueLifecycleIntents(store, this.env.GENETIA_JOBS, new Date());
          return { idempotencyKey: payload.idempotencyKey, workflowKey, kind: payload.kind, persisted: true, ...dispatched };
        }
        if (payload.kind === "base-index") {
          if (!this.env.BASE_RPC || !/^\d+$/.test(this.env.BASE_DEPLOYMENT_BLOCK)) throw new Error("Base indexer RPC/deployment block is not configured");
          const store = createPgIndexerStore(dbClient);
          const result = await runBaseIndexJob(
            { rpcUrl: this.env.BASE_RPC, deploymentBlock: BigInt(this.env.BASE_DEPLOYMENT_BLOCK), finalityConfirmations: 64n, idempotencyKey: payload.idempotencyKey },
            { store, queue: this.env.GENETIA_JOBS },
          );
          await dbClient.query(`UPDATE "genetia_app"."WorkflowState" SET "state"='COMPLETE',"nextRunAt"=NULL,"lastError"=NULL,"payload"="payload" || $2::jsonb,"updatedAt"=now() WHERE "idempotencyKey"=$1`, [workflowKey, JSON.stringify({ indexedThrough: result.toBlock.toString(), decoded: result.decoded, scheduledContinuation: result.scheduledContinuation })]);
          return { idempotencyKey: payload.idempotencyKey, workflowKey, kind: payload.kind, persisted: true, ...result, toBlock: result.toBlock.toString(), nextBlock: result.nextBlock.toString() };
        }
        if (payload.kind !== "market-admissibility") {
          return { idempotencyKey: payload.idempotencyKey, workflowKey, kind: payload.kind, persisted: true };
        }
        if (!this.env.GENLAYER_PRIVATE_KEY || !this.env.MARKET_ADMISSIBILITY_ADDRESS) {
          throw new Error("MarketAdmissibility signer or release is not configured");
        }
        const proposal = await dbClient.query(
          `SELECT "canonicalTerms" FROM "genetia_app"."Proposal" WHERE "proposalId" = $1 LIMIT 1`,
          [payload.proposalId],
        );
        const terms = proposal.rows[0]?.canonicalTerms;
        if (!terms) throw new Error("durable proposal terms were not found");
        const store: AdmissibilityStore = {
          async createIfAbsent(value) {
            const existing = await dbClient.query(`SELECT "state","externalId","payload" FROM "genetia_app"."WorkflowState" WHERE "idempotencyKey" = $1`, [value.operationId]);
            if (existing.rows[0]) {
              const body = (existing.rows[0].payload ?? {}) as Record<string, unknown>;
              return { ...value, ...body, lifecycle: String(existing.rows[0].state ?? body.lifecycle ?? "READY") as never, txId: existing.rows[0].externalId ? String(existing.rows[0].externalId) as never : undefined };
            }
            const durableValue = { ...value, startedAt: new Date().toISOString() };
            await dbClient.query(`INSERT INTO "genetia_app"."WorkflowState" ("idempotencyKey","workflowType","externalId","state","payload","createdAt","updatedAt") VALUES ($1,'MARKET_ADMISSIBILITY',$2,'READY',$3::jsonb,now(),now()) ON CONFLICT DO NOTHING`, [value.operationId, value.proposalId, JSON.stringify(durableValue)]);
            const inserted = await dbClient.query(`SELECT "state","externalId","payload" FROM "genetia_app"."WorkflowState" WHERE "idempotencyKey"=$1`, [value.operationId]);
            const body = (inserted.rows[0]?.payload ?? durableValue) as Record<string, unknown>;
            return { ...value, ...body, lifecycle: String(inserted.rows[0]?.state ?? "READY") as never };
          },
          async load(operationId) {
            const result = await dbClient.query(`SELECT "state","externalId","payload" FROM "genetia_app"."WorkflowState" WHERE "idempotencyKey" = $1`, [operationId]);
            const row = result.rows[0]; if (!row) return null;
            const payloadValue = (row.payload ?? {}) as Record<string, unknown>;
            return { proposalId: String(payloadValue.proposalId ?? payload.proposalId), operationId, lifecycle: String(row.state ?? "READY") as never, txId: row.externalId ? String(row.externalId) as never : undefined };
          },
          async claimSubmission(operationId) {
            const result = await dbClient.query(`UPDATE "genetia_app"."WorkflowState" SET "state"='SUBMITTING', "attempts"="attempts"+1, "updatedAt"=now() WHERE "idempotencyKey"=$1 AND "state" IN ('READY','PENDING') AND "externalId" IS NULL`, [operationId]);
            return (result.rowCount ?? 0) === 1;
          },
          async persistSubmission(operationId, txId) {
            await dbClient.query(`UPDATE "genetia_app"."WorkflowState" SET "externalId"=$2, "state"='SUBMITTED', "updatedAt"=now() WHERE "idempotencyKey"=$1`, [operationId, txId]);
          },
          async persistObservation(operationId, observation) {
            await dbClient.query(`UPDATE "genetia_app"."WorkflowState" SET "state"=CASE WHEN $2 IN ('PROCESSING','ACCEPTED','SUBMITTED') THEN 'RETRY' ELSE $2 END, "nextRunAt"=CASE WHEN $2 IN ('PROCESSING','ACCEPTED','SUBMITTED') THEN now() + interval '1 hour' ELSE NULL END, "payload"="payload" || $3::jsonb, "updatedAt"=now() WHERE "idempotencyKey"=$1`, [operationId, observation.lifecycle, JSON.stringify(observation)]);
            if (observation.decision) {
              await dbClient.query(
                `UPDATE "genetia_app"."Proposal"
                 SET "genlayerTxId"=(SELECT "externalId" FROM "genetia_app"."WorkflowState" WHERE "idempotencyKey"=$1),
                     "genlayerStatus"=$2,
                     "decision"=$3,
                     "decisionIssueCodes"=$4,
                     "workflowStatus"=CASE
                       WHEN $3='APPROVED' THEN 'ACTIVATING'
                       WHEN $3='NEEDS_REVISION' THEN 'REVISION_REQUIRED'
                       WHEN $3='REJECTED' THEN 'DISPOSITION_PENDING'
                       ELSE 'WAITING_FINALITY'
                     END,
                     "updatedAt"=now()
                 WHERE "proposalId"=$5`,
                [operationId, observation.lifecycle, observation.decision, observation.issues ?? [], payload.proposalId],
              );
            } else if (observation.lifecycle === "FAILED") {
              await dbClient.query(`UPDATE "genetia_app"."Proposal" SET "genlayerStatus"='FAILED', "workflowStatus"='FAILED', "updatedAt"=now() WHERE "proposalId"=$1`, [payload.proposalId]);
            } else if (observation.lifecycle === "FINALIZED") {
              await dbClient.query(`UPDATE "genetia_app"."Proposal" SET "genlayerStatus"='FINALIZED', "workflowStatus"='WAITING_FINALITY', "updatedAt"=now() WHERE "proposalId"=$1`, [payload.proposalId]);
            } else {
              await dbClient.query(`UPDATE "genetia_app"."Proposal" SET "genlayerStatus"=$2, "workflowStatus"='WAITING_FINALITY', "updatedAt"=now() WHERE "proposalId"=$1`, [payload.proposalId, observation.lifecycle]);
            }
          },
          async deferSubmissionRecovery(operationId, retryAt, reason) {
            await dbClient.query(
              `UPDATE "genetia_app"."WorkflowState" SET "state"='RETRY',"nextRunAt"=$2,"lastError"=$3,
                 "payload"="payload" || '{"submissionRecoveryRequired":true}'::jsonb,"updatedAt"=now()
               WHERE "idempotencyKey"=$1 AND "externalId" IS NULL`,
              [operationId, retryAt, reason],
            );
            await dbClient.query(`UPDATE "genetia_app"."Proposal" SET "genlayerStatus"='SUBMITTING',"workflowStatus"='WAITING_FINALITY',"updatedAt"=now() WHERE "proposalId"=$1`, [payload.proposalId]);
          },
        };
        const client = createStudioAdmissibilityClient({ GENLAYER_RPC: this.env.GENLAYER_RPC, GENLAYER_PRIVATE_KEY: this.env.GENLAYER_PRIVATE_KEY, MARKET_ADMISSIBILITY_ADDRESS: this.env.MARKET_ADMISSIBILITY_ADDRESS });
        let txId;
        try {
          txId = await submitAdmissibilityOnce(client, store, { proposalId: payload.proposalId, contract: this.env.MARKET_ADMISSIBILITY_ADDRESS, manifest: typeof terms === "string" ? terms : JSON.stringify(terms) });
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("submission outcome is uncertain")) throw error;
          await store.deferSubmissionRecovery?.(`admissibility:${payload.proposalId}`, new Date(Date.now() + 60_000), "remote submission requires address-history reconciliation");
          return { idempotencyKey: payload.idempotencyKey, workflowKey, kind: payload.kind, persisted: true, state: "WAITING_SUBMISSION_RECOVERY" };
        }
        const observation = await followAdmissibility(client, store, payload.proposalId);
        return { idempotencyKey: payload.idempotencyKey, workflowKey, kind: payload.kind, persisted: true, txId, state: observation.lifecycle, decision: observation.decision };
      } finally {
        await dbClient.end();
      }
    });
    if (payload.kind !== "market-admissibility" || initial.decision || initial.state === "FAILED" || initial.state === "WAITING_SUBMISSION_RECOVERY") return initial;
    let current: any = initial;
    for (let poll = 0; poll < ADMISSIBILITY_POLL_SCHEDULE.length && !current.decision && current.state !== "FAILED"; poll += 1) {
      await step.sleep(`admissibility-finality-wait:${workflowKey}:${poll}`, ADMISSIBILITY_POLL_SCHEDULE[poll]);
      current = await step.do(`admissibility-finality-poll:${workflowKey}:${poll}`, async () => {
        if (!this.env.GENETIA_DB || !this.env.GENLAYER_PRIVATE_KEY || !this.env.MARKET_ADMISSIBILITY_ADDRESS) throw new Error("admissibility continuation is not configured");
        const dbClient = new Client({ connectionString: this.env.GENETIA_DB.connectionString });
        try {
          await dbClient.connect();
          const store: AdmissibilityStore = {
            async createIfAbsent(value) { return value; },
            async load(operationId) {
              const row = (await dbClient.query(`SELECT "state","externalId","payload" FROM "genetia_app"."WorkflowState" WHERE "idempotencyKey"=$1`, [operationId])).rows[0];
              if (!row) return null;
              const body = (row.payload ?? {}) as Record<string, unknown>;
              return { proposalId: String(body.proposalId ?? payload.proposalId), operationId, lifecycle: String(row.state ?? "READY") as never, txId: row.externalId ? String(row.externalId) as never : undefined };
            },
            async persistSubmission() { throw new Error("finality poll cannot submit"); },
            async persistObservation(operationId, observation) {
              await dbClient.query(`UPDATE "genetia_app"."WorkflowState" SET "state"=CASE WHEN $2 IN ('PROCESSING','ACCEPTED','SUBMITTED') THEN 'RETRY' ELSE $2 END,"nextRunAt"=CASE WHEN $2 IN ('PROCESSING','ACCEPTED','SUBMITTED') THEN now() + interval '1 hour' ELSE NULL END,"payload"="payload" || $3::jsonb,"updatedAt"=now() WHERE "idempotencyKey"=$1`, [operationId, observation.lifecycle, JSON.stringify(observation)]);
              if (observation.decision) await dbClient.query(`UPDATE "genetia_app"."Proposal" SET "genlayerStatus"=$2,"decision"=$3,"decisionIssueCodes"=$4,"workflowStatus"=CASE WHEN $3='APPROVED' THEN 'ACTIVATING' WHEN $3='NEEDS_REVISION' THEN 'REVISION_REQUIRED' WHEN $3='REJECTED' THEN 'DISPOSITION_PENDING' ELSE 'WAITING_FINALITY' END,"updatedAt"=now() WHERE "proposalId"=$5`, [operationId, observation.lifecycle, observation.decision, observation.issues ?? [], payload.proposalId]);
              else await dbClient.query(`UPDATE "genetia_app"."Proposal" SET "genlayerStatus"=$2,"workflowStatus"=CASE WHEN $2='FAILED' THEN 'FAILED' ELSE 'WAITING_FINALITY' END,"updatedAt"=now() WHERE "proposalId"=$1`, [payload.proposalId, observation.lifecycle]);
            },
          };
          const client = createStudioAdmissibilityClient({ GENLAYER_RPC: this.env.GENLAYER_RPC, GENLAYER_PRIVATE_KEY: this.env.GENLAYER_PRIVATE_KEY, MARKET_ADMISSIBILITY_ADDRESS: this.env.MARKET_ADMISSIBILITY_ADDRESS });
          const observation = await followAdmissibility(client, store, payload.proposalId);
          return { ...initial, state: observation.lifecycle, decision: observation.decision };
        } finally { await dbClient.end(); }
      });
    }
    if (!current.decision && current.state !== "FAILED") return { ...current, state: "WAITING_FINALITY", nextRunAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    return current;
  }
}
