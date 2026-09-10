import { describe, expect, it } from "vitest";
import app, { createApiApp } from "./index";
import type { MarketReadModel } from "./read-model";

const env = { BASE_CHAIN_ID: "84532", GENLAYER_CHAIN_ID: "61997", GENLAYER_RPC: "https://studio-dev.genlayer.com/api" };
const market = { id: "db-id", marketId: "m1", engine: "POOL", title: "Market", question: "Will this happen?", description: "A market", category: "crypto", status: "ACTIVE", creatorAddress: `0x${"11".repeat(20)}`, baseAddress: `0x${"22".repeat(20)}`, financialReleaseId: "pool-a", resolverAddress: `0x${"33".repeat(20)}`, resolverReleaseId: "resolver-a", manifestHash: `0x${"44".repeat(32)}`, closeTime: "2026-01-01T00:00:00.000Z", resolutionAvailableTime: "2026-01-02T00:00:00.000Z", terminalDeadline: "2026-01-06T00:00:00.000Z", terminalOutcome: null };
const model: MarketReadModel = {
  listMarkets: async (options) => ({ items: [market], nextCursor: options.cursor ? null : "next" }),
  getMarket: async (id) => id === "m1" ? market : null,
  getMarketCollection: async () => [{ id: "event-1" }],
  getPositions: async () => [{ marketId: "m1" }],
  getHistory: async () => [{ marketId: "m1" }],
  getProposal: async (id) => id === "p1" ? { id } : null,
  getPrices: async (id) => id === "m1" ? { marketId: id, engine: "POOL", yesTotal: "4", noTotal: "2" } : null,
};
const boundApp = createApiApp(() => model);
const boundEnv = { ...env, GENETIA_DB: {} as Hyperdrive };

describe("canonical API contract", () => {
  it("reports the locked chains and database health", async () => {
    const response = await app.request("http://localhost/api/health", {}, env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, baseChainId: 84532, genlayerChainId: 61997, database: false });
  });

  it("returns an explicit unavailable state when no indexed DB is bound", async () => {
    const response = await app.request("http://localhost/api/markets", {}, env);
    expect(response.status).toBe(503);
  });

  it("requires authentication for protected trade preparation", async () => {
    const response = await app.request("http://localhost/api/markets/m1/prepare-trade", { method: "POST" }, env);
    expect(response.status).toBe(401);
  });

  it("serves filtered, cursor-paginated market discovery from the read model", async () => {
    const response = await boundApp.request("http://localhost/api/markets?category=crypto&engine=POOL&status=ACTIVE&limit=10", {}, boundEnv);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ items: [{ marketId: "m1" }], nextCursor: "next" });
  });

  it("rejects malformed pagination and filter parameters", async () => {
    expect((await boundApp.request("http://localhost/api/markets?limit=0", {}, boundEnv)).status).toBe(400);
    expect((await boundApp.request("http://localhost/api/markets?engine=CLOB", {}, boundEnv)).status).toBe(400);
    expect((await boundApp.request("http://localhost/api/markets?cursor=%25", {}, boundEnv)).status).toBe(400);
  });

  it("serves market detail and returns not found deterministically", async () => {
    await expect((await boundApp.request("http://localhost/api/markets/m1", {}, boundEnv)).json()).resolves.toMatchObject({ marketId: "m1" });
    expect((await boundApp.request("http://localhost/api/markets/missing", {}, boundEnv)).status).toBe(404);
  });

  it("serves Pool prices and not-found prices from indexed state", async () => {
    await expect((await boundApp.request("http://localhost/api/markets/m1/prices", {}, boundEnv)).json()).resolves.toMatchObject({ engine: "POOL", yesTotal: "4" });
    expect((await boundApp.request("http://localhost/api/markets/missing/prices", {}, boundEnv)).status).toBe(404);
  });

  it("serves every indexed market collection route", async () => {
    for (const collection of ["trades", "liquidity", "resolution", "evidence"]) {
      const response = await boundApp.request(`http://localhost/api/markets/m1/${collection}`, {}, boundEnv);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual([{ id: "event-1" }]);
    }
  });

  it("distinguishes an empty collection from a missing market", async () => {
    const missingModel: MarketReadModel = { ...model, getMarketCollection: async (id) => id === "m1" ? [] : null };
    const missingApp = createApiApp(() => missingModel);
    expect((await missingApp.request("http://localhost/api/markets/missing/trades", {}, boundEnv)).status).toBe(404);
    expect((await missingApp.request("http://localhost/api/markets/m1/trades", {}, boundEnv)).status).toBe(200);
    await expect((await missingApp.request("http://localhost/api/markets/m1/trades", {}, boundEnv)).json()).resolves.toEqual([]);
  });

  it("serves proposal, positions, history, and health reads", async () => {
    await expect((await boundApp.request("http://localhost/api/market-proposals/p1", {}, boundEnv)).json()).resolves.toMatchObject({ id: "p1" });
    await expect((await boundApp.request(`http://localhost/api/users/${market.creatorAddress}/positions`, {}, boundEnv)).json()).resolves.toEqual([{ marketId: "m1" }]);
    await expect((await boundApp.request(`http://localhost/api/users/${market.creatorAddress}/history`, {}, boundEnv)).json()).resolves.toEqual([{ marketId: "m1" }]);
    await expect((await boundApp.request("http://localhost/api/health", {}, boundEnv)).json()).resolves.toMatchObject({ database: true });
  });

  it("validates protected payloads without creating a custodial balance", async () => {
    const invalidQuote = await boundApp.request("http://localhost/api/markets/m1/quote", { method: "POST", body: "{}" }, boundEnv);
    expect(invalidQuote.status).toBe(400);
    const validQuote = await boundApp.request("http://localhost/api/markets/m1/quote", { method: "POST", body: JSON.stringify({ side: "YES", action: "BUY", amount: "1" }) }, boundEnv);
    expect(validQuote.status).toBe(501);
    const proposal = await boundApp.request("http://localhost/api/market-proposals", { method: "POST", headers: { authorization: "Bearer test" }, body: "{}" }, boundEnv);
    expect(proposal.status).toBe(400);
  });
});
