import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters } from "viem";
import app, { createApiApp } from "./index";
import type { MarketReadModel } from "./read-model";
import type { Proposal, Quote } from "@genetia/shared";
import { prepareProposalBond, canonicalProposalId, verifyBondReceipt } from "./proposal-adapter";
import { liveQuote } from "./quote-adapter";

const env = { BASE_CHAIN_ID: "84532", BASE_RPC: "https://sepolia.base.org", GENLAYER_CHAIN_ID: "61997", GENLAYER_RPC: "https://studio-dev.genlayer.com/api" };
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
const testAuth = async () => ({ userId: "did:privy:test" });
const boundApp = createApiApp(() => model, undefined, undefined, testAuth);
const boundEnv = { ...env, GENETIA_DB: {} as Hyperdrive };
const escrow = `0x${"55".repeat(20)}` as `0x${string}`;
const usdc = `0x${"66".repeat(20)}` as `0x${string}`;
const proposer = `0x${"77".repeat(20)}` as `0x${string}`;
const proposal: Proposal = { idempotencyKey: "proposal-idempotency-001", market_id: "market-1", base_chain_id: 84532, genlayer_chain_id: 61997, question: "Will this proposal resolve?", yes_definition: "YES when the official result confirms it.", no_definition: "NO otherwise under the policy.", close_time: 1900000000, resolution_available_time: 1900003600, absolute_terminal_deadline: 1900349200, evidence_attempt_schedule_seconds: [0,1800,14400,86400,259200], void_conditions: ["insufficient evidence"], resolution_profile: "MULTI_SOURCE", authoritative_sources: [{ identity: "official", exact_url: "https://example.com/result", source_type: "official", priority: 0, required: true }], fallback_sources: [], corroboration_rule: "one source", minimum_corroborating_sources: 1, freshness_rule: "current", discovery_rule: "exact URL", official_source_required: true, arbitrary_caller_urls_forbidden: true, prompt_release_id: "prompt-a", manifest_release_id: "manifest-a", resolver_release_id: "resolver-a", engine: "POOL" };

describe("canonical API contract", () => {
  it("allows the production Vercel app origin and required browser headers", async () => {
    const response = await app.request("http://localhost/api/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://genetiamarkets.vercel.app",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,x-wallet-address",
      },
    }, { ...env, WEB_ORIGINS: "https://genetiamarkets.vercel.app,http://localhost:3000" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://genetiamarkets.vercel.app");
    expect(response.headers.get("access-control-allow-headers")).toContain("x-wallet-address");
  });

  it("does not grant browser access to an unlisted origin", async () => {
    const response = await app.request("http://localhost/api/health", {
      headers: { Origin: "https://untrusted.example" },
    }, { ...env, WEB_ORIGINS: "https://genetiamarkets.vercel.app" });
    expect(response.headers.get("access-control-allow-origin")).not.toBe("https://untrusted.example");
  });

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

  it("supports bounded server-side search and canonical category values", async () => {
    let received: { category?: string; search?: string } = {};
    const searchModel: MarketReadModel = { ...model, listMarkets: async (options) => { received = options; return { items: [], nextCursor: null }; } };
    const searchApp = createApiApp(() => searchModel, undefined, undefined, testAuth);
    const response = await searchApp.request("http://localhost/api/markets?category=Tech%20%26%20AI&search=  election%20result%20&limit=20", {}, boundEnv);
    expect(response.status).toBe(200);
    expect(received).toMatchObject({ category: "tech-ai", search: "election result" });
    expect((await searchApp.request(`http://localhost/api/markets?category=${encodeURIComponent("not-a-category")}`, {}, boundEnv)).status).toBe(400);
    expect((await searchApp.request(`http://localhost/api/markets?search=${"x".repeat(121)}`, {}, boundEnv)).status).toBe(400);
  });

  it("maps the discovery Resolved filter to the database terminal lifecycle state", async () => {
    let receivedStatus: string | undefined;
    const statusModel: MarketReadModel = { ...model, listMarkets: async (options) => { receivedStatus = options.status; return { items: [], nextCursor: null }; } };
    const statusApp = createApiApp(() => statusModel, undefined, undefined, testAuth);
    expect((await statusApp.request("http://localhost/api/markets?status=RESOLVED", {}, boundEnv)).status).toBe(200);
    expect(receivedStatus).toBe("TERMINAL");
    expect((await statusApp.request("http://localhost/api/markets?status=MADE_UP", {}, boundEnv)).status).toBe(400);
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
    const missingApp = createApiApp(() => missingModel, undefined, undefined, testAuth);
    expect((await missingApp.request("http://localhost/api/markets/missing/trades", {}, boundEnv)).status).toBe(404);
    expect((await missingApp.request("http://localhost/api/markets/m1/trades", {}, boundEnv)).status).toBe(200);
    await expect((await missingApp.request("http://localhost/api/markets/m1/trades", {}, boundEnv)).json()).resolves.toEqual([]);
  });

  it("serves proposal, positions, history, and health reads", async () => {
    await expect((await boundApp.request("http://localhost/api/market-proposals/p1", {}, boundEnv)).json()).resolves.toMatchObject({ id: "p1" });
    const authHeaders = { authorization: "Bearer test" };
    await expect((await boundApp.request(`http://localhost/api/users/${market.creatorAddress}/positions`, { headers: authHeaders }, boundEnv)).json()).resolves.toEqual([{ marketId: "m1" }]);
    await expect((await boundApp.request(`http://localhost/api/users/${market.creatorAddress}/history`, { headers: authHeaders }, boundEnv)).json()).resolves.toEqual([{ marketId: "m1" }]);
    await expect((await boundApp.request("http://localhost/api/health", {}, boundEnv)).json()).resolves.toMatchObject({ database: true });
  });

  it("protects wallet-specific position and history reads", async () => {
    for (const collection of ["positions", "history"]) {
      const url = `http://localhost/api/users/${market.creatorAddress}/${collection}`;
      expect((await boundApp.request(url, {}, boundEnv)).status).toBe(401);
      const authorized = await boundApp.request(url, { headers: { authorization: "Bearer test" } }, boundEnv);
      expect(authorized.status).toBe(200);
    }
  });

  it("validates quote payloads and serves a provider-backed quote", async () => {
    const invalidQuote = await boundApp.request("http://localhost/api/markets/m1/quote", { method: "POST", body: "{}" }, boundEnv);
    expect(invalidQuote.status).toBe(400);
    const quote: Quote = { marketId: "m1", engine: "POOL", action: "BUY", side: "YES", shares: "1", notional: "1", fee: "0", total: "1", priceAfter: "0", yesTotal: "4", noTotal: "2", nextYesTotal: "5", nextNoTotal: "2", feeRateBps: 150, chainId: 84532, contract: market.baseAddress, quoteAt: "1700000000" };
    const quoteApp = createApiApp(() => model, async () => quote, undefined, testAuth);
    const validQuote = await quoteApp.request("http://localhost/api/markets/m1/quote", { method: "POST", body: JSON.stringify({ side: "YES", action: "BUY", amount: "1" }) }, boundEnv);
    expect(validQuote.status).toBe(200);
    await expect(validQuote.json()).resolves.toMatchObject({ engine: "POOL", nextYesTotal: "5" });
    const proposal = await boundApp.request("http://localhost/api/market-proposals", { method: "POST", headers: { authorization: "Bearer test" }, body: "{}" }, boundEnv);
    expect(proposal.status).toBe(400);
  });

  it("fails closed when the live Base quote source is unavailable", async () => {
    const response = await boundApp.request("http://localhost/api/markets/m1/quote", { method: "POST", body: JSON.stringify({ side: "YES", action: "BUY", amount: "1" }) }, { ...boundEnv, BASE_RPC: undefined });
    expect(response.status).toBe(503);
  });

  it("prepares and ABI-decodes a Pool stake for the user's wallet", async () => {
    const response = await boundApp.request("http://localhost/api/markets/m1/prepare-trade", { method: "POST", headers: { authorization: "Bearer test", "x-wallet-address": proposer }, body: JSON.stringify({ side: "YES", action: "BUY", amount: "7" }) }, boundEnv);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: `0x${string}`; to: string; approval: unknown };
    expect(body.to).toBe(market.baseAddress);
    expect(decodeFunctionData({ abi: parseAbi(["function stake(bool yes, uint256 amount)"]), data: body.data })).toMatchObject({ functionName: "stake", args: [true, 7n] });
    expect(body.approval).toBeNull();
  });

  it("rejects LMSR preparation without explicit slippage protection", async () => {
    const lmsrModel = { ...model, getMarket: async (id: string) => id === "m1" ? { ...market, engine: "LMSR", lmsr: { b: "100000000", fundingTarget: "100000000", funded: "100000000", yesPrice: "500000000000000000", noPrice: "500000000000000000" } } : null } as MarketReadModel;
    const lmsrApp = createApiApp(() => lmsrModel, undefined, undefined, testAuth);
    const response = await lmsrApp.request("http://localhost/api/markets/m1/prepare-trade", { method: "POST", headers: { authorization: "Bearer test", "x-wallet-address": proposer }, body: JSON.stringify({ side: "NO", action: "BUY", amount: "7" }) }, boundEnv);
    expect(response.status).toBe(422);
  });

  it("keeps quote and prepared Pool calldata consistent", async () => {
    const quote: Quote = { marketId: "m1", engine: "POOL", action: "BUY", side: "NO", shares: "9", notional: "9", fee: "0", total: "9", priceAfter: "0", yesTotal: "4", noTotal: "2", nextYesTotal: "4", nextNoTotal: "11", feeRateBps: 150, chainId: 84532, contract: market.baseAddress, quoteAt: "1700000000" };
    const quoteApp = createApiApp(() => model, async () => quote, undefined, testAuth);
    const quoteResponse = await quoteApp.request("http://localhost/api/markets/m1/quote", { method: "POST", body: JSON.stringify({ side: "NO", action: "BUY", amount: "9" }) }, boundEnv);
    const quoted = await quoteResponse.json() as Quote;
    const prepared = await quoteApp.request("http://localhost/api/markets/m1/prepare-trade", { method: "POST", headers: { authorization: "Bearer test", "x-wallet-address": proposer }, body: JSON.stringify({ side: quoted.side, action: quoted.action, amount: quoted.shares }) }, boundEnv);
    const body = await prepared.json() as { data: `0x${string}` };
    expect(decodeFunctionData({ abi: parseAbi(["function stake(bool yes, uint256 amount)"]), data: body.data })).toMatchObject({ functionName: "stake", args: [false, 9n] });
  });

  it("keeps quote and prepared LMSR calldata consistent with slippage", async () => {
    const lmsrMarket = { ...market, engine: "LMSR", lmsr: { b: "100000000", fundingTarget: "100000000", funded: "100000000", yesPrice: "500000000000000000", noPrice: "500000000000000000" } };
    const lmsrModel = { ...model, getMarket: async (id: string) => id === "m1" ? lmsrMarket : null } as MarketReadModel;
    const quote: Quote = { marketId: "m1", engine: "LMSR", action: "BUY", side: "YES", shares: "12", notional: "100", fee: "1", total: "101", priceAfter: "500000000000000000", qYes: "0", qNo: "0", b: "100000000", feeRateBps: 100, chainId: 84532, contract: market.baseAddress, quoteAt: "1700000000" };
    const quoteApp = createApiApp(() => lmsrModel, async () => quote, undefined, testAuth);
    const quoteResponse = await quoteApp.request("http://localhost/api/markets/m1/quote", { method: "POST", body: JSON.stringify({ side: "YES", action: "BUY", amount: "12", maxTotal: "101" }) }, boundEnv);
    const quoted = await quoteResponse.json() as Quote;
    const prepared = await quoteApp.request("http://localhost/api/markets/m1/prepare-trade", { method: "POST", headers: { authorization: "Bearer test", "x-wallet-address": proposer }, body: JSON.stringify({ side: quoted.side, action: quoted.action, amount: quoted.shares, maxTotal: quoted.total }) }, boundEnv);
    const body = await prepared.json() as { data: `0x${string}` };
    expect(decodeFunctionData({ abi: parseAbi(["function buy(uint8 side, uint256 shares, uint256 maxTotal)"]), data: body.data })).toMatchObject({ functionName: "buy", args: [1, 12n, 101n] });
  });

  it("rejects a live quote when the provider reports stale or ineligible state", async () => {
    const quoteApp = createApiApp(() => model, async () => { throw new Error("market is closed"); }, undefined, testAuth);
    const response = await quoteApp.request("http://localhost/api/markets/m1/quote", { method: "POST", body: JSON.stringify({ side: "YES", action: "BUY", amount: "1" }) }, boundEnv);
    expect(response.status).toBe(422);
  });

  it("prepares a canonical 2 USDC bond and decodes the lock calldata", async () => {
    const id = await canonicalProposalId(proposal, proposer);
    const prepared = await prepareProposalBond(proposal, proposer, escrow, usdc);
    expect(prepared.proposalId).toBe(id);
    expect(prepared.bondAmount).toBe("2000000");
    expect(decodeFunctionData({ abi: parseAbi(["function lock(bytes32 proposalId, address proposer)"]), data: prepared.lock.data as `0x${string}` })).toMatchObject({ functionName: "lock", args: [id, proposer] });
  });

  it("accepts only the successful canonical escrow and USDC events", async () => {
    const id = await canonicalProposalId(proposal, proposer);
    const escrowTopics = encodeEventTopics({ abi: parseAbi(["event BondLocked(bytes32 indexed proposalId, address indexed proposer)"]), eventName: "BondLocked", args: { proposalId: id, proposer } });
    const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
    const transferTopics = encodeEventTopics({ abi: transferAbi, eventName: "Transfer", args: { from: proposer, to: escrow } });
    const transferData = encodeAbiParameters(parseAbiParameters(["uint256"]), [2_000_000n]);
    verifyBondReceipt({ status: "success", to: escrow, logs: [
      { address: escrow, topics: escrowTopics as readonly `0x${string}`[], data: "0x" },
      { address: usdc, topics: transferTopics as readonly `0x${string}`[], data: transferData },
    ] }, { proposalId: id, proposer, escrow, usdc });
    expect(() => verifyBondReceipt({ status: "reverted", to: escrow, logs: [] }, { proposalId: id, proposer, escrow, usdc })).toThrow("failed");
  });

  it("requires a wallet and configured escrow for bond preparation", async () => {
    expect((await boundApp.request("http://localhost/api/market-proposals/prepare-bond", { method: "POST", headers: { authorization: "Bearer test" }, body: JSON.stringify(proposal) }, boundEnv)).status).toBe(400);
    expect((await boundApp.request("http://localhost/api/market-proposals/prepare-bond", { method: "POST", headers: { authorization: "Bearer test", "x-wallet-address": proposer }, body: JSON.stringify(proposal) }, { ...boundEnv, PROPOSAL_BOND_ESCROW: escrow, USDC_ADDRESS: usdc })).status).toBe(200);
  });

  it("returns durable proposal state through the injected submission boundary", async () => {
    const status = { proposalId: `0x${"88".repeat(32)}` as `0x${string}`, proposer, status: "PENDING_BOND" as const, bondStatus: "CONFIRMED" as const, revisionCount: 0, workflowStatus: "RUNNING" as const };
    const service = { prepareBond: prepareProposalBond, submit: async () => status };
    const submitApp = createApiApp(() => model, liveQuote, service, testAuth);
    const response = await submitApp.request("http://localhost/api/market-proposals", { method: "POST", headers: { authorization: "Bearer test", "x-wallet-address": proposer }, body: JSON.stringify({ proposal, bondTxHash: `0x${"99".repeat(32)}` }) }, { ...boundEnv, BASE_RPC: env.BASE_RPC, PROPOSAL_BOND_ESCROW: escrow, USDC_ADDRESS: usdc });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ bondStatus: "CONFIRMED", workflowStatus: "RUNNING" });
  });
});
