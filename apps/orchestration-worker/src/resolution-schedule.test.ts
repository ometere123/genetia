import { describe, expect, it } from "vitest";
import { nextResolutionAction, TERMINAL_DEADLINE_MS, type ScheduleState } from "./resolution-schedule.js";

const base = (patch: Partial<ScheduleState> = {}): ScheduleState => ({
  marketId: "m1", resolutionAvailableAt: 1_000_000, now: 1_000_000,
  evidenceAttempt: 0, technicalAttempt: 0, terminalSettled: false, ...patch,
});

describe("bounded resolution scheduling", () => {
  it.each([[0,0],[1,1_800_000],[2,14_400_000],[3,86_400_000],[4,259_200_000]])("uses locked evidence attempt %i offset", (attempt, offset) => {
    expect(nextResolutionAction(base({ evidenceAttempt: attempt, now: 1_000_000 + offset }))).toMatchObject({ kind: "SUBMIT_EVIDENCE_ATTEMPT", attempt });
  });
  it.each([[0,60_000],[1,300_000],[2,900_000],[3,3_600_000],[4,21_600_000],[9,21_600_000]])("uses locked technical retry %i delay", (attempt, delay) => {
    const failedAt = 2_000_000;
    expect(nextResolutionAction(base({ technicalAttempt: attempt, lastTechnicalFailureAt: failedAt, now: failedAt + delay }))).toMatchObject({ kind: "RETRY_SAME_OPERATION", technicalAttempt: attempt });
  });
  it("only finalized successful transactions enter watcher collection", () => expect(nextResolutionAction(base({ finalizedSuccessfulTxId: "0xabc" }))).toMatchObject({ kind: "REQUEST_ATTESTATIONS", genlayerTxId: "0xabc" }));
  it("permissionlessly expires at exactly plus 96 hours", () => expect(nextResolutionAction(base({ now: 1_000_000 + TERMINAL_DEADLINE_MS }))).toEqual({ kind: "EXPIRE_TO_VOID", idempotencyKey: "m1:expire:void" }));
  it("terminal settlement prevents any later replacement", () => expect(nextResolutionAction(base({ terminalSettled: true, now: 1_000_000 + TERMINAL_DEADLINE_MS }))).toEqual({ kind: "WAIT", until: Number.MAX_SAFE_INTEGER }));
});
