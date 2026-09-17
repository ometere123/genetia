import fs from "node:fs";
import { attest } from "../workers/resolution-watcher/src/index.ts";
import { createPublicClient, createWalletClient, http } from "../apps/api-worker/node_modules/viem/_esm/index.js";
import { privateKeyToAccount } from "../apps/api-worker/node_modules/viem/_esm/accounts/index.js";
import { baseSepolia } from "../apps/api-worker/node_modules/viem/_esm/chains/index.js";

const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => {
  const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")];
}));
if (process.env.BASE_RPC) env.BASE_RPC = process.env.BASE_RPC;
const recordPath = "deployments/base-connected-pool-current.json";
const pool = readJson(recordPath);
const live = readJson("deployments/genlayer-connected-pool-live-current.json");
const deployment = readJson("deployments/base-sepolia.json");
if (live.chainId !== 61997 || live.resolveStatus !== "FINALIZED_SUCCESS" || live.resolveExecution !== "FINISHED_WITH_RETURN") throw new Error("a successful finalized Studio Dev resolution is required");
if (live.resolverAddress?.toLowerCase() !== pool.resolver?.toLowerCase() || live.marketId?.toLowerCase() !== pool.marketId.toLowerCase() || live.manifestHash?.toLowerCase() !== pool.manifestHash.toLowerCase()) throw new Error("resolver result is not bound to this Base Pool");
if (live.attemptRecord?.outcome !== "YES" || live.attemptRecord?.attempt !== 0) throw new Error("this settlement helper is restricted to the verified YES attempt 0 result");
const outcomeCode = { YES: 0, NO: 1, VOID: 2 }[live.attemptRecord.outcome];
const gatewayAddress = deployment.contracts.ResolutionGateway.address;
const gatewayAbi = readJson("contracts/base/out/ResolutionGateway.sol/ResolutionGateway.json").abi;
const poolAbi = readJson("contracts/base/out/PoolMarket.sol/PoolMarket.json").abi;
const key = env.DEPLOYER_PRIVATE_KEY || env.PRIVATE_KEY;
if (!key) throw new Error("Base Sepolia settlement signer is not configured");
const account = privateKeyToAccount(key);
if (account.address.toLowerCase() !== deployment.safeAddress.toLowerCase()) throw new Error("configured settlement signer does not match the deployed Base operator address");
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(env.BASE_RPC || deployment.rpc) });
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(env.BASE_RPC || deployment.rpc) });
if (await publicClient.getChainId() !== 84532) throw new Error("wrong Base chain");

const binding = await publicClient.readContract({ address: gatewayAddress, abi: gatewayAbi, functionName: "bindings", args: [pool.market] });
const bindingFields = Array.isArray(binding)
  ? { marketId: binding[0], resolver: binding[1], manifestHash: binding[2], resolverReleaseId: binding[3], terminalDeadline: binding[4] }
  : binding;
if (bindingFields.marketId.toLowerCase() !== pool.marketId.toLowerCase() || bindingFields.resolver.toLowerCase() !== live.resolverAddress.toLowerCase() || bindingFields.manifestHash.toLowerCase() !== pool.manifestHash.toLowerCase() || bindingFields.resolverReleaseId.toLowerCase() !== pool.resolverReleaseId.toLowerCase() || BigInt(bindingFields.terminalDeadline) !== BigInt(pool.terminalDeadline)) throw new Error("Base ResolutionGateway binding does not match the finalized manifest/resolver");

const envelope = {
  marketId: live.marketId,
  baseMarket: pool.market,
  baseChainId: 84532,
  resolver: live.resolverAddress,
  genlayerChainId: 61997,
  genlayerTxId: live.resolveTx,
  manifestHash: live.manifestHash,
  resolverReleaseId: live.binding.resolver_release_id,
  attempt: live.resolveAttempt,
  outcome: outcomeCode,
  evidenceCommitment: live.attemptRecord.evidence_commitment,
  resultCommitment: live.attemptRecord.result_commitment,
  gateway: gatewayAddress,
};

const signatures = [];
const verifiedWatchers = [];
for (let i = 1; i <= 3; i += 1) {
  const watcherKey = env[`TEST_WATCHER_${i}_PRIVATE_KEY`];
  if (!watcherKey) throw new Error(`watcher ${i} signing key is not configured`);
  const attestation = await attest(envelope, { WATCHER_ID: `watcher-${i}`, WATCHER_PRIVATE_KEY: watcherKey, GENLAYER_RPC: "https://studio-dev.genlayer.com/api" });
  const expectedAddress = deployment.watcherAddresses[i - 1];
  if (attestation.watcherAddress.toLowerCase() !== expectedAddress.toLowerCase()) throw new Error(`watcher ${i} signer does not match the immutable Base watcher set`);
  signatures.push(attestation.signature);
  verifiedWatchers.push(attestation.watcherAddress);
}

const [terminalBefore, currentOutcome, consumedBefore] = await Promise.all([
  publicClient.readContract({ address: pool.market, abi: poolAbi, functionName: "terminal" }),
  publicClient.readContract({ address: pool.market, abi: poolAbi, functionName: "outcome" }),
  publicClient.readContract({ address: gatewayAddress, abi: gatewayAbi, functionName: "consumedTransactions", args: [live.resolveTx] }),
]);
let settlementTx = pool.settlementTx;
if (terminalBefore) {
  if (Number(currentOutcome) !== outcomeCode || !consumedBefore) throw new Error("Pool is terminal but not for this consumed finalized result");
} else {
  if (consumedBefore) throw new Error("gateway consumed this resolver transaction but Pool is not terminal; refusing replay");
  settlementTx = await wallet.writeContract({ address: gatewayAddress, abi: gatewayAbi, functionName: "submitResolution", args: [
    { marketId: envelope.marketId, baseMarket: envelope.baseMarket, baseChainId: BigInt(envelope.baseChainId), resolver: envelope.resolver, genlayerChainId: BigInt(envelope.genlayerChainId), genlayerTxId: envelope.genlayerTxId, manifestHash: envelope.manifestHash, resolverReleaseId: envelope.resolverReleaseId, attempt: envelope.attempt, outcome: envelope.outcome, evidenceCommitment: envelope.evidenceCommitment, resultCommitment: envelope.resultCommitment },
    signatures,
  ] });
  fs.writeFileSync(recordPath, `${JSON.stringify({ ...pool, watcherQuorum: verifiedWatchers, resolutionTx: live.resolveTx, settlementTx, settlementStatus: "SUBMITTED", updatedAt: new Date().toISOString() }, null, 2)}\n`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: settlementTx });
  if (receipt.status !== "success") throw new Error("Base ResolutionGateway settlement transaction reverted");
  const terminalAfter = await publicClient.readContract({ address: pool.market, abi: poolAbi, functionName: "terminal" });
  const outcomeAfter = await publicClient.readContract({ address: pool.market, abi: poolAbi, functionName: "outcome" });
  const consumedAfter = await publicClient.readContract({ address: gatewayAddress, abi: gatewayAbi, functionName: "consumedTransactions", args: [live.resolveTx] });
  if (!terminalAfter || Number(outcomeAfter) !== outcomeCode || !consumedAfter) throw new Error("Base settlement receipt did not produce the expected terminal state");
}

const claimable = await publicClient.readContract({ address: pool.market, abi: poolAbi, functionName: "claimable", args: [account.address] });
let claimTx = pool.claimTx;
if (claimable > 0n) {
  claimTx = await wallet.writeContract({ address: pool.market, abi: poolAbi, functionName: "claim" });
  fs.writeFileSync(recordPath, `${JSON.stringify({ ...pool, watcherQuorum: verifiedWatchers, resolutionTx: live.resolveTx, settlementTx, settlementStatus: "CONFIRMED", claimTx, claimStatus: "SUBMITTED", updatedAt: new Date().toISOString() }, null, 2)}\n`);
  const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimTx });
  if (claimReceipt.status !== "success") throw new Error("Pool claim transaction reverted");
}
const finalClaimable = await publicClient.readContract({ address: pool.market, abi: poolAbi, functionName: "claimable", args: [account.address] });
if (finalClaimable !== 0n) throw new Error("claimable Pool value remains after the claim path");
fs.writeFileSync(recordPath, `${JSON.stringify({ ...pool, watcherQuorum: verifiedWatchers, resolutionTx: live.resolveTx, settlementTx, settlementStatus: "CONFIRMED", settledOutcome: live.attemptRecord.outcome, claimTx, claimStatus: claimTx ? "CONFIRMED" : "NO_CLAIMABLE_BALANCE", claimableAfter: finalClaimable.toString(), updatedAt: new Date().toISOString() }, null, 2)}\n`);
console.log(JSON.stringify({ chainId: 84532, market: pool.market, marketId: pool.marketId, resolver: live.resolverAddress, genlayerResolutionTx: live.resolveTx, outcome: live.attemptRecord.outcome, evidenceCommitment: live.attemptRecord.evidence_commitment, resultCommitment: live.attemptRecord.result_commitment, watcherQuorum: verifiedWatchers, settlementTx, claimTx, claimableAfter: finalClaimable.toString(), status: "POOL_SETTLED_AND_CLAIMED" }));
