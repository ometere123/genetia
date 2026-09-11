import fs from "node:fs";
import crypto from "node:crypto";
import { createAccount, createClient } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";
const env = Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }));
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(env.RESOLVER_PRIVATE_KEY || env.GENLAYER_PRIVATE_KEY) });
for (const address of ["0xb08f7Cbba3Fd55BFe86dd3A1c090f38f76435b33", "0xf1935C55735b665B10C37613914B2EBE55Ac27CA"]) {
  const code = await client.getContractCode(address);
  const schema = await client.getContractSchema(address);
  console.log(JSON.stringify({ address, sourceSha256: crypto.createHash("sha256").update(code).digest("hex"), codeLength: code.length, hasAssessmentsAssignment: code.includes("self.assessments[proposal_id]"), hasDefaultRunner: code.includes("run_nondet_default"), schemaKeys: Object.keys(schema ?? {}), schema: schema }));
}
