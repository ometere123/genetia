import { reconciliationKey } from "./runtime-state";

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
};
