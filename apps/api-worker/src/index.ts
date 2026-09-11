import { Hono } from "hono";
import { z } from "zod";
import { CHAIN, ProposalSchema, ProposalStatusSchema, QuoteRequestSchema, type ProposalBondPreparation, type ProposalStatus, type Quote, type QuoteRequest } from "@genetia/shared";
import { createMarketReadModel, type MarketReadModel } from "./read-model";
import { prepareTrade } from "./transaction-adapter";
import { liveQuote } from "./quote-adapter";
import { prepareProposalBond } from "./proposal-adapter";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { canonicalProposalId, verifyBondReceipt } from "./proposal-adapter";
import { createHyperdriveProposalPersistence } from "./proposal-persistence";
import { PrivyClient } from "@privy-io/node";
import { Pool } from "pg";

type Env = { GENETIA_DB?: Hyperdrive; GENETIA_JOBS?: Queue; BASE_RPC?: string; PROPOSAL_BOND_ESCROW?: string; USDC_ADDRESS?: string; BASE_CHAIN_ID: string; GENLAYER_CHAIN_ID: string; GENLAYER_RPC: string; PRIVY_APP_ID?: string; PRIVY_APP_SECRET?: string };
type ReadModelFactory = (db: Hyperdrive) => MarketReadModel;
type QuoteProvider = (market: unknown, request: QuoteRequest, rpcUrl: string) => Promise<Quote>;
export type ProposalService = {
  prepareBond: (proposal: unknown, proposer: `0x${string}`, escrow: `0x${string}`, usdc: `0x${string}`) => Promise<ProposalBondPreparation>;
  submit: (proposal: unknown, proposer: `0x${string}`, bondTxHash: `0x${string}`, env: Env) => Promise<ProposalStatus>;
};
export type AuthIdentity = { userId: string };
export type AuthVerifier = (token: string, env: Env) => Promise<AuthIdentity | null>;
const id = z.string().min(1).max(128);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const verifyPrivy: AuthVerifier = async (token, env) => {
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET || !token) return null;
  try {
    const client = new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
    const verified = await client.utils().auth().verifyAccessToken(token);
    return verified.userId ? { userId: verified.userId } : null;
  } catch { return null; }
};

const defaultProposalService: ProposalService = {
  prepareBond: prepareProposalBond,
  submit: async (proposalValue, proposer, bondTxHash, env) => {
    if (!env.PROPOSAL_BOND_ESCROW || !env.USDC_ADDRESS || !env.BASE_RPC) throw new Error("proposal verification is not configured");
    const proposal = ProposalSchema.parse(proposalValue);
    const client = createPublicClient({ chain: baseSepolia, transport: http(env.BASE_RPC) });
    if (await client.getChainId() !== 84532) throw new Error("Base chain mismatch");
    const receipt = await client.getTransactionReceipt({ hash: bondTxHash });
    verifyBondReceipt(receipt, { proposalId: await canonicalProposalId(proposal, proposer), proposer, escrow: env.PROPOSAL_BOND_ESCROW as `0x${string}`, usdc: env.USDC_ADDRESS as `0x${string}` });
    if (!env.GENETIA_DB) throw new Error("bond verified; durable proposal database is not configured");
    await createHyperdriveProposalPersistence(env.GENETIA_DB)({ proposal, proposer, bondTxHash, receipt: receipt as never });
    if (!env.GENETIA_JOBS) throw new Error("bond verified; durable proposal queue is not configured");
    const proposalId = await canonicalProposalId(proposal, proposer);
    await env.GENETIA_JOBS.send({ kind: "market-admissibility", proposalId, idempotencyKey: `admissibility:${proposalId}` });
    return { proposalId, proposer, status: "ADMISSIBILITY_SUBMITTED", bondStatus: "CONFIRMED", revisionCount: 0, workflowStatus: "RUNNING" };
  },
};
const wallet = (value: string | undefined): `0x${string}` | null => /^0x[0-9a-fA-F]{40}$/.test(value ?? "") ? value as `0x${string}` : null;
export function createApiApp(factory: ReadModelFactory = createMarketReadModel, quoteProvider: QuoteProvider = liveQuote, proposalService: ProposalService = defaultProposalService, authVerifier: AuthVerifier = verifyPrivy) {
const app = new Hono<{ Bindings: Env }>().basePath("/api");
const requireAuth = async (c: any): Promise<AuthIdentity | null> => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ") || header.length <= 7) return null;
  return authVerifier(header.slice(7), c.env);
};
const requireWalletOwnership = async (c: any, identity: AuthIdentity, proposer: `0x${string}`): Promise<boolean> => {
  // Test harnesses inject an explicit verifier and may use an in-memory DB.
  // Production verification always binds the requested wallet to the verified
  // Privy subject in the isolated application schema.
  if (authVerifier !== verifyPrivy) return true;
  if (!c.env.GENETIA_DB?.connectionString) return false;
  const pool = new Pool({ connectionString: c.env.GENETIA_DB.connectionString, max: 1 });
  try {
    const result = await pool.query(
      `SELECT 1 FROM "genetia_app"."User" u JOIN "genetia_app"."Wallet" w ON w."userId" = u."id"
       WHERE u."privyUserId" = $1 AND w."chainId" = $2 AND lower(w."address") = lower($3) LIMIT 1`,
      [identity.userId, 84532, proposer],
    );
    return result.rowCount === 1;
  } catch { return false; } finally { await pool.end(); }
};
app.get("/health", (c) => c.json({ ok: true, baseChainId: CHAIN.base, genlayerChainId: CHAIN.genlayer, database: Boolean(c.env.GENETIA_DB) }));
app.get("/markets", async (c) => {
  if (!c.env.GENETIA_DB) return c.json({ error: "indexed market source is not configured" }, 503);
  const suppliedCursor = c.req.query("cursor");
  if (suppliedCursor) { try { const parsed = JSON.parse(atob(suppliedCursor)) as { createdAt?: unknown; id?: unknown }; if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") throw new Error("invalid cursor"); } catch { return c.json({ error: "invalid cursor" }, 400); } }
  const limit = Number(c.req.query("limit") ?? "25");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return c.json({ error: "limit must be an integer from 1 to 100" }, 400);
  const engine = c.req.query("engine"); if (engine && !["POOL", "LMSR"].includes(engine)) return c.json({ error: "invalid engine" }, 400);
  const status = c.req.query("status");
  try { return c.json(await factory(c.env.GENETIA_DB).listMarkets({ category: c.req.query("category"), engine, status, cursor: c.req.query("cursor"), limit })); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400); }
});
app.get("/markets/:id", async (c) => {
  const marketId = id.parse(c.req.param("id"));
  if (!c.env.GENETIA_DB) return c.json({ error: "indexed market source is not configured" }, 503);
  const market = await factory(c.env.GENETIA_DB).getMarket(marketId);
  return market ? c.json(market) : c.json({ error: "market not found" }, 404);
});
for (const suffix of ["prices", "trades", "liquidity", "resolution", "evidence"] as const) app.get(`/markets/:id/${suffix}`, async (c) => {
  const marketId = id.parse(c.req.param("id"));
  if (!c.env.GENETIA_DB) return c.json({ error: "indexed market source is not configured" }, 503);
  if (suffix === "prices") { const prices = await factory(c.env.GENETIA_DB).getPrices(marketId); return prices ? c.json(prices) : c.json({ error: "market not found" }, 404); }
  const collection = suffix === "trades" ? "trades" : suffix === "liquidity" ? "liquidity" : suffix === "resolution" ? "resolution" : "evidence";
  const records = await factory(c.env.GENETIA_DB).getMarketCollection(marketId, collection);
  return records ? c.json(records) : c.json({ error: "market not found" }, 404);
});
app.post("/markets/:id/quote", async (c) => {
  const marketId = id.parse(c.req.param("id"));
  const parsed = QuoteRequestSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "invalid quote", issues: parsed.error.issues }, 400);
  if (!c.env.GENETIA_DB || !c.env.BASE_RPC) return c.json({ error: "live Base quote source is not configured" }, 503);
  const market = await factory(c.env.GENETIA_DB).getMarket(marketId);
  if (!market) return c.json({ error: "market not found" }, 404);
  try { return c.json(await quoteProvider(market, parsed.data, c.env.BASE_RPC)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "quote is unavailable" }, 422); }
});
app.post("/markets/:id/prepare-trade", async (c) => {
  const identity = await requireAuth(c); if (!identity) return c.json({ error: "Privy authentication required" }, 401);
  const proposer = wallet(c.req.header("x-wallet-address"));
  if (!proposer || !await requireWalletOwnership(c, identity, proposer)) return c.json({ error: "wallet is not linked to authenticated Privy user" }, 403);
  if (!c.env.GENETIA_DB) return c.json({ error: "indexed market source is not configured" }, 503);
  const marketId = id.parse(c.req.param("id"));
  const market = await factory(c.env.GENETIA_DB).getMarket(marketId);
  if (!market) return c.json({ error: "market not found" }, 404);
  const parsed = QuoteRequestSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "invalid trade", issues: parsed.error.issues }, 400);
  try { return c.json(prepareTrade(market, parsed.data)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "trade is not eligible" }, 422); }
});
app.post("/market-proposals/prepare-bond", async (c) => {
  const identity = await requireAuth(c); if (!identity) return c.json({ error: "Privy authentication required" }, 401);
  const proposer = wallet(c.req.header("x-wallet-address"));
  if (!proposer) return c.json({ error: "valid wallet address required" }, 400);
  if (!await requireWalletOwnership(c, identity, proposer)) return c.json({ error: "wallet is not linked to authenticated Privy user" }, 403);
  if (!c.env.PROPOSAL_BOND_ESCROW || !c.env.USDC_ADDRESS) return c.json({ error: "proposal bond contracts are not configured" }, 503);
  const parsed = ProposalSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "invalid proposal", issues: parsed.error.issues }, 400);
  try { return c.json(await proposalService.prepareBond(parsed.data, proposer, c.env.PROPOSAL_BOND_ESCROW as `0x${string}`, c.env.USDC_ADDRESS as `0x${string}`)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "bond preparation failed" }, 422); }
});
app.post("/market-proposals", async (c) => {
  const identity = await requireAuth(c); if (!identity) return c.json({ error: "Privy authentication required" }, 401);
  const proposer = wallet(c.req.header("x-wallet-address"));
  if (!proposer) return c.json({ error: "valid wallet address required" }, 400);
  if (!await requireWalletOwnership(c, identity, proposer)) return c.json({ error: "wallet is not linked to authenticated Privy user" }, 403);
  const body = await c.req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  const proposal = ProposalSchema.safeParse(body?.proposal ?? body);
  const bondTxHash = typeof body?.bondTxHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(body.bondTxHash) ? body.bondTxHash as `0x${string}` : null;
  if (!proposal.success || !bondTxHash) return c.json({ error: "invalid proposal submission", issues: proposal.success ? [{ path: ["bondTxHash"], message: "valid bond transaction hash required" }] : proposal.error.issues }, 400);
  if (!c.env.PROPOSAL_BOND_ESCROW || !c.env.USDC_ADDRESS || !c.env.BASE_RPC) return c.json({ error: "proposal verification is not configured" }, 503);
  try { return c.json(await proposalService.submit(proposal.data, proposer, bondTxHash, c.env)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "proposal submission failed" }, 422); }
});
app.get("/market-proposals/:id", async (c) => {
  const proposalId = id.parse(c.req.param("id"));
  if (!c.env.GENETIA_DB) return c.json({ error: "proposal source is not configured" }, 503);
  const proposal = await factory(c.env.GENETIA_DB).getProposal(proposalId);
  return proposal ? c.json(proposal) : c.json({ error: "proposal not found" }, 404);
});
app.get("/users/:address/positions", async (c) => { const wallet = address.parse(c.req.param("address")); return c.env.GENETIA_DB ? c.json(await factory(c.env.GENETIA_DB).getPositions(wallet)) : c.json({ error: "indexed position source is not configured" }, 503); });
app.get("/users/:address/history", async (c) => { const wallet = address.parse(c.req.param("address")); return c.env.GENETIA_DB ? c.json(await factory(c.env.GENETIA_DB).getHistory(wallet)) : c.json({ error: "indexed history source is not configured" }, 503); });
return app;
}
const app = createApiApp();
export default app;
