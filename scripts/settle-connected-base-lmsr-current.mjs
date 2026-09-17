import fs from "node:fs";
import { attest } from "../workers/resolution-watcher/src/index.ts";
import { createPublicClient, createWalletClient, decodeFunctionData, http } from "../apps/api-worker/node_modules/viem/_esm/index.js";
import { privateKeyToAccount } from "../apps/api-worker/node_modules/viem/_esm/accounts/index.js";
import { baseSepolia } from "../apps/api-worker/node_modules/viem/_esm/chains/index.js";

const recordPath = "deployments/base-connected-lmsr-current.json";
const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")]; }));
if (process.env.BASE_RPC) env.BASE_RPC = process.env.BASE_RPC;
const record = read(recordPath);
const live = read("deployments/genlayer-connected-lmsr-live-current.json");
const deployment = read("deployments/base-sepolia.json");
const fixture = read("contracts/genlayer/fixtures/connected_lmsr_live_current.json");
if (live.chainId !== 61997 || live.resolveStatus !== "FINALIZED_SUCCESS" || live.resolveExecution !== "FINISHED_WITH_RETURN") throw new Error("a successful finalized LMSR Studio Dev resolution is required");
if ((record.resolverAddress && live.resolverAddress?.toLowerCase() !== record.resolverAddress.toLowerCase()) || live.marketId?.toLowerCase() !== record.marketId.toLowerCase() || live.manifestHash?.toLowerCase() !== record.manifestHash.toLowerCase() || fixture.manifest_hash.toLowerCase() !== record.manifestHash.toLowerCase()) throw new Error("finalized resolver is not bound to the LMSR market/manifest");
if (live.attemptRecord?.outcome !== "YES" || live.attemptRecord?.attempt !== 0) throw new Error("controlled LMSR settlement helper accepts only the actual finalized YES attempt 0 fixture");
const outcome = { YES: 0, NO: 1, VOID: 2 }[live.attemptRecord.outcome];
const gatewayAddress = deployment.contracts.ResolutionGateway.address;
const gatewayAbi = read("contracts/base/out/ResolutionGateway.sol/ResolutionGateway.json").abi;
const marketAbi = read("contracts/base/out/LMSRMarket.sol/LMSRMarket.json").abi;
const vaultAbi = read("contracts/base/out/LMSRLiquidityVault.sol/LMSRLiquidityVault.json").abi;
const tokenAddress = deployment.contracts.OutcomeTokens.address.toLowerCase();
const tokenAbi = read("contracts/base/out/OutcomeTokens.sol/OutcomeTokens.json").abi;
const erc20Abi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }];
async function submittedArgs(hash, abi, expectedFunction) {
  const tx = await publicClient.getTransaction({ hash });
  const decoded = decodeFunctionData({ abi, data: tx.input });
  if (decoded.functionName !== expectedFunction) throw new Error(`persisted ${expectedFunction} transaction hash has different calldata`);
  return decoded.args;
}
const key = env.DEPLOYER_PRIVATE_KEY || env.PRIVATE_KEY;
if (!key) throw new Error("Base Sepolia settlement signer is not configured");
const account = privateKeyToAccount(key);
if (account.address.toLowerCase() !== deployment.safeAddress.toLowerCase() || account.address.toLowerCase() !== record.creator.toLowerCase()) throw new Error("configured signer must be the deployed Base operator and fixture creator");
const rpc = env.BASE_RPC || "https://sepolia-preconf.base.org";
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
if (await publicClient.getChainId() !== 84532) throw new Error("wrong Base Sepolia chain");
let current = record;
function save(patch) { current = { ...current, ...patch, updatedAt: new Date().toISOString() }; const temp = `${recordPath}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(current, null, 2)}\n`, "utf8"); fs.renameSync(temp, recordPath); }
async function submitOnce(hashKey, send) {
  if (current[hashKey]) { const receipt = await publicClient.getTransactionReceipt({ hash: current[hashKey] }); if (receipt.status !== "success") throw new Error(`${hashKey} is not a successful transaction`); return current[hashKey]; }
  const hash = await send(); save({ [hashKey]: hash, [`${hashKey}Status`]: "SUBMITTED" });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") { save({ [`${hashKey}Status`]: "FAILED" }); throw new Error(`${hashKey} reverted`); }
  save({ [`${hashKey}Status`]: "CONFIRMED" }); return hash;
}
const bindingRaw = await publicClient.readContract({ address: gatewayAddress, abi: gatewayAbi, functionName: "bindings", args: [record.market] });
const binding = Array.isArray(bindingRaw) ? { marketId: bindingRaw[0], resolver: bindingRaw[1], manifestHash: bindingRaw[2], resolverReleaseId: bindingRaw[3], terminalDeadline: bindingRaw[4] } : bindingRaw;
if (binding.marketId.toLowerCase() !== record.marketId.toLowerCase() || binding.resolver.toLowerCase() !== live.resolverAddress.toLowerCase() || binding.manifestHash.toLowerCase() !== record.manifestHash.toLowerCase() || binding.resolverReleaseId.toLowerCase() !== record.resolverReleaseId.toLowerCase() || BigInt(binding.terminalDeadline) !== BigInt(record.terminalDeadline)) throw new Error("ResolutionGateway's immutable LMSR binding differs from the finalized resolver/manifest");

const envelope = { marketId: live.marketId, baseMarket: record.market, baseChainId: 84532, resolver: live.resolverAddress, genlayerChainId: 61997, genlayerTxId: live.resolveTx, manifestHash: live.manifestHash, resolverReleaseId: live.binding.resolver_release_id, attempt: live.resolveAttempt, outcome, evidenceCommitment: live.attemptRecord.evidence_commitment, resultCommitment: live.attemptRecord.result_commitment, gateway: gatewayAddress };
const signatures = [];
const verifiedWatchers = [];
for (let i = 1; i <= 3; i += 1) {
  const watcherKey = env[`TEST_WATCHER_${i}_PRIVATE_KEY`];
  if (!watcherKey) throw new Error(`watcher ${i} signing key is not configured`);
  const result = await attest(envelope, { WATCHER_ID: `watcher-${i}`, WATCHER_PRIVATE_KEY: watcherKey, GENLAYER_RPC: "https://studio-dev.genlayer.com/api" });
  const expected = deployment.watcherAddresses[i - 1];
  if (result.watcherAddress.toLowerCase() !== expected.toLowerCase()) throw new Error(`watcher ${i} is not a member of the immutable Base watcher set`);
  signatures.push(result.signature); verifiedWatchers.push(result.watcherAddress);
}
const [statusBefore, outcomeBefore, consumedBefore] = await Promise.all([
  publicClient.readContract({ address: record.market, abi: marketAbi, functionName: "status" }),
  publicClient.readContract({ address: record.market, abi: marketAbi, functionName: "outcome" }),
  publicClient.readContract({ address: gatewayAddress, abi: gatewayAbi, functionName: "consumedTransactions", args: [live.resolveTx] }),
]);
let settlementTx = current.settlementTx;
if (Number(statusBefore) === 2) {
  if (Number(outcomeBefore) !== outcome || !consumedBefore) throw new Error("LMSR is terminal for a different/unconsumed resolver result");
} else {
  if (consumedBefore) throw new Error("Gateway consumed this GenLayer transaction but LMSR is nonterminal; refusing resubmission");
  settlementTx = await submitOnce("settlementTx", () => wallet.writeContract({ address: gatewayAddress, abi: gatewayAbi, functionName: "submitResolution", args: [
    { marketId: envelope.marketId, baseMarket: envelope.baseMarket, baseChainId: BigInt(envelope.baseChainId), resolver: envelope.resolver, genlayerChainId: BigInt(envelope.genlayerChainId), genlayerTxId: envelope.genlayerTxId, manifestHash: envelope.manifestHash, resolverReleaseId: envelope.resolverReleaseId, attempt: envelope.attempt, outcome: envelope.outcome, evidenceCommitment: envelope.evidenceCommitment, resultCommitment: envelope.resultCommitment }, signatures,
  ] }));
}
const statusAfterSettlement = await publicClient.readContract({ address: record.market, abi: marketAbi, functionName: "status" });
const outcomeAfterSettlement = await publicClient.readContract({ address: record.market, abi: marketAbi, functionName: "outcome" });
const consumedAfterSettlement = await publicClient.readContract({ address: gatewayAddress, abi: gatewayAbi, functionName: "consumedTransactions", args: [live.resolveTx] });
if (Number(statusAfterSettlement) !== 2 || Number(outcomeAfterSettlement) !== outcome || !consumedAfterSettlement) throw new Error("confirmed Gateway transaction has not yet propagated to the LMSR terminal view; rerun to reconcile without sending another settlement");
const yesId = await publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "tokenIdFor", args: [record.marketId, 1] });
const noId = await publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "tokenIdFor", args: [record.marketId, 0] });
const [yesShares, noShares] = await Promise.all([yesId, noId].map((id) => publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "balanceOf", args: [account.address, id] })));
let redemptionTx = current.redemptionTx;
if (yesShares > 0n || noShares > 0n) redemptionTx = await submitOnce("redemptionTx", () => wallet.writeContract({ address: record.market, abi: marketAbi, functionName: "redeem", args: [yesShares, noShares] }));
const redeemedArgs = redemptionTx ? await submittedArgs(redemptionTx, marketAbi, "redeem") : [0n, 0n];
const balances = await publicClient.readContract({ address: record.vault, abi: vaultAbi, functionName: "shares", args: [account.address] });
if (balances === 0n && !current.lpWithdrawTx) throw new Error("configured LP has no vault shares to withdraw");
let lpWithdrawTx = current.lpWithdrawTx;
const vaultTerminal = await publicClient.readContract({ address: record.vault, abi: vaultAbi, functionName: "terminal" });
if (!vaultTerminal) throw new Error("LMSR vault is not terminal after market settlement");
if (!lpWithdrawTx && balances > 0n) lpWithdrawTx = await submitOnce("lpWithdrawTx", () => wallet.writeContract({ address: record.vault, abi: vaultAbi, functionName: "withdrawTerminal", args: [balances] }));
const lpWithdrawArgs = lpWithdrawTx ? await submittedArgs(lpWithdrawTx, vaultAbi, "withdrawTerminal") : [0n];
const [usdcAfter, remainingShares, remainingYes, remainingNo] = await Promise.all([
  publicClient.readContract({ address: deployment.usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  publicClient.readContract({ address: record.vault, abi: vaultAbi, functionName: "shares", args: [account.address] }),
  publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "balanceOf", args: [account.address, yesId] }),
  publicClient.readContract({ address: tokenAddress, abi: tokenAbi, functionName: "balanceOf", args: [account.address, noId] }),
]);
if (remainingShares !== 0n || remainingYes !== 0n || remainingNo !== 0n) throw new Error("LMSR redemption/LP withdrawal did not clear all configured-user positions");
save({ watcherQuorum: verifiedWatchers, resolutionTx: live.resolveTx, settlementTx, settlementStatus: "CONFIRMED", settledOutcome: live.attemptRecord.outcome, redemptionTx, redemptionStatus: "CONFIRMED", redeemedYesShares: String(redeemedArgs[0]), redeemedNoShares: String(redeemedArgs[1]), lpWithdrawTx, lpWithdrawStatus: "CONFIRMED", lpSharesWithdrawn: String(lpWithdrawArgs[0]), usdcAfterTerminalExits: usdcAfter.toString(), terminalStatus: Number(statusAfterSettlement), terminalOutcome: Number(outcomeAfterSettlement), status: "TERMINAL_EXITS_CONFIRMED" });
console.log(JSON.stringify({ chainId: 84532, market: record.market, vault: record.vault, marketId: record.marketId, genlayerResolver: live.resolverAddress, genlayerResolutionTx: live.resolveTx, outcome: live.attemptRecord.outcome, evidenceCommitment: live.attemptRecord.evidence_commitment, resolverResultCommitment: live.attemptRecord.result_commitment, watcherQuorum: verifiedWatchers, settlementTx, redemptionTx, redeemedYesShares: String(redeemedArgs[0]), redeemedNoShares: String(redeemedArgs[1]), lpWithdrawTx, lpSharesWithdrawn: String(lpWithdrawArgs[0]), usdcAfterTerminalExits: usdcAfter.toString(), status: "LMSR_SETTLED_REDEEMED_AND_LP_WITHDRAWN" }));
