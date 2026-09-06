import { PrismaClient } from "@prisma/client";
export * from "./indexer";
export * from "./repositories";
export * from "./base-events";
export * from "./projections";
export * from "./base-indexer";

/** Indexed data is reconstructible; this client is never a custody ledger. */
export function createDatabaseClient(databaseUrl: string): PrismaClient {
  if (!databaseUrl.startsWith("postgres")) throw new Error("Supabase/Hyperdrive PostgreSQL URL required");
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
