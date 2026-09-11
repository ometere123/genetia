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
if (!key) throw new Error("missing GenLayer signer");
const address = process.env.STUDIO_ADMISSIBILITY_ADDRESS || env.STUDIO_ADMISSIBILITY_ADDRESS || "0xf1935C55735b665B10C37613914B2EBE55Ac27CA";
const proposalId = process.env.STUDIO_ASSESS_PROPOSAL_ID || env.STUDIO_ASSESS_PROPOSAL_ID || "studio-integration-proposal-008";
const manifest = fs.readFileSync(path.join(root, "contracts/genlayer/fixtures/studio-assess-002.json"), "utf8");
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(key) });
const estimate = await client.estimateTransactionFeesForWrite({ address, functionName: "assess", args: [proposalId, manifest] });
const tx = process.env.STUDIO_ASSESS_TX || await client.writeContract({ address, functionName: "assess", args: [proposalId, manifest], fees: { distribution: estimate.distribution, feeValue: estimate.feeValue } });
console.log(JSON.stringify({ proposalId, tx, feeValue: estimate.feeValue.toString(), reused: Boolean(process.env.STUDIO_ASSESS_TX) }));
const final = await client.waitForFinalization({ hash: tx, interval: 5000, retries: 180, fullTransaction: true });
console.log(JSON.stringify({ statusName: final.statusName, txExecutionResultName: final.txExecutionResultName, isSuccessful: isSuccessful(final) }));
if (!isSuccessful(final)) process.exit(2);
const assessment = await client.readContract({ address, functionName: "get_assessment", args: [proposalId], transactionHashVariant: "latest-final" });
console.log(JSON.stringify({ assessment }));
