import fs from "node:fs";
import path from "node:path";
import { createAccount, createClient } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";

const root = process.cwd();
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
}));
const key = env.GENLAYER_PRIVATE_KEY || env.RESOLVER_PRIVATE_KEY;
if (!key) throw new Error("GenLayer signer configuration missing");
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(key) });
const account = createAccount(key);
// Studio Dev's RC endpoint accepts only the address argument even though the
// SDK's broader method union also documents an optional filter.
const result = await client.request({ method: "sim_getTransactionsForAddress", params: [account.address] });
const values = Array.isArray(result) ? result : result && typeof result === "object" ? Object.values(result) : [];
const sample = values.slice(0, 5).map((value) => {
  if (typeof value === "string") return { hash: value };
  if (!value || typeof value !== "object") return { type: typeof value };
  const record = value;
  return {
    hash: record.hash ?? record.txId ?? record.transaction_hash ?? record.transactionHash,
    from: record.from_address ?? record.from ?? record.sender,
    to: record.recipient ?? record.to_address ?? record.to,
    status: record.statusName ?? record.status,
    hasData: Boolean(record.txData ?? record.data),
    topLevelKeys: Object.keys(record).sort(),
    dataKeys: record.data && typeof record.data === "object" ? Object.keys(record.data).sort() : [],
    decodedKeys: record.txDataDecoded && typeof record.txDataDecoded === "object" ? Object.keys(record.txDataDecoded).sort() : [],
    decodedMethod: record.txDataDecoded && typeof record.txDataDecoded === "object" ? (record.txDataDecoded.callData?.method ?? record.txDataDecoded.callData?.functionName ?? record.txDataDecoded.method) : undefined,
  };
});
console.log(JSON.stringify({ account: account.address, responseType: Array.isArray(result) ? "array" : typeof result, count: values.length, sample }));
