import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAccount, createClient, isSuccessful } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
  }),
);
const privateKey = env.RESOLVER_PRIVATE_KEY || env.GENLAYER_PRIVATE_KEY;
if (!privateKey) throw new Error("missing GenLayer signer");

const code = fs.readFileSync(path.join(root, "contracts/genlayer/market_admissibility.py"), "utf8");
const sourceSha256 = crypto.createHash("sha256").update(code).digest("hex");
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(privateKey) });
const estimate = await client.estimateTransactionFees();
const tx = await client.deployContract({ code, fees: { distribution: estimate.distribution, feeValue: estimate.feeValue } });
console.log(JSON.stringify({ tx, sourceSha256, feeValue: estimate.feeValue.toString(), distribution: { leader: estimate.distribution.leaderTimeunitsAllocation.toString(), validator: estimate.distribution.validatorTimeunitsAllocation.toString(), appeal: estimate.distribution.appealRounds.toString(), executionBudget: estimate.distribution.executionBudgetPerRound.toString(), rotations: estimate.distribution.rotations.map(String) } }));
const final = await client.waitForFinalization({ hash: tx });
const address = final.recipient;
console.log(JSON.stringify({ statusName: final.statusName, txExecutionResultName: final.txExecutionResultName, isSuccessful: isSuccessful(final), recipient: address }));
if (!isSuccessful(final) || final.txExecutionResultName !== "FINISHED_WITH_RETURN") process.exit(2);
const deployed = await client.getContractCode(address);
const schema = await client.getContractSchema(address);
console.log(JSON.stringify({ deployedSha256: crypto.createHash("sha256").update(deployed).digest("hex"), schema }));
if (deployed !== code) process.exit(3);
