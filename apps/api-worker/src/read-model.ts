import { Client, type QueryResultRow } from "pg";
import { MarketSchema, normalizeMarketCategory } from "@genetia/shared";

export interface MarketReadModel {
  listMarkets(options: { category?: string; engine?: string; status?: string; search?: string; cursor?: string; limit?: number }): Promise<{ items: unknown[]; nextCursor: string | null }>;
  getMarket(marketId: string): Promise<unknown | null>;
  getMarketCollection(marketId: string, collection: "trades" | "liquidity" | "evidence" | "resolution"): Promise<unknown[] | null>;
  getPositions(address: string): Promise<unknown[]>;
  getHistory(address: string): Promise<unknown[]>;
  getProposal(proposalId: string): Promise<unknown | null>;
  getPrices(marketId: string): Promise<unknown | null>;
}

type HyperdriveLike = { connectionString: string };
type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<QueryResultRow[]>;
const proposalCache = new Map<string, { value: unknown; expiresAt: number }>();

function hyperdriveSql(connectionString: string): Sql {
  return async (strings, ...values) => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i++) text += "$" + (i + 1) + (strings[i + 1] ?? "");
    const client = new Client({ connectionString });
    try {
      await client.connect();
      const result = await client.query(text, values);
      return result.rows;
    } finally {
      await client.end();
    }
  };
}

export function marketRow(row: Record<string, unknown>): unknown {
  const field = (camel: string, snake: string) => row[camel] ?? row[snake];
  const date = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
  const manifest = (field("manifestJson", "manifest_json") ?? {}) as Record<string, unknown>;
  const engine = field("engine", "engine");
  // Prisma's terminal lifecycle is intentionally named TERMINAL. The public
  // discovery contract uses RESOLVED, so normalize at this read-model
  // boundary instead of leaking the persistence enum into the UI.
  const status = String(field("status", "status") ?? "");
  const poolYes = field("poolYesTotal", "pool_yes_total");
  const poolNo = field("poolNoTotal", "pool_no_total");
  return MarketSchema.parse({
    id: field("id", "id"), marketId: field("marketId", "market_id"), engine: field("engine", "engine"), title: field("title", "title"),
    question: field("question", "question"), description: field("description", "description"), category: normalizeMarketCategory(String(field("category", "category") ?? "other")), status: status === "TERMINAL" ? "RESOLVED" : status,
    creatorAddress: field("creatorAddress", "creator_address"), baseAddress: field("baseAddress", "base_address"),
    financialReleaseId: field("financialReleaseId", "financial_release_id"), resolverAddress: field("resolverAddress", "resolver_address"),
    resolverReleaseId: field("resolverReleaseId", "resolver_release_id"), manifestHash: field("manifestHash", "manifest_hash"),
    closeTime: date(field("closeTime", "close_time")), resolutionAvailableTime: date(field("resolutionAvailableTime", "resolution_available_time")),
    terminalDeadline: date(field("terminalDeadline", "terminal_deadline")), terminalOutcome: field("terminalOutcome", "terminal_outcome") ?? null,
    pool: engine === "POOL" ? { yesTotal: String(poolYes ?? "0"), noTotal: String(poolNo ?? "0") } : undefined,
    yesDefinition: manifest.yes_definition, noDefinition: manifest.no_definition,
  });
}

function decodeCursor(value: string | undefined): { createdAt: string; id: string } | null {
  if (!value) return null;
  try { const parsed = JSON.parse(atob(value)) as { createdAt?: string; id?: string }; return parsed.createdAt && parsed.id ? { createdAt: parsed.createdAt, id: parsed.id } : null; }
  catch { throw new Error("invalid cursor"); }
}
function encodeCursor(value: { createdAt: unknown; id: unknown }): string { return btoa(JSON.stringify({ createdAt: String(value.createdAt), id: String(value.id) })); }

export function createMarketReadModel(db: HyperdriveLike): MarketReadModel {
  const sql = hyperdriveSql(db.connectionString);
  return {
    async listMarkets(options) {
      const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
      const cursor = decodeCursor(options.cursor);
      const search = options.search?.trim();
      const rows = await sql`
        WITH market_rows AS (
          SELECT *, trim(both '-' from regexp_replace(regexp_replace(lower(trim("category")), '[^a-z0-9-]+', '-', 'g'), '-+', '-', 'g')) AS category_slug
          FROM "genetia_app"."Market"
        )
        SELECT * FROM market_rows
        WHERE (${options.category ?? null}::text IS NULL OR CASE
            WHEN category_slug IN ('technology','tech','ai','technology-ai') THEN 'tech-ai'
            WHEN category_slug IN ('internet','social','internet-and-social','internet-social-media') THEN 'internet-social'
            WHEN category_slug IN ('crypto','sports','politics','macro','tech-ai','science','business','entertainment','culture','geopolitics','internet-social','other') THEN category_slug
            ELSE 'other' END = ${options.category ?? null})
          AND (${options.engine ?? null}::text IS NULL OR "engine"::text = ${options.engine ?? null})
          AND (${options.status ?? null}::text IS NULL OR "status"::text = ${options.status ?? null})
          AND (${search ?? null}::text IS NULL OR strpos(lower(concat_ws(' ', "title", "question", "description", "category", "marketId")), lower(${search ?? null})) > 0)
          AND (${cursor?.createdAt ?? null}::timestamptz IS NULL OR ("createdAt", "id") < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}))
        ORDER BY "createdAt" DESC, "id" DESC LIMIT ${limit + 1}`;
      const page = rows.slice(0, limit);
      const last = page.at(-1) as Record<string, unknown> | undefined;
      return { items: page.map((row) => marketRow(row as Record<string, unknown>)), nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null };
    },
    async getMarket(marketId) {
      const rows = await sql`SELECT * FROM "genetia_app"."Market" WHERE "marketId" = ${marketId} LIMIT 1`;
      return rows[0] ? marketRow(rows[0] as Record<string, unknown>) : null;
    },
    async getMarketCollection(marketId, collection) {
      const marketRows = await sql`SELECT id FROM "genetia_app"."Market" WHERE "marketId" = ${marketId} LIMIT 1`;
      if (!marketRows[0]) return null;
      if (collection === "trades") return sql`SELECT * FROM "genetia_app"."Trade" WHERE "marketId" IN (SELECT id FROM "genetia_app"."Market" WHERE "marketId" = ${marketId}) ORDER BY "createdAt" DESC LIMIT 200`;
      if (collection === "liquidity") return sql`SELECT * FROM "genetia_app"."LiquidityActivity" WHERE "marketId" IN (SELECT id FROM "genetia_app"."Market" WHERE "marketId" = ${marketId}) ORDER BY "createdAt" DESC LIMIT 200`;
      if (collection === "evidence") return sql`SELECT * FROM "genetia_app"."Evidence" WHERE "marketId" IN (SELECT id FROM "genetia_app"."Market" WHERE "marketId" = ${marketId}) ORDER BY "fetchedAt" DESC LIMIT 200`;
      return sql`SELECT * FROM "genetia_app"."ResolutionAttempt" WHERE "marketId" IN (SELECT id FROM "genetia_app"."Market" WHERE "marketId" = ${marketId}) ORDER BY "attemptNo" DESC LIMIT 200`;
    },
    async getPositions(address) {
      return sql`SELECT * FROM "genetia_app"."Trade" WHERE lower("walletAddress") = lower(${address}) ORDER BY "createdAt" DESC LIMIT 500`;
    },
    async getHistory(address) {
      return sql`SELECT * FROM "genetia_app"."Trade" WHERE lower("walletAddress") = lower(${address}) ORDER BY "createdAt" DESC LIMIT 500`;
    },
    async getProposal(proposalId) {
      const cached = proposalCache.get(proposalId);
      try {
        const rows = await sql`SELECT p.*, lower(w."address") AS "proposerAddress"
          FROM "genetia_app"."Proposal" p
          LEFT JOIN "genetia_app"."Wallet" w ON w."userId" = p."proposerUserId" AND w."chainId" = 84532
          WHERE p."proposalId" = ${proposalId} OR p."proposalKey" = ${proposalId} LIMIT 1`;
        if (!rows[0]) return null;
        const row = rows[0] as Record<string, unknown>;
        const workflow = String(row.workflowStatus ?? "PENDING_BOND");
        const value = {
          proposalId: row.proposalId ?? row.proposalKey,
          proposer: row.proposerAddress,
          status: row.decision === "NEEDS_REVISION" ? "NEEDS_REVISION" : row.decision === "APPROVED" ? "APPROVED" : row.decision === "REJECTED" ? "REJECTED" : workflow === "PENDING_BOND" ? "PENDING_BOND" : "ADMISSIBILITY_SUBMITTED",
          bondStatus: row.bondStatus,
          revisionCount: Number(row.revision ?? 0),
          workflowStatus: workflow === "PENDING_BOND" ? "NOT_STARTED" : workflow === "BOND_CONFIRMED" ? "RUNNING" : workflow === "COMPLETE" ? "COMPLETE" : workflow === "FAILED" ? "FAILED" : "WAITING_FINALITY",
          issues: Array.isArray(row.decisionIssueCodes) ? row.decisionIssueCodes : undefined,
          manifestHash: row.manifestHash ?? undefined,
          resolver: row.resolverAddress ?? undefined,
          baseMarket: row.baseMarketAddress ?? undefined,
          marketId: row.marketId ?? undefined,
          updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt ? String(row.updatedAt) : undefined,
        };
        proposalCache.set(proposalId, { value, expiresAt: Date.now() + 60000 });
        return value;
      } catch (error) {
        if (cached && cached.expiresAt > Date.now()) return cached.value;
        throw error;
      }
    },
    async getPrices(marketId) {
      const rows = await sql`SELECT "engine", "poolYesTotal", "poolNoTotal", "lmsrB", "lmsrFundingTarget", "status" FROM "genetia_app"."Market" WHERE "marketId" = ${marketId} LIMIT 1`;
      if (!rows[0]) return null;
      const row = rows[0] as Record<string, unknown>;
      if (row.engine === "POOL") return { marketId, engine: "POOL", yesTotal: String(row.poolYesTotal ?? "0"), noTotal: String(row.poolNoTotal ?? "0") };
      const projections = await sql`SELECT payload FROM "genetia_app"."DerivedProjection" WHERE "projectionKey" = ${`market:${marketId}`} LIMIT 1`;
      const payload = (projections[0]?.payload ?? {}) as Record<string, unknown>;
      return { marketId, engine: "LMSR", b: String(row.lmsrB ?? "0"), fundingTarget: String(row.lmsrFundingTarget ?? "0"), qYes: String(payload.qYes ?? "0"), qNo: String(payload.qNo ?? "0"), status: row.status };
    },
  };
}

