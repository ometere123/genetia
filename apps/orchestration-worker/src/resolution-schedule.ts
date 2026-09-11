const EVIDENCE_OFFSETS_MS = [0, 30 * 60_000, 4 * 3_600_000, 24 * 3_600_000, 72 * 3_600_000] as const;
const TECHNICAL_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 3_600_000, 6 * 3_600_000] as const;
export const TERMINAL_DEADLINE_MS = 96 * 3_600_000;

export type ResolutionAction =
  | { kind: "WAIT"; until: number }
  | { kind: "SUBMIT_EVIDENCE_ATTEMPT"; attempt: number; idempotencyKey: string }
  | { kind: "RETRY_SAME_OPERATION"; technicalAttempt: number; until: number; idempotencyKey: string }
  | { kind: "REQUEST_ATTESTATIONS"; genlayerTxId: string; idempotencyKey: string }
  | { kind: "EXPIRE_TO_VOID"; idempotencyKey: string };

export interface ScheduleState {
  marketId: string;
  resolutionAvailableAt: number;
  now: number;
  evidenceAttempt: number;
  /** Set after a finalized successful UNRESOLVED result; it advances the
   * evidence schedule without classifying the external operation as failed. */
  lastEvidenceOutcome?: "UNRESOLVED" | "YES" | "NO" | "VOID";
  technicalAttempt: number;
  lastTechnicalFailureAt?: number;
  finalizedSuccessfulTxId?: string;
  terminalSettled: boolean;
}

export function nextResolutionAction(state: ScheduleState): ResolutionAction {
  const deadline = state.resolutionAvailableAt + TERMINAL_DEADLINE_MS;
  if (state.terminalSettled) return { kind: "WAIT", until: Number.MAX_SAFE_INTEGER };
  if (state.now >= deadline) return { kind: "EXPIRE_TO_VOID", idempotencyKey: `${state.marketId}:expire:void` };
  if (state.finalizedSuccessfulTxId) return {
    kind: "REQUEST_ATTESTATIONS",
    genlayerTxId: state.finalizedSuccessfulTxId,
    idempotencyKey: `${state.marketId}:attest:${state.finalizedSuccessfulTxId}`,
  };
  if (state.lastTechnicalFailureAt !== undefined) {
    const delay = TECHNICAL_DELAYS_MS[state.technicalAttempt] ?? TECHNICAL_DELAYS_MS.at(-1)!;
    const until = Math.min(state.lastTechnicalFailureAt + delay, deadline);
    return state.now < until
      ? { kind: "WAIT", until }
      : { kind: "RETRY_SAME_OPERATION", technicalAttempt: state.technicalAttempt, until, idempotencyKey: `${state.marketId}:technical:${state.technicalAttempt}` };
  }
  const attempt = Math.min(state.evidenceAttempt + (state.lastEvidenceOutcome === "UNRESOLVED" ? 1 : 0), EVIDENCE_OFFSETS_MS.length - 1);
  const due = state.resolutionAvailableAt + EVIDENCE_OFFSETS_MS[attempt];
  return state.now < due
    ? { kind: "WAIT", until: due }
    : { kind: "SUBMIT_EVIDENCE_ATTEMPT", attempt, idempotencyKey: `${state.marketId}:evidence:${attempt}` };
}
