import { Workflow, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { expectedJobKey, validateQueueJob, type QueueJob } from "./queue-jobs";
import { Pool } from "pg";

export interface LifecycleWorkflowEnv {
  GENETIA_DB: Hyperdrive;
  GENETIA_JOBS: Queue;
  GENETIA_DLQ: Queue;
  GENLAYER_RPC: string;
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
        return { accepted: true, idempotencyKey: payload.idempotencyKey, workflowKey, kind: payload.kind, persisted: true };
      } finally {
        await pool.end();
      }
    });
  }
}
