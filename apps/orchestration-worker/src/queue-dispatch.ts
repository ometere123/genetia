import { validateQueueJob, type QueueJob } from "./queue-jobs";

export interface WorkflowStarter {
  create(options: { id: string; params: QueueJob }): Promise<unknown>;
}

function stableHash(value: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function workflowId(job: QueueJob): string {
  // Cloudflare Workflow instance IDs have a bounded, restricted character set.
  // Hash the full idempotency key so long recovery keys remain deterministic
  // and collision-resistant without exceeding the platform limit.
  const digest = `${stableHash(job.idempotencyKey, 2166136261)}${stableHash(job.idempotencyKey, 16777619)}`;
  return `genetia-${job.kind}-${digest}`;
}

export async function dispatchQueueJob(job: unknown, env: { GENETIA_WORKFLOWS: WorkflowStarter }): Promise<string> {
  const parsed = validateQueueJob(job);
  const id = workflowId(parsed);
  try {
    await env.GENETIA_WORKFLOWS.create({ id, params: parsed });
  } catch (error) {
    // Workflow creation is the idempotent boundary. A retry after the first
    // consumer created the instance is already complete; only infrastructure
    // failures should return to the queue retry path.
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|already created|duplicate/i.test(message)) throw error;
  }
  return id;
}
