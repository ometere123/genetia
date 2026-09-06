import { z } from "zod";
import { externalSubmissionKey, workflowIdempotencyKey } from "./runtime-state";

export const QueueJobSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("market-admissibility"), proposalId: z.string().min(1), idempotencyKey: z.string().min(1) }),
  z.object({ kind: z.literal("resolver-deployment"), proposalId: z.string().min(1), idempotencyKey: z.string().min(1) }),
  z.object({ kind: z.literal("market-activation"), marketId: z.string().min(1), idempotencyKey: z.string().min(1) }),
  z.object({ kind: z.literal("resolution-due"), marketId: z.string().min(1), attempt: z.number().int().min(0).max(4), idempotencyKey: z.string().min(1) }),
  z.object({ kind: z.literal("resolution-watch"), marketId: z.string().min(1), attempt: z.number().int().min(0).max(4), idempotencyKey: z.string().min(1) }),
  z.object({ kind: z.literal("resolution-retry"), marketId: z.string().min(1), attempt: z.number().int().min(0).max(4), idempotencyKey: z.string().min(1) }),
  z.object({ kind: z.literal("settlement"), marketId: z.string().min(1), idempotencyKey: z.string().min(1) }),
  z.object({ kind: z.literal("base-index"), chainId: z.literal(84532), fromBlock: z.string().regex(/^\d+$/), idempotencyKey: z.string().min(1) }),
  z.object({ kind: z.literal("notifications"), idempotencyKey: z.string().min(1) }),
  z.object({ kind: z.literal("reconcile-due-markets"), idempotencyKey: z.string().min(1) }),
]);
export type QueueJob = z.infer<typeof QueueJobSchema>;

export function validateQueueJob(input: unknown): QueueJob { return QueueJobSchema.parse(input); }
export function expectedJobKey(job: QueueJob): string {
  if (job.kind === "resolution-due" || job.kind === "resolution-watch" || job.kind === "resolution-retry") return externalSubmissionKey(job.marketId, job.attempt);
  if ("marketId" in job) return workflowIdempotencyKey(job.kind, job.marketId);
  if ("proposalId" in job) return workflowIdempotencyKey(job.kind, job.proposalId);
  return `${job.kind}:${job.idempotencyKey}`;
}

export type QueueAction = "ack" | "retry" | "dead-letter";
export function classifyQueueError(error: unknown): QueueAction {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid|malformed|unknown workflow|terminal/i.test(message)) return "dead-letter";
  return "retry";
}
