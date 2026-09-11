import { describe, expect, it } from "vitest";
import { persistVerifiedProposal } from "./proposal-persistence";
import type { Proposal } from "@genetia/shared";

const proposal: Proposal = {
  idempotencyKey: "proposal-idempotency-001", market_id: "market-1", base_chain_id: 84532, genlayer_chain_id: 61997,
  question: "Will this proposal resolve?", yes_definition: "YES when official result confirms it.", no_definition: "NO otherwise under policy.",
  close_time: 1900000000, resolution_available_time: 1900003600, absolute_terminal_deadline: 1900349200,
  evidence_attempt_schedule_seconds: [0, 1800, 14400, 86400, 259200], void_conditions: ["insufficient evidence"], resolution_profile: "MULTI_SOURCE",
  authoritative_sources: [{ identity: "official", exact_url: "https://example.com/result", source_type: "official", priority: 0, required: true }], fallback_sources: [],
  corroboration_rule: "one source", minimum_corroborating_sources: 1, freshness_rule: "current", discovery_rule: "exact URL", official_source_required: true,
  arbitrary_caller_urls_forbidden: true, prompt_release_id: "prompt-a", manifest_release_id: "manifest-a", resolver_release_id: "resolver-a", engine: "POOL",
};
const proposer = `0x${"11".repeat(20)}` as `0x${string}`;

describe("durable verified proposal persistence", () => {
  it("writes proposal and workflow intent in one transaction", async () => {
    const calls: string[] = [];
    const client = { query: async (sql: string, values?: readonly unknown[]) => {
      calls.push(sql);
      if (sql.startsWith("SELECT u.")) return { rows: [{ id: "user-1" }] };
      if (sql.startsWith("SELECT \"canonical")) return { rows: [] };
      void values; return { rows: [] };
    } };
    const result = await persistVerifiedProposal(client, { proposal, proposer, bondTxHash: `0x${"22".repeat(32)}`, receipt: { status: "success", to: proposer, logs: [] } });
    expect(result.duplicate).toBe(false); expect(calls[0]).toBe("BEGIN"); expect(calls.at(-1)).toBe("COMMIT");
    expect(calls.some((sql) => sql.includes('"genetia_app"."WorkflowState"'))).toBe(true);
  });

  it("rolls back when the proposer wallet is absent", async () => {
    const calls: string[] = []; const client = { query: async (sql: string) => { calls.push(sql); if (sql.startsWith("SELECT u.")) return { rows: [] }; return { rows: [] }; } };
    await expect(persistVerifiedProposal(client, { proposal, proposer, bondTxHash: `0x${"22".repeat(32)}`, receipt: { status: "success", to: proposer, logs: [] } })).rejects.toThrow("wallet");
    expect(calls.at(-1)).toBe("ROLLBACK");
  });
});
