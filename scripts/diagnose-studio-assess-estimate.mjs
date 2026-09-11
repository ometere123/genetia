import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAccount, createClient } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }));
const key = env.RESOLVER_PRIVATE_KEY || env.GENLAYER_PRIVATE_KEY;
const address = "0xf1935C55735b665B10C37613914B2EBE55Ac27CA";
const proposalId = "studio-integration-proposal-diagnostic";
const manifest = fs.readFileSync(path.join(root, "contracts/genlayer/fixtures/studio-assess-002.json"), "utf8");
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(key) });
try { const estimate = await client.estimateTransactionFeesForWrite({ address, functionName: "assess", args: [proposalId, manifest] }); console.log(JSON.stringify({ ok: true, feeValue: estimate.feeValue.toString() })); }
catch (error) {
  const stderr = error?.cause?.details?.data?.receipt?.genvm_result?.stderr || error?.details?.data?.receipt?.genvm_result?.stderr || "";
  console.log(JSON.stringify({ ok: false, stderr: String(stderr).split(/\r?\n/).filter(Boolean).slice(-12).map((line) => line.replace(/private_key[^,}]*/gi, "private_key:[REDACTED]")) }));
}
