import { PrismaClient } from "@prisma/client";
export * from "./indexer";

/** Indexed data is reconstructible; this client is never a custody ledger. */
export function createDatabaseClient(databaseUrl: string): PrismaClient {
  if (!databaseUrl.startsWith("postgres")) throw new Error("Supabase/Hyperdrive PostgreSQL URL required");
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}
