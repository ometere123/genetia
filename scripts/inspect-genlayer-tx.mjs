import fs from "node:fs";
import crypto from "node:crypto";
import { createAccount, createClient } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";

const txHash = process.argv[2];
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
}));
const privateKey = env.GENLAYER_PRIVATE_KEY || env.RESOLVER_PRIVATE_KEY;
if (!privateKey) throw new Error("missing configured GenLayer signer");
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(privateKey) });
if (process.argv[2] === "factory-sim" && process.argv[3]) {
  const address = process.argv[3];
  const manifest = JSON.parse(fs.readFileSync("contracts/genlayer/fixtures/connected_pool_manifest.json", "utf8"));
  const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
  const manifestText = canonical(manifest);
  const fees = await client.estimateTransactionFees();
  const result = await client.simulateWriteContract({ address, functionName: "deploy_resolver", args: [manifest.market_id, manifestText, manifest.manifest_hash], fees: { distribution: fees.distribution, feeValue: fees.feeValue }, includeReceipt: true });
  const receipt = result.receipt ?? {};
  console.log(JSON.stringify({ result: result.result, feeReport: result.feeReport, receipt: { status: receipt.status, result: receipt.result, stdout: receipt.stdout, stderr: receipt.stderr, logs: receipt.logs, messages: receipt.messages, result_code: receipt.result_code, contract_state: receipt.contract_state } }));
  process.exit(0);
}
if (process.argv[2] === "schema" && process.argv[3]) {
  const code = fs.readFileSync(process.argv[3], "utf8");
  const schema = await client.getContractSchemaForCode(code);
  console.log(JSON.stringify(schema));
  process.exit(0);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "")) throw new Error("provide one transaction hash");
if (process.argv[3] === "contract") {
  const address = process.argv[4];
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) throw new Error("contract mode requires an address");
  const code = await client.getContractCode(address);
  const schema = await client.getContractSchema(address);
  const intended = fs.readFileSync("contracts/genlayer/market_admissibility.py", "utf8");
  console.log(JSON.stringify({ address, deployedSourceSha256: crypto.createHash("sha256").update(code).digest("hex"), localSourceSha256: crypto.createHash("sha256").update(intended).digest("hex"), exactSourceMatch: code === intended, schema }));
  process.exit(code === intended ? 0 : 2);
}
if (process.argv[3] === "assessment") {
  const address = process.argv[4];
  const proposalId = process.argv[5];
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "") || !proposalId) throw new Error("assessment mode requires contract address and proposal ID");
  const tx = await client.waitForFinalization({ hash: txHash, fullTransaction: true });
  const stored = await client.readContract({ address, functionName: "get_assessment", args: [proposalId], transactionHashVariant: "latest-final", jsonSafeReturn: true });
  console.log(JSON.stringify({ hash: txHash, statusName: tx.statusName, txExecutionResultName: tx.txExecutionResultName, txDataDecoded: tx.txDataDecoded, lifecycle: tx.lifecycle, storedAssessment: stored, readVariant: "latest-final" }, (_, value) => typeof value === "bigint" ? value.toString() : value));
  process.exit(0);
}
if (process.argv[3] === "trace") {
  const trace = await client.debugTraceTransaction({ hash: txHash, round: 0 });
  const compact = Object.fromEntries(Object.entries(trace ?? {}).map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 5000) : value]));
  console.log(JSON.stringify({ keys: Object.keys(trace ?? {}), trace: compact }, (_, value) => typeof value === "bigint" ? value.toString() : value));
  process.exit(0);
}
if (process.argv[3] === "children") {
  const children = await client.getTriggeredTransactionIds({ hash: txHash });
  console.log(JSON.stringify({ hash: txHash, triggeredTransactionIds: children }));
  process.exit(0);
}
const tx = await client.getTransaction({ hash: txHash, fullTransaction: true });
if (process.argv[3] === "inspect-call") {
  const decoded = tx?.txDataDecoded;
  const callData = decoded?.callData;
  const rawData = tx?.data && typeof tx.data === "object" ? tx.data : undefined;
  const rawCalldata = rawData?.calldata && typeof rawData.calldata === "object" ? rawData.calldata : undefined;
  console.log(JSON.stringify({ hash: tx?.hash ?? txHash, statusName: tx?.statusName, recipient: tx?.recipient, sender: tx?.from_address ?? tx?.sender, decodedType: decoded?.type, callKeys: callData && typeof callData === "object" ? Object.keys(callData).sort() : [], method: callData?.method ?? callData?.functionName ?? callData?.name, argsCount: Array.isArray(callData?.args) ? callData.args.length : undefined, firstArg: Array.isArray(callData?.args) ? callData.args[0] : undefined, rawDataKeys: rawData ? Object.keys(rawData).sort() : [], calldataKeys: rawCalldata ? Object.keys(rawCalldata).sort() : [] }));
  process.exit(0);
}
const safe = {
  keys: Object.keys(tx ?? {}),
  hash: tx?.hash ?? txHash,
  statusName: tx?.statusName,
  txExecutionResultName: tx?.txExecutionResultName,
  recipient: tx?.recipient,
  result: tx?.result,
  tx_data: tx?.tx_data,
  data: tx?.data,
  txDataDecoded: tx?.txDataDecoded,
  lifecycle: tx?.lifecycle,
};
console.log(JSON.stringify(safe, (_, value) => typeof value === "bigint" ? value.toString() : value));
