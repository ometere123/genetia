import { Workflow, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { expectedJobKey, validateQueueJob, type QueueJob } from "./queue-jobs";

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
    return step.do(`dispatch:${expectedJobKey(payload)}`, async () => ({
      accepted: true,
      idempotencyKey: payload.idempotencyKey,
      kind: payload.kind,
    }));
  }
}
