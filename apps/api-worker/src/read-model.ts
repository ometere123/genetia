import { neon } from "@neondatabase/serverless";
import { MarketSchema } from "@genetia/shared";

export interface MarketReadModel {
  listMarkets(category?: string): Promise<unknown[]>;
  getMarket(marketId: string): Promise<unknown | null>;
  getMarketCollection(marketId: string, collection: "trades" | "liquidity" | "evidence" | "resolution"): Promise<unknown[]>;
  getPositions(address: string): Promise<unknown[]>;
  getHistory(address: string): Promise<unknown[]>;
  getProposal(proposalId: string): Promise<unknown | null>;
}

type HyperdriveLike = { connectionString: string };

function marketRow(row: Record<string, unknown>): unknown {
  return MarketSchema.parse({
    id: row.id, marketId: row.market_id, engine: row.engine, title: row.title,
    question: row.question, description: row.description, category: row.category, status: row.status,
    creatorAddress: row.creator_address, baseAddress: row.base_address,
    financialReleaseId: row.financial_release_id, resolverAddress: row.resolver_address,
    resolverReleaseId: row.resolver_release_id, manifestHash: row.manifest_hash,
    closeTime: row.close_time, resolutionAvailableTime: row.resolution_available_time,
    terminalDeadline: row.terminal_deadline, terminalOutcome: row.terminal_outcome ?? null,
  });
}

export function createMarketReadModel(db: HyperdriveLike): MarketReadModel {
  const sql = neon(db.connectionString);
  return {
    async listMarkets(category) {
      const rows = category
        ? await sql`SELECT * FROM "Market" WHERE category = ${category} ORDER BY "createdAt" DESC LIMIT 200`
        : await sql`SELECT * FROM "Market" ORDER BY "createdAt" DESC LIMIT 200`;
      return rows.map((row) => marketRow(row as Record<string, unknown>));
    },
    async getMarket(marketId) {
      const rows = await sql`SELECT * FROM "Market" WHERE "marketId" = ${marketId} LIMIT 1`;
      return rows[0] ? marketRow(rows[0] as Record<string, unknown>) : null;
    },
    async getMarketCollection(marketId, collection) {
      if (collection === "trades") return sql`SELECT * FROM "Trade" WHERE "marketId" IN (SELECT id FROM "Market" WHERE "marketId" = ${marketId}) ORDER BY "createdAt" DESC LIMIT 200`;
      if (collection === "liquidity") return sql`SELECT * FROM "LiquidityActivity" WHERE "marketId" IN (SELECT id FROM "Market" WHERE "marketId" = ${marketId}) ORDER BY "createdAt" DESC LIMIT 200`;
      if (collection === "evidence") return sql`SELECT * FROM "Evidence" WHERE "marketId" IN (SELECT id FROM "Market" WHERE "marketId" = ${marketId}) ORDER BY "fetchedAt" DESC LIMIT 200`;
      return sql`SELECT * FROM "ResolutionAttempt" WHERE "marketId" IN (SELECT id FROM "Market" WHERE "marketId" = ${marketId}) ORDER BY "attemptNo" DESC LIMIT 200`;
    },
    async getPositions(address) {
      return sql`SELECT * FROM "Trade" WHERE lower("walletAddress") = lower(${address}) ORDER BY "createdAt" DESC LIMIT 500`;
    },
    async getHistory(address) {
      return sql`SELECT * FROM "Trade" WHERE lower("walletAddress") = lower(${address}) ORDER BY "createdAt" DESC LIMIT 500`;
    },
    async getProposal(proposalId) {
      const rows = await sql`SELECT * FROM "Proposal" WHERE id = ${proposalId} OR "proposalKey" = ${proposalId} LIMIT 1`;
      return rows[0] ?? null;
    },
  };
}
