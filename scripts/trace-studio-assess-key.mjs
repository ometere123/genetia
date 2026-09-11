import fs from "node:fs";
import { createAccount, createClient } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";

const env = Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => {
  const i = line.indexOf("=");
  return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")];
}));
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(env.RESOLVER_PRIVATE_KEY || env.GENLAYER_PRIVATE_KEY) });
const tx = await client.getTransaction({ hash: "0x9e876c11997f6e1d10bdf9b28402804884f41bace504a832528980fa5d586e2d" });
const safe = (value) => typeof value === "string" && value.length > 2000 ? `${value.slice(0, 2000)}...[truncated]` : value;
console.log(JSON.stringify({
  statusName: tx.statusName,
  txExecutionResultName: tx.txExecutionResultName,
  recipient: tx.recipient,
  data: safe(tx.data),
  tx_data: safe(tx.tx_data),
  txData: safe(tx.txData),
  result: safe(tx.result),
  consensusDataKeys: tx.consensus_data && typeof tx.consensus_data === "object" ? Object.keys(tx.consensus_data) : [],
}, null, 2));
