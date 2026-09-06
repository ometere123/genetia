import { Hono } from "hono";
import { z } from "zod";
import { CHAIN, ProposalSchema, QuoteRequestSchema } from "@genetia/shared";
import { createMarketReadModel } from "./read-model";

type Env = { DB?: Hyperdrive; BASE_CHAIN_ID: string; GENLAYER_CHAIN_ID: string; GENLAYER_RPC: string };
const app = new Hono<{ Bindings: Env }>().basePath("/api");
const id = z.string().min(1).max(128);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const auth = (value: string | undefined) => Boolean(value?.startsWith("Bearer ") && value.length > 7);

app.get("/health", (c) => c.json({ ok: true, baseChainId: CHAIN.base, genlayerChainId: CHAIN.genlayer, database: Boolean(c.env.DB) }));
app.get("/markets", async (c) => {
  if (!c.env.DB) return c.json({ error: "indexed market source is not configured" }, 503);
  return c.json(await createMarketReadModel(c.env.DB).listMarkets(c.req.query("category")));
});
app.get("/markets/:id", async (c) => {
  const marketId = id.parse(c.req.param("id"));
  if (!c.env.DB) return c.json({ error: "indexed market source is not configured" }, 503);
  const market = await createMarketReadModel(c.env.DB).getMarket(marketId);
  return market ? c.json(market) : c.json({ error: "market not found" }, 404);
});
for (const suffix of ["prices", "trades", "liquidity", "resolution", "evidence"] as const) app.get(`/markets/:id/${suffix}`, async (c) => {
  const marketId = id.parse(c.req.param("id"));
  if (!c.env.DB) return c.json({ error: "indexed market source is not configured" }, 503);
  if (suffix === "prices") return c.json({ marketId, source: "Base", prices: null });
  const collection = suffix === "trades" ? "trades" : suffix === "liquidity" ? "liquidity" : suffix === "resolution" ? "resolution" : "evidence";
  return c.json(await createMarketReadModel(c.env.DB).getMarketCollection(marketId, collection));
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
  const proposal = await createMarketReadModel(c.env.DB).getProposal(proposalId);
  return proposal ? c.json(proposal) : c.json({ error: "proposal not found" }, 404);
});
app.get("/users/:address/positions", async (c) => { const wallet = address.parse(c.req.param("address")); return c.env.DB ? c.json(await createMarketReadModel(c.env.DB).getPositions(wallet)) : c.json({ error: "indexed position source is not configured" }, 503); });
app.get("/users/:address/history", async (c) => { const wallet = address.parse(c.req.param("address")); return c.env.DB ? c.json(await createMarketReadModel(c.env.DB).getHistory(wallet)) : c.json({ error: "indexed history source is not configured" }, 503); });
export default app;
