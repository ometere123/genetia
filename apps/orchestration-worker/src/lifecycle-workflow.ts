import { Workflow, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { expectedJobKey, validateQueueJob, type QueueJob } from "./queue-jobs";
import { Pool } from "pg";
import { createStudioAdmissibilityClient, submitAdmissibilityOnce, type AdmissibilityStore } from "./admissibility-lifecycle";
import type { Address, Hex } from "viem";

export interface LifecycleWorkflowEnv {
  GENETIA_DB: Hyperdrive;
  GENETIA_JOBS: Queue;
  GENETIA_DLQ: Queue;
  GENLAYER_RPC: string;
  GENLAYER_PRIVATE_KEY?: Hex;
  MARKET_ADMISSIBILITY_ADDRESS?: Address;
}

/** Durable entry point. Each side effect belongs in a named step so a restart
 * resumes from the recorded step instead of replaying financial actions. */
export class GenetiaLifecycleWorkflow extends Workflow<LifecycleWorkflowEnv, QueueJob> {
  async run(events: Array<WorkflowEvent<QueueJob>>, step: WorkflowStep): Promise<unknown> {
    const payload = validateQueueJob(events.at(-1)?.payload);
    const workflowKey = expectedJobKey(payload);
    return step.do(`durable:${workflowKey}`, async () => {
      if (!this.env.GENETIA_DB) throw new Error("Hyperdrive binding is required for lifecycle persistence");
      const pool = new Pool({ connectionString: this.env.GENETIA_DB.connectionString, max: 1 });
      try {
        // Workflow delivery is at-least-once. The primary key makes replay,
        // queue redelivery, and workflow restarts converge on one operation.
        await pool.query(
          `INSERT INTO "genetia_app"."WorkflowState" ("idempotencyKey", "workflowType", "externalId", "state", "payload", "attempts")
           VALUES ($1, $2, $3, 'RUNNING', $4::jsonb, 1)
           ON CONFLICT ("idempotencyKey") DO UPDATE SET
             "attempts" = "genetia_app"."WorkflowState"."attempts" + 1,
             "state" = CASE WHEN "genetia_app"."WorkflowState"."state" IN ('COMPLETE','FAILED') THEN "genetia_app"."WorkflowState"."state" ELSE 'RUNNING' END,
             "updatedAt" = now()`,
          [workflowKey, payload.kind, "proposalId" in payload ? payload.proposalId : "marketId" in payload ? payload.marketId : null, JSON.stringify(payload)],
        );
        if (payload.kind !== "market-admissibility") {
          return { idempotencyKey: payload.idempotencyKey, workflowKey, kind: payload.kind, persisted: true };
        }
        if (!this.env.GENLAYER_PRIVATE_KEY || !this.env.MARKET_ADMISSIBILITY_ADDRESS) {
          throw new Error("MarketAdmissibility signer or release is not configured");
        }
        const proposal = await pool.query(
          `SELECT "canonicalTerms" FROM "genetia_app"."Proposal" WHERE "proposalId" = $1 LIMIT 1`,
          [payload.proposalId],
        );
        const terms = proposal.rows[0]?.canonicalTerms;
        if (!terms) throw new Error("durable proposal terms were not found");
        const store: AdmissibilityStore = {
          async createIfAbsent(value) {
            const existing = await pool.query(`SELECT "payload" FROM "genetia_app"."WorkflowState" WHERE "idempotencyKey" = $1`, [value.operationId]);
            if (existing.rows[0]) return { ...value, ...(existing.rows[0].payload as object) };
            await pool.query(`INSERT INTO "genetia_app"."WorkflowState" ("idempotencyKey","workflowType","externalId","state","payload") VALUES ($1,'MARKET_ADMISSIBILITY',$2,'READY',$3::jsonb) ON CONFLICT DO NOTHING`, [value.operationId, value.proposalId, JSON.stringify(value)]);
            return value;
          },
          async load(operationId) {
            const result = await pool.query(`SELECT "state","externalId","payload" FROM "genetia_app"."WorkflowState" WHERE "idempotencyKey" = $1`, [operationId]);
            const row = result.rows[0]; if (!row) return null;
            const payloadValue = (row.payload ?? {}) as Record<string, unknown>;
            return { proposalId: String(payloadValue.proposalId ?? payload.proposalId), operationId, lifecycle: String(row.state ?? "READY") as never, txId: row.externalId ? String(row.externalId) as never : undefined };
          },
          async claimSubmission(operationId) {
            const result = await pool.query(`UPDATE "genetia_app"."WorkflowState" SET "state"='SUBMITTING', "attempts"="attempts"+1, "updatedAt"=now() WHERE "idempotencyKey"=$1 AND "state" IN ('READY','PENDING') AND "externalId" IS NULL`, [operationId]);
            return (result.rowCount ?? 0) === 1;
          },
          async persistSubmission(operationId, txId) {
            await pool.query(`UPDATE "genetia_app"."WorkflowState" SET "externalId"=$2, "state"='SUBMITTED', "updatedAt"=now() WHERE "idempotencyKey"=$1`, [operationId, txId]);
          },
          async persistObservation(operationId, observation) {
            await pool.query(`UPDATE "genetia_app"."WorkflowState" SET "state"=$2, "payload"="payload" || $3::jsonb, "updatedAt"=now() WHERE "idempotencyKey"=$1`, [operationId, observation.lifecycle, JSON.stringify(observation)]);
          },
        };
        const client = createStudioAdmissibilityClient({ GENLAYER_RPC: this.env.GENLAYER_RPC, GENLAYER_PRIVATE_KEY: this.env.GENLAYER_PRIVATE_KEY, MARKET_ADMISSIBILITY_ADDRESS: this.env.MARKET_ADMISSIBILITY_ADDRESS });
        const txId = await submitAdmissibilityOnce(client, store, { proposalId: payload.proposalId, contract: this.env.MARKET_ADMISSIBILITY_ADDRESS, manifest: typeof terms === "string" ? terms : JSON.stringify(terms) });
        return { idempotencyKey: payload.idempotencyKey, workflowKey, kind: payload.kind, persisted: true, txId, state: "SUBMITTED" };
      } finally {
        await pool.end();
      }
    });
  }
}
