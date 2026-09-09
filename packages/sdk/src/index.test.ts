import { describe, expect, it } from "vitest";
import { GenetiaClient } from "./index";

const market = { id: "db-id", marketId: "m1", engine: "POOL", title: "Market", question: "Will this happen?", description: "A market", category: "crypto", status: "ACTIVE", creatorAddress: `0x${"11".repeat(20)}`, baseAddress: `0x${"22".repeat(20)}`, financialReleaseId: "pool-a", resolverAddress: `0x${"33".repeat(20)}`, resolverReleaseId: "resolver-a", manifestHash: `0x${"44".repeat(32)}`, closeTime: "2026-01-01T00:00:00.000Z", resolutionAvailableTime: "2026-01-02T00:00:00.000Z", terminalDeadline: "2026-01-06T00:00:00.000Z", terminalOutcome: null };

function client(body: unknown, status = 200, seen: string[] = []) {
  return new GenetiaClient({ baseUrl: "https://api.example", headers: { authorization: "Bearer test" }, fetch: async (input, init) => { seen.push(`${init?.method ?? "GET"} ${input}`); return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); } });
}

describe("GenetiaClient", () => {
  it("requests filtered paginated markets and validates the response", async () => {
    const seen: string[] = [];
    const result = await client({ items: [market], nextCursor: "next" }, 200, seen).markets({ category: "crypto", engine: "POOL", status: "ACTIVE", limit: 10 });
    expect(result.items[0]?.marketId).toBe("m1");
    expect(seen[0]).toContain("category=crypto");
    expect(seen[0]).toContain("engine=POOL");
  });

  it("covers market detail, prices, activity, proposal, positions, history, and health", async () => {
    const responses: unknown[] = [market, { marketId: "m1", engine: "POOL", yesTotal: "1", noTotal: "2" }, [{ id: "trade" }], [{ id: "lp" }], { resolverAddress: market.resolverAddress, manifestHash: market.manifestHash, genlayerTxId: `0x${"55".repeat(32)}`, lifecycle: "FINALIZED", executionStatus: "FINISHED_WITH_RETURN", attempt: 0, submittedAt: "2026-01-01T00:00:00.000Z" }, [{ id: "evidence" }], [{ id: "position" }], [{ id: "history" }], { id: "p1" }, { ok: true, baseChainId: 84532, genlayerChainId: 61997, database: true }];
    const api = new GenetiaClient({ baseUrl: "https://api.example", fetch: async () => new Response(JSON.stringify(responses.shift()), { status: 200 }) });
    await expect(api.market("m1")).resolves.toMatchObject({ marketId: "m1" });
    await expect(api.prices("m1")).resolves.toMatchObject({ engine: "POOL" });
    await expect(api.trades("m1")).resolves.toHaveLength(1);
    await expect(api.liquidity("m1")).resolves.toHaveLength(1);
    await expect(api.resolution("m1")).resolves.toMatchObject({ lifecycle: "FINALIZED" });
    await expect(api.evidence("m1")).resolves.toHaveLength(1);
    await expect(api.positions(market.creatorAddress)).resolves.toHaveLength(1);
    await expect(api.history(market.creatorAddress)).resolves.toHaveLength(1);
    await expect(api.proposal("p1")).resolves.toMatchObject({ id: "p1" });
    await expect(api.health()).resolves.toMatchObject({ baseChainId: 84532 });
  });

  it("rejects malformed payloads and HTTP failures", async () => {
    await expect(client({ items: [market] }).markets()).rejects.toThrow();
    await expect(client({ error: "unauthorized" }, 401).health()).rejects.toThrow("/health 401");
  });

  it("validates prepared transactions and quote responses", async () => {
    const validTx = { chainId: 84532, to: market.baseAddress, data: "0x1234", value: "0" };
    const validQuote = { shares: "2", notional: "1", fee: "0", total: "1", priceAfter: "500000" };
    const responses = [validQuote, validTx];
    const api = new GenetiaClient({ baseUrl: "https://api.example", fetch: async () => new Response(JSON.stringify(responses.shift()), { status: 200 }) });
    await expect(api.quote("m1", { side: "YES", action: "BUY", amount: "1" })).resolves.toMatchObject({ shares: "2" });
    await expect(api.prepareTrade("m1", { side: "YES", action: "BUY", amount: "1" })).resolves.toMatchObject({ chainId: 84532 });
  });
});
