import fs from "node:fs";
import { createAccount, createClient } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";
const env = Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }));
const address = "0xb2A1D1599DB912129BDda9846D836CD3d279D9f1";
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(env.RESOLVER_PRIVATE_KEY || env.GENLAYER_PRIVATE_KEY) });
const reads = {};
for (const [label, functionName, args] of [["present", "get", ["alpha"]], ["missing", "get", ["missing"]], ["metadata", "metadata", []]]) {
  try { reads[label] = await client.readContract({ address, functionName, args, transactionHashVariant: "latest-final" }); }
  catch (error) { reads[label] = `ERROR: ${String(error).split("\\n")[0]}`; }
}
console.log(JSON.stringify({ address, reads }));
