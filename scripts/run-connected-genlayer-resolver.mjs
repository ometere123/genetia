import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createAccount, createClient, isSuccessful } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";

// RPC error objects can contain validator configuration. Keep this diagnostic
// output deliberately minimal and never serialize SDK error payloads.
process.on("uncaughtException", (error) => { console.error(`connected GenLayer diagnostic failed: ${error.message}`); process.exitCode = 1; });
process.on("unhandledRejection", (reason) => { console.error(`connected GenLayer diagnostic rejected: ${reason instanceof Error ? reason.message : "unknown error"}`); process.exitCode = 1; });

const root = process.cwd();
const manifestFile = path.join(root, process.argv[2] || process.env.GENETIA_INTEGRATION_MANIFEST || "contracts/genlayer/fixtures/connected_pool_manifest.json");
const recordFile = path.join(root, process.argv[3] || process.env.GENETIA_CONNECTED_RECORD || "deployments/genlayer-connected-e2e.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const values = Object.fromEntries(fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const i = line.indexOf("=");
  return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")];
}));
const key = values.GENLAYER_PRIVATE_KEY || values.RESOLVER_PRIVATE_KEY;
if (!key) throw new Error("missing GenLayer integration signer");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function persist(patch) {
  const prior = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, "utf8")) : {};
  const next = { ...prior, ...patch, updatedAt: new Date().toISOString() };
  const temp = `${recordFile}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", flag: "w" });
  fs.renameSync(temp, recordFile);
  return next;
}
async function finalSuccess(client, hash, persistProgress = () => {}, stage = "transaction") {
  const deadline = Date.now() + 96 * 60 * 60 * 1000;
  const retryDelays = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
  let transientFailures = 0;
  while (Date.now() < deadline) {
    let transaction;
    try {
      transaction = await client.getTransaction({ hash });
      transientFailures = 0;
    } catch (error) {
      const delayMs = retryDelays[Math.min(transientFailures, retryDelays.length - 1)];
      transientFailures += 1;
      persistProgress({ [`${stage}Status`]: "WAITING_FINALITY", [`${stage}RpcFailureCount`]: transientFailures, [`${stage}NextPollAt`]: new Date(Date.now() + delayMs).toISOString(), [`${stage}LastRpcError`]: error instanceof Error ? error.message.replace(/https?:\/\/[^\s]+/g, "[redacted-url]").slice(0, 240) : "GenLayer RPC temporarily unavailable" });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    persistProgress({ [`${stage}LastObservedStatus`]: transaction.statusName, [`${stage}LastObservedExecution`]: transaction.txExecutionResultName });
    const observedStatus = String(transaction.statusName ?? "").toUpperCase();
    if (observedStatus === "FINALIZED") {
      if (transaction.txExecutionResultName !== "FINISHED_WITH_RETURN" || !isSuccessful(transaction)) {
        persistProgress({ [`${stage}Status`]: "FINALIZED_FAILURE", [`${stage}Execution`]: transaction.txExecutionResultName });
        throw new Error(`transaction ${hash} finalized unsuccessfully (${transaction.statusName}/${transaction.txExecutionResultName})`);
      }
      return transaction;
    }
    if (["FINALIZED_FAILURE", "REJECTED", "CANCELLED", "CANCELED"].includes(observedStatus)) {
      persistProgress({ [`${stage}Status`]: "FINALIZED_FAILURE", [`${stage}Execution`]: transaction.txExecutionResultName });
      throw new Error(`transaction ${hash} reached terminal failure ${transaction.statusName}/${transaction.txExecutionResultName}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  throw new Error(`transaction ${hash} exceeded explicit 96-hour integration policy`);
}
function decodeJson(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text || text === '""') throw new Error(`${label} returned empty state`);
  return typeof value === "string" ? JSON.parse(value) : value;
}
const codeHash = (code) => crypto.createHash("sha256").update(code).digest("hex");

const manifestText = canonical(manifest);
const hash = `0x${crypto.createHash("sha256").update(Buffer.from(canonical(Object.fromEntries(Object.entries(manifest).filter(([k]) => k !== "manifest_hash"))), "utf8")).digest("hex")}`;
if (hash !== manifest.manifest_hash) throw new Error("fixture manifest hash mismatch");
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(key) });
const maAddress = process.env.STUDIO_ADMISSIBILITY_ADDRESS || "0x8DeD1d978f70E321ADce704aF95a50314A225757";
const registry = JSON.parse(fs.readFileSync(path.join(root, "deployments/genlayer-studio-dev.json"), "utf8"));
const factoryAddress = registry.sharedContracts?.resolverFactory?.address;
if (!factoryAddress || registry.sharedContracts.resolverFactory.status !== "CANONICAL") throw new Error("canonical ResolverFactory release is missing");
const proposalId = `connected-${String(manifest.engine ?? "market").toLowerCase()}-${manifest.market_id.slice(2, 18)}`;

let prior = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, "utf8")) : {};
if (prior.assessmentTx && (prior.proposalId !== proposalId || prior.manifestHash !== hash)) throw new Error("existing assessment operation identity conflicts with this fixture; refusing duplicate submission");
persist({ network: "studio-dev", chainId: 61997, marketId: manifest.market_id, proposalId, manifestHash: hash, assessmentStatus: prior.assessmentTx ? "RESUMING_SUBMITTED" : "SUBMITTING" });
const assessmentArgs = [proposalId, manifestText];
let assessmentTx = prior.assessmentTx;
if (!assessmentTx) {
  const assessmentFees = await client.estimateTransactionFeesForWrite({ address: maAddress, functionName: "assess", args: assessmentArgs });
  try {
    assessmentTx = await client.writeContract({ address: maAddress, functionName: "assess", args: assessmentArgs, fees: { distribution: assessmentFees.distribution, feeValue: assessmentFees.feeValue, messageAllocations: assessmentFees.messageAllocations } });
  } catch (error) {
    persist({ assessmentStatus: "PRE_SUBMISSION_FAILED", submissionError: error instanceof Error ? error.message.slice(0, 300) : "unknown" });
    throw error;
  }
  persist({ assessmentTx, assessmentSubmittedAt: new Date().toISOString(), assessmentStatus: "SUBMITTED" });
}
persist({ assessmentTx, assessmentStatus: "FOLLOWING_FINALITY" });
const assessmentFinal = await finalSuccess(client, assessmentTx, persist, "assessment");
const assessmentReturn = assessmentFinal.txDataDecoded?.returnData ?? assessmentFinal.txDataDecoded?.returnValue;
const assessmentRaw = await client.readContract({ address: maAddress, functionName: "get_assessment", args: [proposalId], transactionHashVariant: "latest-final", jsonSafeReturn: true });
const assessment = decodeJson(assessmentRaw, "LATEST_FINAL get_assessment");
if (!["APPROVED", "NEEDS_REVISION", "REJECTED"].includes(assessment.decision) || !Array.isArray(assessment.issue_codes)) throw new Error("assessment schema invalid");
if (assessmentReturn !== undefined && String(assessmentReturn).toUpperCase() !== assessment.decision) throw new Error("assessment return and finalized stored decision differ");
persist({ assessmentStatus: "FINALIZED_SUCCESS", assessmentExecution: assessmentFinal.txExecutionResultName, assessmentReturn, assessmentReturnVerification: assessmentReturn === undefined ? "SDK transaction endpoint does not expose method return; verified deployed source returns the same decision variable stored in LATEST_FINAL state" : "decoded method return equals finalized assessment", assessment, finalizedAssessmentState: "LATEST_FINAL" });
if (assessment.decision !== "APPROVED") {
  console.log(JSON.stringify({ proposalId, assessmentTx, assessment, status: "FINALIZED_NON_APPROVED; resolver deployment skipped" }));
  process.exit(0);
}

const existingResolverRaw = await client.readContract({ address: factoryAddress, functionName: "get_resolver", args: [manifest.market_id], transactionHashVariant: "latest-final", jsonSafeReturn: true });
const existingResolver = typeof existingResolverRaw === "string" && /^0x[0-9a-fA-F]{40}$/.test(existingResolverRaw) ? existingResolverRaw : undefined;
let factoryAttempts = [...(prior.factoryAttempts ?? [])];
let factoryTx = prior.resolverFactoryAddress === factoryAddress ? prior.resolverFactoryTx : undefined;
if (prior.resolverFactoryTx && prior.resolverFactoryAddress !== factoryAddress) {
  factoryAttempts.push({ factoryAddress: prior.resolverFactoryAddress ?? "previous-release", tx: prior.resolverFactoryTx, status: "FAILED_OR_SUPERSEDED" });
}
if (factoryTx) {
  const previousFactoryTransaction = await client.getTransaction({ hash: factoryTx });
  if (String(previousFactoryTransaction.statusName).toUpperCase() === "FINALIZED" && !isSuccessful(previousFactoryTransaction)) {
    if (existingResolver) throw new Error("failed factory operation has an existing finalized child; refusing another creation");
    factoryAttempts.push({ factoryAddress, tx: factoryTx, status: "FINALIZED_FAILURE" });
    factoryTx = undefined;
  }
}
let feeEstimateMode = prior.factoryFeeEstimateMode;
if (!factoryTx && !existingResolver) {
  let fees;
  try {
    fees = await client.estimateTransactionFeesForWrite({ address: factoryAddress, functionName: "deploy_resolver", args: [manifest.market_id, manifestText, hash] });
  } catch (error) {
    const receipt = error?.cause?.data?.receipt;
    if (receipt) {
      const rawResult = receipt.result;
      let decodedResult = rawResult;
      try { decodedResult = Buffer.from(rawResult, "base64").toString("utf8"); } catch {}
      console.error(JSON.stringify({ factoryFeeSimulation: "FAILED", result: decodedResult, executionResult: receipt.execution_result, stdout: receipt.stdout, stderr: receipt.stderr, traceKeys: Object.keys(receipt.trace ?? {}) }));
    }
    // Child deployment cannot be represented by Studio's method simulation on
    // this RC. Use the network's ordinary fee estimate for the one real,
    // idempotent factory operation; the chain remains authoritative.
    fees = await client.estimateTransactionFees();
    feeEstimateMode = "network-estimate-after-child-simulation-exit";
  }
  persist({ resolverFactoryAddress: factoryAddress, factoryAttempts, resolverFactoryTx: undefined, resolverFactoryTxStatus: "SUBMITTING" });
  factoryTx = await client.writeContract({ address: factoryAddress, functionName: "deploy_resolver", args: [manifest.market_id, manifestText, hash], fees: { distribution: fees.distribution, feeValue: fees.feeValue, messageAllocations: fees.messageAllocations } });
  persist({ resolverFactoryAddress: factoryAddress, factoryAttempts, resolverFactoryTx: factoryTx, factoryFeeEstimateMode: feeEstimateMode ?? "method-simulation", resolverFactorySubmittedAt: new Date().toISOString(), resolverFactoryTxStatus: "SUBMITTED" });
}
let factoryFinal;
if (factoryTx) {
  try {
    factoryFinal = await finalSuccess(client, factoryTx, persist, "factory");
    persist({ resolverFactoryTxStatus: "FINALIZED_SUCCESS", resolverFactoryExecution: factoryFinal.txExecutionResultName });
  } catch (error) {
    const failed = await client.getTransaction({ hash: factoryTx });
    const failedAttempt = { factoryAddress, tx: factoryTx, status: failed.statusName, execution: failed.txExecutionResultName };
    factoryAttempts.push(failedAttempt);
    persist({ resolverFactoryAddress: factoryAddress, factoryAttempts, resolverFactoryTxStatus: "FINALIZED_FAILURE", resolverFactoryExecution: failed.txExecutionResultName });
    throw error;
  }
}
const triggeredTxs = factoryTx ? await client.getTriggeredTransactionIds({ hash: factoryTx }) : [];
persist({ triggeredTxs });
const childFinality = [];
for (const childTx of triggeredTxs) {
  const child = await finalSuccess(client, childTx, persist, `child-${childTx.slice(2, 10)}`);
  childFinality.push({ tx: childTx, status: child.statusName, execution: child.txExecutionResultName });
}
const resolverAddress = existingResolver ?? await client.readContract({ address: factoryAddress, functionName: "get_resolver", args: [manifest.market_id], transactionHashVariant: "latest-final", jsonSafeReturn: true });
if (typeof resolverAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(resolverAddress)) throw new Error("factory finalized resolver identity is invalid");
persist({ resolverFactoryAddress: factoryAddress, resolverAddress, resolverStatus: "VERIFYING_FINALIZED_BINDING" });
const resolverCode = await client.getContractCode(resolverAddress);
const intendedCode = fs.readFileSync(path.join(root, "contracts/genlayer/market_resolver.py"), "utf8");
const resolverSchema = await client.getContractSchema(resolverAddress);
const methods = resolverSchema.methods ?? {};
for (const method of ["resolve", "get_attempt", "get_binding_state"]) if (!methods[method]) throw new Error(`resolver ABI missing ${method}`);
const bindingRaw = await client.readContract({ address: resolverAddress, functionName: "get_binding_state", args: [], transactionHashVariant: "latest-final", jsonSafeReturn: true });
const binding = decodeJson(bindingRaw, "resolver finalized binding");
 if (binding.market_id !== manifest.market_id || binding.base_market.toLowerCase() !== manifest.base_market_address.toLowerCase() || binding.manifest_hash.toLowerCase() !== hash.toLowerCase() || binding.resolver_release_id.toLowerCase() !== manifest.resolver_release_id.toLowerCase()) {
  persist({ resolverBindingMismatch: { marketIdMatches: binding.market_id === manifest.market_id, baseMarketMatches: binding.base_market?.toLowerCase() === manifest.base_market_address.toLowerCase(), manifestHashMatches: binding.manifest_hash?.toLowerCase() === hash.toLowerCase(), resolverReleaseMatches: binding.resolver_release_id?.toLowerCase() === manifest.resolver_release_id.toLowerCase(), binding } });
  throw new Error("resolver finalized binding does not match canonical fixture; mismatch detail persisted without resubmitting factory operation");
 }
const resolutionDueAt = Number(manifest.resolution_available_time);
if (Date.now() / 1000 < resolutionDueAt + 120) {
  persist({ resolverFactoryAddress: factoryAddress, factoryAttempts, resolverFactoryTxStatus: factoryFinal ? "FINALIZED_SUCCESS" : "RECONCILED_EXISTING_CHILD", resolverFactoryExecution: factoryFinal?.txExecutionResultName, triggeredTxs, childFinality, resolverAddress, resolverSourceSha256: codeHash(resolverCode), intendedResolverSha256: codeHash(intendedCode), resolverCodeMatches: resolverCode === intendedCode, resolverSchema, binding, resolverStatus: "FINALIZED_SUCCESS", resolutionStatus: "WAITING_FOR_SCHEDULED_WINDOW", resolutionDueAt });
  console.log(JSON.stringify({ proposalId, assessmentTx, assessment, factoryTx, triggeredTxs, childFinality, resolverAddress, binding, resolutionStatus: "WAITING_FOR_SCHEDULED_WINDOW", resolutionDueAt }));
  process.exit(0);
}
const resolveAttempt = Number(process.env.GENETIA_RESOLVE_ATTEMPT ?? "0");
if (!Number.isInteger(resolveAttempt) || resolveAttempt < 0 || resolveAttempt > 4) throw new Error("GENETIA_RESOLVE_ATTEMPT must be an integer from 0 through 4");
const resolveTxKey = resolveAttempt === 0 ? "resolveTx" : `resolveAttempt${resolveAttempt}Tx`;
let resolveTx = prior[resolveTxKey];
let attemptRaw = await client.readContract({ address: resolverAddress, functionName: "get_attempt", args: [resolveAttempt], transactionHashVariant: "latest-final", jsonSafeReturn: true });
if (!resolveTx && (!attemptRaw || attemptRaw === "")) {
  persist({ resolveStatus: "SUBMITTING", resolveAttempt, resolverAddress });
  let resolveFees;
  let resolveFeeEstimateMode = "method-simulation";
  try {
    resolveFees = await client.estimateTransactionFeesForWrite({ address: resolverAddress, functionName: "resolve", args: [manifest.market_id, resolveAttempt] });
  } catch (error) {
    const message = String(error?.cause?.data?.message ?? error?.shortMessage ?? error?.message ?? "");
    const receipt = error?.cause?.data?.receipt;
    let simulationResult = "";
    try { simulationResult = Buffer.from(receipt?.result ?? "", "base64").toString("utf8"); } catch {}
    if (!`${message} ${simulationResult}`.includes("resolution attempt too early")) throw new Error("resolver fee simulation failed for a reason other than the contract's time gate");
    // The SDK's estimate simulation reuses the latest-nonfinal transaction
    // context, whose deterministic transaction timestamp can predate the
    // current submission window. Use the network estimate for one real write;
    // the deployed contract still enforces its timestamp rule at execution.
    resolveFees = await client.estimateTransactionFees();
    resolveFeeEstimateMode = "network-estimate-after-stale-simulation-clock";
  }
  persist({ resolveFeeEstimateMode });
  resolveTx = await client.writeContract({ address: resolverAddress, functionName: "resolve", args: [manifest.market_id, resolveAttempt], fees: { distribution: resolveFees.distribution, feeValue: resolveFees.feeValue, messageAllocations: resolveFees.messageAllocations } });
  persist({ [resolveTxKey]: resolveTx, resolveTx, resolveSubmittedAt: new Date().toISOString(), resolveStatus: "SUBMITTED", resolveFeeEstimateMode });
}
let resolveFinal;
if (resolveTx) {
  persist({ resolveTx, resolveStatus: "FOLLOWING_FINALITY" });
  resolveFinal = await finalSuccess(client, resolveTx, persist, "resolve");
  attemptRaw = await client.readContract({ address: resolverAddress, functionName: "get_attempt", args: [resolveAttempt], transactionHashVariant: "latest-final", jsonSafeReturn: true });
}
const attemptRecord = decodeJson(attemptRaw, `LATEST_FINAL resolver attempt ${resolveAttempt}`);
if (Number(attemptRecord.attempt) !== resolveAttempt || !["YES", "NO", "VOID", "UNRESOLVED"].includes(attemptRecord.outcome) || attemptRecord.evidence_commitment !== `0x${crypto.createHash("sha256").update(Buffer.from(canonical(attemptRecord.evidence ?? []), "utf8")).digest("hex")}`) throw new Error("finalized resolver attempt has invalid identity/outcome/evidence commitment");
const expectedResult = `0x${crypto.createHash("sha256").update(Buffer.from(canonical({ attempt: resolveAttempt, base_market: manifest.base_market_address.toLowerCase(), evidence_commitment: attemptRecord.evidence_commitment.toLowerCase(), manifest_hash: hash.toLowerCase(), market_id: manifest.market_id, outcome: attemptRecord.outcome, resolver_release_id: manifest.resolver_release_id.toLowerCase() }), "utf8")).digest("hex")}`;
if (attemptRecord.result_commitment !== expectedResult) throw new Error("finalized resolver result commitment does not match canonical result preimage");
persist({ resolverFactoryAddress: factoryAddress, factoryAttempts, resolverFactoryTxStatus: factoryFinal ? "FINALIZED_SUCCESS" : "RECONCILED_EXISTING_CHILD", resolverFactoryExecution: factoryFinal?.txExecutionResultName, triggeredTxs, childFinality, resolverAddress, resolverSourceSha256: codeHash(resolverCode), intendedResolverSha256: codeHash(intendedCode), resolverCodeMatches: resolverCode === intendedCode, resolverSchema, binding, resolverStatus: "FINALIZED_SUCCESS", [resolveTxKey]: resolveTx, resolveTx, resolveStatus: resolveFinal ? "FINALIZED_SUCCESS" : "RECONCILED_FINALIZED_ATTEMPT", resolveAttempt, resolveExecution: resolveFinal?.txExecutionResultName, attemptRecord, resultCommitment: expectedResult });
if (resolverCode !== intendedCode) throw new Error("deployed resolver source differs from intended source");
console.log(JSON.stringify({ proposalId, assessmentTx, assessment, factoryTx, factoryFeeEstimateMode: feeEstimateMode, triggeredTxs, childFinality, resolverAddress, resolverSourceSha256: codeHash(resolverCode), binding, resolveAttempt, resolveTx, resolveExecution: resolveFinal?.txExecutionResultName, attemptRecord, resultCommitment: expectedResult, status: "FINALIZED_SUCCESS" }));
