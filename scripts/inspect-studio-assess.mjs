import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAccount, createClient, isSuccessful } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
}));
const key = env.RESOLVER_PRIVATE_KEY || env.GENLAYER_PRIVATE_KEY;
const address = "0xb08f7Cbba3Fd55BFe86dd3A1c090f38f76435b33";
const proposalId = "studio-integration-proposal-007";
const txHash = "0x9e876c11997f6e1d10bdf9b28402804884f41bace504a832528980fa5d586e2d";
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(key) });
const tx = await client.getTransaction({ hash: txHash });
const reads = {};
for (const variant of ["latest-final", "latest-nonfinal", undefined]) {
  const label = variant ?? "default";
  try { reads[label] = await client.readContract({ address, functionName: "get_assessment", args: [proposalId], ...(variant ? { transactionHashVariant: variant } : {}) }); }
  catch (error) { reads[label] = `ERROR: ${String(error).split("\\n")[0]}`; }
}
const decoded = tx?.txDataDecoded;
console.log(JSON.stringify({
  statusName: tx?.statusName,
  txExecutionResultName: tx?.txExecutionResultName,
  isSuccessful: tx ? isSuccessful(tx) : false,
  recipient: tx?.recipient,
  decodedType: typeof decoded,
  decodedKeys: decoded && typeof decoded === "object" ? Object.keys(decoded) : [],
  decodedReturn: decoded?.returnData ?? decoded?.return_data ?? decoded?.result ?? null,
  txKeys: tx ? Object.keys(tx).filter((key) => !/private|secret|key/i.test(key)) : [],
  contractStateHash: tx?.contractStateHash ?? tx?.contract_state_hash ?? null,
  result: typeof tx?.result === "string" ? tx.result : null,
  reads,
}));
