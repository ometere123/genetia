import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createAccount, createClient, isSuccessful } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";

const root = process.cwd();
const values = Object.fromEntries(fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }));
const key = values.RESOLVER_PRIVATE_KEY || values.GENLAYER_PRIVATE_KEY;
if (!key) throw new Error("missing GenLayer signer");
const code = fs.readFileSync(path.join(root, "contracts/genlayer/resolver_factory.py"), "utf8");
const resolverCode = fs.readFileSync(path.join(root, "contracts/genlayer/market_resolver.py"), "utf8");
// The child resolver's release identity is a bytes32 protocol binding used by
// Base and the watcher EIP-712 schema; it must not be the human-readable
// ResolverFactory deployment label.
const childSourceSha256 = crypto.createHash("sha256").update(resolverCode).digest("hex");
const releaseId = `0x${childSourceSha256}`;
const client = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: createAccount(key) });
const sourceSha256 = crypto.createHash("sha256").update(code).digest("hex");
const manifestPath = path.join(root, "deployments/genlayer-studio-dev.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
function persistManifest() {
  const temporary = `${manifestPath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, manifestPath);
}
let tx = manifest.sharedContracts?.pendingResolverFactory?.deploymentTx;
if (tx && (manifest.sharedContracts.pendingResolverFactory.sourceSha256 !== sourceSha256 || manifest.sharedContracts.pendingResolverFactory.childSourceSha256 !== childSourceSha256)) {
  throw new Error("a different ResolverFactory deployment is already pending; refusing to submit another");
}
if (!tx) {
  const estimate = await client.estimateTransactionFees();
  tx = await client.deployContract({ code, args: [releaseId, resolverCode], fees: { distribution: estimate.distribution, feeValue: estimate.feeValue } });
  manifest.sharedContracts ??= {};
  manifest.sharedContracts.pendingResolverFactory = { deploymentTx: tx, sourceSha256, childSourceSha256, childResolverReleaseId: releaseId, feeValue: estimate.feeValue.toString(), status: "SUBMITTED", runner: "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng", submittedAt: new Date().toISOString() };
  persistManifest();
}
console.log(JSON.stringify({ tx, sourceSha256, childSourceSha256, childResolverReleaseId: releaseId, feeValue: manifest.sharedContracts?.pendingResolverFactory?.feeValue ?? "not-recorded" }));
let final;
const deadline = Date.now() + 96 * 60 * 60 * 1000;
let waitIndex = 0;
while (Date.now() < deadline) {
  final = await client.getTransaction({ hash: tx });
  const statusName = String(final.statusName ?? "").toUpperCase();
  if (statusName === "FINALIZED") break;
  manifest.sharedContracts.pendingResolverFactory.lastObservedStatus = final.statusName ?? "UNKNOWN";
  manifest.sharedContracts.pendingResolverFactory.lastObservedAt = new Date().toISOString();
  persistManifest();
  const delay = waitIndex++ < 4 ? 30_000 : 5 * 60_000;
  await new Promise((resolve) => setTimeout(resolve, delay));
}
if (!final || String(final.statusName ?? "").toUpperCase() !== "FINALIZED") throw new Error(`ResolverFactory transaction ${tx} remains pending; its identity is preserved for later follow-up`);
const address = final.recipient;
const deployed = address ? await client.getContractCode(address) : "";
const schema = address ? await client.getContractSchema(address) : null;
console.log(JSON.stringify({ statusName: final.statusName, txExecutionResultName: final.txExecutionResultName, resultName: final.result_name, isSuccessful: isSuccessful(final), recipient: address, deployedSha256: crypto.createHash("sha256").update(deployed).digest("hex"), schema }));
if (!address || !isSuccessful(final) || final.txExecutionResultName !== "FINISHED_WITH_RETURN" || deployed !== code) process.exit(2);

const prior = manifest.sharedContracts?.resolverFactory;
const releaseIdLabel = `resolver-factory-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${sourceSha256.slice(0, 8)}-child-${childSourceSha256.slice(0, 8)}`;
manifest.sharedContracts ??= {};
manifest.sharedContracts.resolverFactoryHistory ??= [];
if (prior?.address && prior.address !== address && !manifest.sharedContracts.resolverFactoryHistory.some((release) => release.address === prior.address)) {
  manifest.sharedContracts.resolverFactoryHistory.push({ ...prior, status: "SUPERSEDED_FOR_NEW_RESOLVERS" });
}
manifest.sharedContracts.resolverFactory = {
  releaseId: releaseIdLabel,
  status: "CANONICAL",
  address,
  deploymentTx: tx,
  sourceSha256,
  childSourceSha256,
  childResolverReleaseId: releaseId,
  runner: "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng",
  execution: final.txExecutionResultName,
  statusName: final.statusName,
  resultName: final.result_name,
  methods: ["deploy_resolver", "get_resolver"],
  deployedSourceMatch: true,
  schemaVerified: Boolean(schema?.methods?.deploy_resolver && schema?.methods?.get_resolver),
  supersedes: prior?.releaseId,
};
delete manifest.sharedContracts.pendingResolverFactory;
persistManifest();
