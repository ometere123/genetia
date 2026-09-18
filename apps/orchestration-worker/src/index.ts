import { classifyQueueError } from "./queue-jobs";
import { GenetiaLifecycleWorkflow } from "./lifecycle-workflow";
import { dispatchQueueJob } from "./queue-dispatch";
import { scheduledReconciliationJobs } from "./scheduler-jobs";

export { GenetiaLifecycleWorkflow };

export interface Env { GENETIA_DB: Hyperdrive; GENETIA_JOBS: Queue; GENETIA_DLQ: Queue; GENETIA_WORKFLOWS: Workflow; GENLAYER_RPC:string; BASE_RPC: string; BASE_DEPLOYMENT_BLOCK: string; RECONCILE_SECRET?: string; }

async function sameSecret(provided: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([crypto.subtle.digest("SHA-256", new TextEncoder().encode(provided)), crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected))]);
  const a = new Uint8Array(left); const b = new Uint8Array(right);
  if (a.length !== b.length) return false;
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/reconcile") {
      if (request.method !== "POST" || !env.RECONCILE_SECRET) return new Response("Not found", { status: 404 });
      const supplied = request.headers.get("x-genetia-reconcile-secret");
      const tick = request.headers.get("x-genetia-reconcile-id");
      if (!supplied || !tick || !(await sameSecret(supplied, env.RECONCILE_SECRET))) return new Response("Unauthorized", { status: 401 });
      // The caller-provided tick is the durable scheduler identity. Do not
      // replace it with wall-clock time: retries of the same Cron request
      // must coalesce even when they arrive in a different five-minute bin.
      const idempotencyKey = tick.startsWith("reconcile:") ? tick : `reconcile:${tick}`;
      let jobs;
      try { jobs = scheduledReconciliationJobs(tick, env.BASE_DEPLOYMENT_BLOCK); }
      catch { return Response.json({ error: "Base indexer is not configured" }, { status: 503 }); }
      ctx.waitUntil(Promise.all([
        ...jobs.map((job) => env.GENETIA_JOBS.send(job)),
      ]));
      return Response.json({ ok: true, accepted: true, idempotencyKey: jobs[0].idempotencyKey, scheduled: jobs.map((job) => job.kind) });
    }
    return new Response(JSON.stringify({ ok: true, service: "orchestration", method: request.method }), {
      headers: { "content-type": "application/json" },
    });
  },
  async queue(batch: MessageBatch<unknown>, env: Env) {
    for (const message of batch.messages) {
      try {
        const parsed = message.body as { kind?: string; idempotencyKey?: string };
        console.log("queue dispatch start", { kind: parsed?.kind, idempotencyKey: parsed?.idempotencyKey });
        const workflowId = await dispatchQueueJob(message.body, env);
        console.log("queue dispatch complete", { workflowId });
        // Durable workflow execution is attached at this boundary. A queue
        // acknowledgement is issued only after validation and dispatch have
        // completed; failures are retried or dead-lettered by the queue.
        message.ack();
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        console.error("queue dispatch failed", { message: messageText });
        if (classifyQueueError(error) === "dead-letter") {
          await env.GENETIA_DLQ.send({ original: message.body, error: messageText });
          message.ack();
        }
        else message.retry({ delaySeconds: 60 });
      }
    }
  },
};
