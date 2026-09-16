import { describe, expect, it } from "vitest";
import { GenetiaClient, MARKET_CATEGORIES, normalizeMarketCategory } from "./index";

const market = { id: "db-id", marketId: "m1", engine: "POOL", title: "Market", question: "Will this happen?", description: "A market", category: "crypto", status: "ACTIVE", creatorAddress: `0x${"11".repeat(20)}`, baseAddress: `0x${"22".repeat(20)}`, financialReleaseId: "pool-a", resolverAddress: `0x${"33".repeat(20)}`, resolverReleaseId: "resolver-a", manifestHash: `0x${"44".repeat(32)}`, closeTime: "2026-01-01T00:00:00.000Z", resolutionAvailableTime: "2026-01-02T00:00:00.000Z", terminalDeadline: "2026-01-06T00:00:00.000Z", terminalOutcome: null };

function client(body: unknown, status = 200, seen: string[] = []) {
  return new GenetiaClient({ baseUrl: "https://api.example", headers: { authorization: "Bearer test" }, fetch: async (input, init) => { seen.push(`${init?.method ?? "GET"} ${input}`); return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); } });
}

describe("GenetiaClient", () => {
  it("normalizes legacy and display category names to canonical filter slugs", () => {
    expect(normalizeMarketCategory("Technology")).toBe("tech-ai");
    expect(normalizeMarketCategory("Tech & AI")).toBe("tech-ai");
    expect(normalizeMarketCategory("Internet & Social")).toBe("internet-social");
    expect(normalizeMarketCategory("unmapped legacy category")).toBe("other");
    expect(MARKET_CATEGORIES).toContain("other");
  });

  it("requests filtered paginated markets and validates the response", async () => {
    const seen: string[] = [];
    const result = await client({ items: [market], nextCursor: "next" }, 200, seen).markets({ category: "crypto", engine: "POOL", status: "ACTIVE", search: "election result", limit: 10 });
    expect(result.items[0]?.marketId).toBe("m1");
    expect(seen[0]).toContain("category=crypto");
    expect(seen[0]).toContain("search=election+result");
    expect(seen[0]).toContain("engine=POOL");
  });

  it("normalizes an API origin that already includes /api", async () => {
    const seen: string[] = [];
    const api = new GenetiaClient({
      baseUrl: "https://api.example/api/",
      fetch: async (input) => {
        seen.push(String(input));
        return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      },
    });
    await api.markets();
    expect(seen).toEqual(["https://api.example/api/markets"]);
  });

  it("fails clearly instead of sending API requests to the Vercel page origin when unconfigured", async () => {
    let requested = false;
    const api = new GenetiaClient({ baseUrl: "", fetch: async () => { requested = true; return new Response("{}", { status: 200 }); } });
    await expect(api.markets()).rejects.toThrow("Set NEXT_PUBLIC_API_BASE_URL");
    expect(requested).toBe(false);
  });

  it("covers market detail, prices, activity, proposal, positions, history, and health", async () => {
    const responses: unknown[] = [market, { marketId: "m1", engine: "POOL", yesTotal: "1", noTotal: "2" }, [{ id: "trade" }], [{ id: "lp" }], { resolverAddress: market.resolverAddress, manifestHash: market.manifestHash, genlayerTxId: `0x${"55".repeat(32)}`, lifecycle: "FINALIZED", executionStatus: "FINISHED_WITH_RETURN", attempt: 0, submittedAt: "2026-01-01T00:00:00.000Z" }, [{ id: "evidence" }], [{ id: "position" }], [{ id: "history" }], { proposalId: `0x${"66".repeat(32)}`, proposer: market.creatorAddress, status: "PENDING_BOND", bondStatus: "CONFIRMED", revisionCount: 0, workflowStatus: "RUNNING" }, { ok: true, baseChainId: 84532, genlayerChainId: 61997, database: true }];
    const api = new GenetiaClient({ baseUrl: "https://api.example", fetch: async () => new Response(JSON.stringify(responses.shift()), { status: 200 }) });
    await expect(api.market("m1")).resolves.toMatchObject({ marketId: "m1" });
    await expect(api.prices("m1")).resolves.toMatchObject({ engine: "POOL" });
    await expect(api.trades("m1")).resolves.toHaveLength(1);
    await expect(api.liquidity("m1")).resolves.toHaveLength(1);
    await expect(api.resolution("m1")).resolves.toMatchObject({ lifecycle: "FINALIZED" });
    await expect(api.evidence("m1")).resolves.toHaveLength(1);
    await expect(api.positions(market.creatorAddress)).resolves.toHaveLength(1);
    await expect(api.history(market.creatorAddress)).resolves.toHaveLength(1);
    await expect(api.proposal("p1")).resolves.toMatchObject({ status: "PENDING_BOND", bondStatus: "CONFIRMED" });
    await expect(api.health()).resolves.toMatchObject({ baseChainId: 84532 });
  });

  it("rejects malformed payloads and HTTP failures", async () => {
    await expect(client({ items: [market] }).markets()).rejects.toThrow();
    await expect(client({ error: "unauthorized" }, 401).health()).rejects.toThrow("/health 401");
  });

  it("validates prepared transactions and quote responses", async () => {
    const validTx = { chainId: 84532, to: market.baseAddress, data: "0x1234", value: "0", marketId: "m1", engine: "POOL", action: "BUY", side: "YES", amount: "1", approval: null };
    const validQuote = { shares: "2", notional: "1", fee: "0", total: "1", priceAfter: "500000" };
    const responses = [validQuote, validTx];
    const api = new GenetiaClient({ baseUrl: "https://api.example", fetch: async () => new Response(JSON.stringify(responses.shift()), { status: 200 }) });
    await expect(api.quote("m1", { side: "YES", action: "BUY", amount: "1" })).resolves.toMatchObject({ shares: "2" });
    await expect(api.prepareTrade("m1", { side: "YES", action: "BUY", amount: "1" })).resolves.toMatchObject({ chainId: 84532 });
  });

  it("validates proposal bond preparation and typed proposal status", async () => {
    const proposalId = `0x${"66".repeat(32)}`;
    const response = { chainId: 84532, proposalId, proposer: market.creatorAddress, bondAmount: "2000000", approval: { token: market.baseAddress, spender: market.baseAddress, amount: "2000000" }, lock: { to: market.baseAddress, data: "0x1234", value: "0" } };
    const api = client(response);
    await expect(api.prepareProposalBond(market as never, market.creatorAddress)).resolves.toMatchObject({ bondAmount: "2000000", chainId: 84532 });
    const state = { proposalId, proposer: market.creatorAddress, status: "PENDING_BOND", bondStatus: "CONFIRMED", revisionCount: 0, workflowStatus: "RUNNING" };
    const statusApi = client(state);
    await expect(statusApi.submitProposal(market as never, `0x${"77".repeat(32)}`, market.creatorAddress)).resolves.toMatchObject({ workflowStatus: "RUNNING" });
  });
});
