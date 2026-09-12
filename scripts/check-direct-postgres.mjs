import fs from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "../apps/api-worker/node_modules/pg/lib/index.js";

const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => {
  const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")];
}));
// Local diagnostic override allows a separately configured session-pooler
// comparison when the Direct origin is unreachable from this machine. It is
// never read by Worker production code and does not alter the Hyperdrive origin.
const connectionString = process.env.GENETIA_DB_PROBE_URL || env.HYPERDRIVE_ORIGIN_URL;
if (!connectionString) throw new Error("HYPERDRIVE_ORIGIN_URL is not configured");
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 12000, query_timeout: 12000 });
const key = `integration-probe:${randomUUID()}`;
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL search_path TO genetia_app");
  const metadata = await client.query("SELECT current_database() AS database, current_schema() AS schema, current_setting('search_path') AS search_path, to_regclass('genetia_app.\"WorkflowState\"') IS NOT NULL AS workflow_table");
  const row = metadata.rows[0];
  if (row.database !== "postgres" || row.schema !== "genetia_app" || !row.workflow_table) throw new Error("database/schema target verification failed");
  await client.query(`INSERT INTO genetia_app."WorkflowState" ("idempotencyKey", "workflowType", "state", "payload", "updatedAt") VALUES ($1, 'integration-probe', 'READY', '{}'::jsonb, NOW())`, [key]);
  const read = await client.query(`SELECT "idempotencyKey", "workflowType", "state" FROM genetia_app."WorkflowState" WHERE "idempotencyKey" = $1`, [key]);
  if (read.rowCount !== 1 || read.rows[0].idempotencyKey !== key || read.rows[0].workflowType !== "integration-probe") throw new Error("probe readback mismatch");
  await client.query(`DELETE FROM genetia_app."WorkflowState" WHERE "idempotencyKey" = $1`, [key]);
  await client.query("COMMIT");
  console.log(JSON.stringify({ connected: true, database: row.database, schema: row.schema, searchPath: row.search_path, workflowTable: row.workflow_table, createReadDelete: true }));
} catch (error) {
  try { await client.query("ROLLBACK"); } catch {}
  console.error(JSON.stringify({ connected: false, code: error?.code ?? null, name: error?.name ?? "Error", message: String(error?.message ?? "database probe failed").replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted]") }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
