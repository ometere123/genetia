import { classifyQueueError } from "./queue-jobs";
import { GenetiaLifecycleWorkflow } from "./lifecycle-workflow";
import { dispatchQueueJob } from "./queue-dispatch";

export { GenetiaLifecycleWorkflow };

export interface Env { GENETIA_DB: Hyperdrive; GENETIA_JOBS: Queue; GENETIA_DLQ: Queue; GENETIA_WORKFLOWS: Workflow; GENLAYER_RPC:string; RECONCILE_SECRET?: string; }

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
      ctx.waitUntil(env.GENETIA_JOBS.send({ kind: "reconcile-due-markets", idempotencyKey }));
      return Response.json({ ok: true, accepted: true, idempotencyKey });
    }
    return new Response(JSON.stringify({ ok: true, service: "orchestration", method: request.method }), {
      headers: { "content-type": "application/json" },
    });
  },
  async queue(batch: MessageBatch<unknown>, env: Env) {
    for (const message of batch.messages) {
      try {
        await dispatchQueueJob(message.body, env);
        // Durable workflow execution is attached at this boundary. A queue
        // acknowledgement is issued only after validation and dispatch have
        // completed; failures are retried or dead-lettered by the queue.
        message.ack();
      } catch (error) {
        if (classifyQueueError(error) === "dead-letter") {
          await env.GENETIA_DLQ.send({ original: message.body, error: error instanceof Error ? error.message : "terminal queue error" });
          message.ack();
        }
        else message.retry({ delaySeconds: 60 });
      }
    }
  },
};
