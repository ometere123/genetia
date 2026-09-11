import fs from "node:fs";
import { createAccount, createClient, isSuccessful } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";
const env = Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }));
const address = "0xb2A1D1599DB912129BDda9846D836CD3d279D9f1";
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(env.RESOLVER_PRIVATE_KEY || env.GENLAYER_PRIVATE_KEY) });
console.log(JSON.stringify({ address, phase: "estimating" }));
const estimate = await client.estimateTransactionFeesForWrite({ address, functionName: "put", args: ["alpha", "beta"] });
console.log(JSON.stringify({ phase: "submitting" }));
const tx = await client.writeContract({ address, functionName: "put", args: ["alpha", "beta"], fees: { distribution: estimate.distribution, feeValue: estimate.feeValue } });
const final = await client.waitForFinalization({ hash: tx, interval: 5000, retries: 180, fullTransaction: true });
const reads = {};
for (const [functionName, args] of [["get", ["alpha"]], ["getMissing", ["missing"]], ["metadata", []]]) {
  try { reads[functionName] = await client.readContract({ address, functionName: functionName === "getMissing" ? "get" : functionName, args, transactionHashVariant: "latest-final" }); }
  catch (error) { reads[functionName] = `ERROR: ${String(error).split("\\n")[0]}`; }
}
console.log(JSON.stringify({ tx, statusName: final.statusName, txExecutionResultName: final.txExecutionResultName, isSuccessful: isSuccessful(final), reads }));
