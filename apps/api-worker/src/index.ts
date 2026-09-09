import { Hono } from "hono";
import { z } from "zod";
import { CHAIN, ProposalSchema, QuoteRequestSchema } from "@genetia/shared";
import { createMarketReadModel, type MarketReadModel } from "./read-model";

type Env = { DB?: Hyperdrive; BASE_CHAIN_ID: string; GENLAYER_CHAIN_ID: string; GENLAYER_RPC: string };
type ReadModelFactory = (db: Hyperdrive) => MarketReadModel;
const id = z.string().min(1).max(128);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const auth = (value: string | undefined) => Boolean(value?.startsWith("Bearer ") && value.length > 7);

export function createApiApp(factory: ReadModelFactory = createMarketReadModel) {
const app = new Hono<{ Bindings: Env }>().basePath("/api");
app.get("/health", (c) => c.json({ ok: true, baseChainId: CHAIN.base, genlayerChainId: CHAIN.genlayer, database: Boolean(c.env.DB) }));
app.get("/markets", async (c) => {
  if (!c.env.DB) return c.json({ error: "indexed market source is not configured" }, 503);
  const suppliedCursor = c.req.query("cursor");
  if (suppliedCursor) { try { const parsed = JSON.parse(atob(suppliedCursor)) as { createdAt?: unknown; id?: unknown }; if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") throw new Error("invalid cursor"); } catch { return c.json({ error: "invalid cursor" }, 400); } }
  const limit = Number(c.req.query("limit") ?? "25");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return c.json({ error: "limit must be an integer from 1 to 100" }, 400);
  const engine = c.req.query("engine"); if (engine && !["POOL", "LMSR"].includes(engine)) return c.json({ error: "invalid engine" }, 400);
  const status = c.req.query("status");
  try { return c.json(await factory(c.env.DB).listMarkets({ category: c.req.query("category"), engine, status, cursor: c.req.query("cursor"), limit })); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400); }
});
app.get("/markets/:id", async (c) => {
  const marketId = id.parse(c.req.param("id"));
  if (!c.env.DB) return c.json({ error: "indexed market source is not configured" }, 503);
  const market = await factory(c.env.DB).getMarket(marketId);
  return market ? c.json(market) : c.json({ error: "market not found" }, 404);
});
for (const suffix of ["prices", "trades", "liquidity", "resolution", "evidence"] as const) app.get(`/markets/:id/${suffix}`, async (c) => {
  const marketId = id.parse(c.req.param("id"));
  if (!c.env.DB) return c.json({ error: "indexed market source is not configured" }, 503);
  if (suffix === "prices") { const prices = await factory(c.env.DB).getPrices(marketId); return prices ? c.json(prices) : c.json({ error: "market not found" }, 404); }
  const collection = suffix === "trades" ? "trades" : suffix === "liquidity" ? "liquidity" : suffix === "resolution" ? "resolution" : "evidence";
  return c.json(await factory(c.env.DB).getMarketCollection(marketId, collection));
});
app.post("/markets/:id/quote", async (c) => {
  id.parse(c.req.param("id"));
  const parsed = QuoteRequestSchema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success ? c.json({ error: "on-chain quote required", request: parsed.data }, 501) : c.json({ error: "invalid quote", issues: parsed.error.issues }, 400);
});
app.post("/markets/:id/prepare-trade", (c) => auth(c.req.header("authorization")) ? c.json({ error: "wallet authorization required" }, 501) : c.json({ error: "Privy authentication required" }, 401));
app.post("/market-proposals", async (c) => {
  if (!auth(c.req.header("authorization"))) return c.json({ error: "Privy authentication required" }, 401);
  const parsed = ProposalSchema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success ? c.json({ error: "proposal workflow binding required" }, 501) : c.json({ error: "invalid proposal", issues: parsed.error.issues }, 400);
});
app.get("/market-proposals/:id", async (c) => {
  const proposalId = id.parse(c.req.param("id"));
  if (!c.env.DB) return c.json({ error: "proposal source is not configured" }, 503);
  const proposal = await factory(c.env.DB).getProposal(proposalId);
  return proposal ? c.json(proposal) : c.json({ error: "proposal not found" }, 404);
});
app.get("/users/:address/positions", async (c) => { const wallet = address.parse(c.req.param("address")); return c.env.DB ? c.json(await factory(c.env.DB).getPositions(wallet)) : c.json({ error: "indexed position source is not configured" }, 503); });
app.get("/users/:address/history", async (c) => { const wallet = address.parse(c.req.param("address")); return c.env.DB ? c.json(await factory(c.env.DB).getHistory(wallet)) : c.json({ error: "indexed history source is not configured" }, 503); });
return app;
}
const app = createApiApp();
export default app;
