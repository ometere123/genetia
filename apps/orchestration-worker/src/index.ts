import { reconciliationKey } from "./runtime-state";
import { classifyQueueError, validateQueueJob } from "./queue-jobs";
import { GenetiaLifecycleWorkflow } from "./lifecycle-workflow";

export { GenetiaLifecycleWorkflow };

export interface Env { GENETIA_DB: Hyperdrive; GENETIA_JOBS: Queue; GENETIA_WORKFLOWS: Workflow; GENLAYER_RPC:string; }
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const idempotencyKey = reconciliationKey(Date.now());
    ctx.waitUntil(env.GENETIA_JOBS.send({ kind: "reconcile-due-markets", idempotencyKey }));
  },
  async fetch(request: Request) {
    return new Response(JSON.stringify({ ok: true, service: "orchestration", method: request.method }), {
      headers: { "content-type": "application/json" },
    });
  },
  async queue(batch: MessageBatch<unknown>, env: Env) {
    for (const message of batch.messages) {
      try {
        validateQueueJob(message.body);
        // Durable workflow execution is attached at this boundary. A queue
        // acknowledgement is issued only after validation and dispatch have
        // completed; failures are retried or dead-lettered by the queue.
        message.ack();
      } catch (error) {
        if (classifyQueueError(error) === "dead-letter") message.ack();
        else message.retry({ delaySeconds: 60 });
      }
    }
  },
};
