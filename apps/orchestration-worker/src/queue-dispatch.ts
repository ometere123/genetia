import { validateQueueJob, type QueueJob } from "./queue-jobs";

export interface WorkflowStarter {
  create(id: string, params: QueueJob): Promise<unknown>;
}

export function workflowId(job: QueueJob): string {
  return `genetia-${job.idempotencyKey}`;
}

export async function dispatchQueueJob(job: unknown, env: { GENETIA_WORKFLOWS: WorkflowStarter }): Promise<string> {
  const parsed = validateQueueJob(job);
  const id = workflowId(parsed);
  try {
    await env.GENETIA_WORKFLOWS.create(id, parsed);
  } catch (error) {
    // Workflow creation is the idempotent boundary. A retry after the first
    // consumer created the instance is already complete; only infrastructure
    // failures should return to the queue retry path.
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|already created|duplicate/i.test(message)) throw error;
  }
  return id;
}
