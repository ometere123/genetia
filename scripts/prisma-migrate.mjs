import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2];
if (!new Set(["status", "deploy"]).has(action)) throw new Error("allowed actions: status, deploy");
const env = { ...process.env };
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  const index = line.indexOf("=");
  if (index < 1) continue;
  const name = line.slice(0, index).trim();
  if (name === "DIRECT_URL" || name === "DATABASE_URL") env[name] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
}
if (!env.DIRECT_URL || !env.DATABASE_URL) throw new Error("root ignored env file must define database migration variables");
const db = path.join(root, "packages/db");
const cli = path.join(db, "node_modules/prisma/build/index.js");
const result = spawnSync(process.execPath, [cli, "migrate", action, "--schema", "prisma/schema.prisma"], { cwd: db, env, stdio: "inherit" });
process.exit(result.status ?? 1);
