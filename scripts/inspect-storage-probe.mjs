import fs from "node:fs";
import { createAccount, createClient } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";
const env = Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }));
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(env.RESOLVER_PRIVATE_KEY || env.GENLAYER_PRIVATE_KEY) });
const tx = await client.getTransaction({ hash: "0xf832a45f928a89bf38b3de5442894f21287cc5cfd6d6b3eb859c275db0b9c6ef" });
console.log(JSON.stringify({ to: tx.to, recipient: tx.recipient, result: tx.result, tx_data: tx.tx_data, keys: Object.keys(tx) }, null, 2));
