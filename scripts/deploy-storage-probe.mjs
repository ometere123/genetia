import fs from "node:fs";
import crypto from "node:crypto";
import { createAccount, createClient, isSuccessful } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";

const root = new URL("../", import.meta.url);
const env = Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }));
const key = env.RESOLVER_PRIVATE_KEY || env.GENLAYER_PRIVATE_KEY;
const code = fs.readFileSync(new URL("../contracts/genlayer/fixtures/storage_probe.py", import.meta.url), "utf8");
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(key) });
const schema = await client.getContractSchemaForCode(code);
console.log(JSON.stringify({ sourceSha256: crypto.createHash("sha256").update(code).digest("hex"), schemaKeys: Object.keys(schema ?? {}) }));
const estimate = await client.estimateTransactionFees({ code });
const tx = await client.deployContract({ code, fees: { distribution: estimate.distribution, feeValue: estimate.feeValue } });
const final = await client.waitForFinalization({ hash: tx, interval: 5000, retries: 180, fullTransaction: true });
console.log(JSON.stringify({ tx, statusName: final.statusName, txExecutionResultName: final.txExecutionResultName, isSuccessful: isSuccessful(final), recipient: final.recipient }));
if (!isSuccessful(final)) process.exit(2);
const address = final.recipient;
const putEstimate = await client.estimateTransactionFeesForWrite({ address, functionName: "put", args: ["alpha", "beta"] });
const putTx = await client.writeContract({ address, functionName: "put", args: ["alpha", "beta"], fees: { distribution: putEstimate.distribution, feeValue: putEstimate.feeValue } });
const putFinal = await client.waitForFinalization({ hash: putTx, interval: 5000, retries: 180, fullTransaction: true });
const reads = {};
for (const functionName of ["get", "metadata"]) {
  try { reads[functionName] = await client.readContract({ address, functionName, args: functionName === "get" ? ["alpha"] : [], transactionHashVariant: "latest-final" }); }
  catch (error) { reads[functionName] = `ERROR: ${String(error).split("\\n")[0]}`; }
}
console.log(JSON.stringify({ address, putTx, putStatusName: putFinal.statusName, putExecution: putFinal.txExecutionResultName, putSuccessful: isSuccessful(putFinal), reads }));
