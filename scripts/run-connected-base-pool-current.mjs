import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, decodeEventLog, formatUnits, http, parseUnits, zeroAddress } from "../apps/api-worker/node_modules/viem/_esm/index.js";
import { privateKeyToAccount } from "../apps/api-worker/node_modules/viem/_esm/accounts/index.js";
import { baseSepolia } from "../apps/api-worker/node_modules/viem/_esm/chains/index.js";

const root = process.cwd();
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => {
  const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
}));
const fixture = readJson("contracts/genlayer/fixtures/connected_pool_live_current.json");
const base = readJson("deployments/base-sepolia.json");
const genlayer = readJson("deployments/genlayer-connected-pool-live-current.json");
const outPath = path.join(root, "deployments/base-connected-pool-current.json");
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY || env.PRIVATE_KEY);
const rpc = env.BASE_RPC || base.rpc;
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
const factoryArtifact = readJson("contracts/base/out/MarketFactory.sol/MarketFactory.json");
const poolArtifact = readJson("contracts/base/out/PoolMarket.sol/PoolMarket.json");
const erc20Abi = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }, { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] }];
const chainId = await publicClient.getChainId();
if (chainId !== 84532) throw new Error(`wrong Base chain ${chainId}`);
if (genlayer.marketId !== fixture.market_id || genlayer.manifestHash?.toLowerCase() !== fixture.manifest_hash.toLowerCase() || genlayer.resolverAddress === undefined) throw new Error("finalized GenLayer record does not match the Pool fixture");
if (genlayer.resolverStatus !== "FINALIZED_SUCCESS" || genlayer.resolutionStatus !== "WAITING_FOR_SCHEDULED_WINDOW") throw new Error("GenLayer resolver is not finalized and bound to this fixture");
const manifestRegistry = readJson("deployments/genlayer-studio-dev.json");
const resolverRelease = manifestRegistry.sharedContracts.resolverFactory.childResolverReleaseId;
if (fixture.resolver_release_id.toLowerCase() !== resolverRelease.toLowerCase() || genlayer.binding.resolver_release_id.toLowerCase() !== resolverRelease.toLowerCase()) throw new Error("resolver release binding is not the canonical release");
const terms = {
  marketId: fixture.market_id,
  financialReleaseId: fixture.financial_release_id,
  resolverReleaseId: fixture.resolver_release_id,
  manifestHash: fixture.manifest_hash,
  resolver: genlayer.resolverAddress,
  creator: account.address,
  closeTime: BigInt(fixture.close_time),
  resolutionAvailableTime: BigInt(fixture.resolution_available_time),
  terminalDeadline: BigInt(fixture.absolute_terminal_deadline),
};
const factory = base.contracts.MarketFactory.address;
const usdc = base.usdcAddress;
const marketAbi = factoryArtifact.abi;
const usdcAddress = usdc;
const stakeEach = parseUnits("4", 6);

function save(patch) {
  const prior = fs.existsSync(outPath) ? readJson("deployments/base-connected-pool-current.json") : {};
  const next = { ...prior, ...patch, updatedAt: new Date().toISOString() };
  const temp = `${outPath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(temp, outPath);
  return next;
}
async function submitAndConfirm(key, operation) {
  const prior = fs.existsSync(outPath) ? readJson("deployments/base-connected-pool-current.json") : {};
  if (prior[key]) {
    const receipt = await publicClient.getTransactionReceipt({ hash: prior[key] });
    if (receipt.status !== "success") throw new Error(`${key} transaction is not successful`);
    return { hash: prior[key], receipt };
  }
  const hash = await operation();
  save({ [key]: hash });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`${key} transaction failed`);
  return { hash, receipt };
}

const predicted = await publicClient.readContract({ address: factory, abi: marketAbi, functionName: "predictPoolAddress", args: [terms] });
if (predicted.toLowerCase() !== fixture.base_market_address.toLowerCase()) throw new Error("Base CREATE2 prediction differs from finalized GenLayer manifest");
const boundExisting = await publicClient.readContract({ address: factory, abi: marketAbi, functionName: "markets", args: [fixture.market_id] });
let market = boundExisting;
if (market === zeroAddress) {
  const { hash, receipt } = await submitAndConfirm("createTx", () => walletClient.writeContract({ address: factory, abi: marketAbi, functionName: "createPool", args: [terms] }));
  const event = parseEvent(receipt.logs, factoryArtifact.abi, "PoolCreated");
  if (!event || event.args.market.toLowerCase() !== predicted.toLowerCase() || event.args.marketId.toLowerCase() !== fixture.market_id.toLowerCase()) throw new Error("PoolCreated event does not match predicted immutable binding");
  market = event.args.market;
  save({ createTx: hash, market, marketId: fixture.market_id, predictedMarket: predicted, manifestHash: fixture.manifest_hash, resolver: genlayer.resolverAddress, resolverReleaseId: resolverRelease, chainId, status: "CREATED" });
} else {
  if (market.toLowerCase() !== predicted.toLowerCase()) throw new Error("existing market ID resolves to a different address");
  save({ market, marketId: fixture.market_id, predictedMarket: predicted, manifestHash: fixture.manifest_hash, resolver: genlayer.resolverAddress, resolverReleaseId: resolverRelease, chainId });
}
function parseEvent(logs, abi, eventName) {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (decoded.eventName === eventName) return decoded;
    } catch {}
  }
  return undefined;
}

const poolAbi = poolArtifact.abi;
const [marketIdRead, resolverRead, manifestRead, closeTimeRead] = await Promise.all([
  publicClient.readContract({ address: market, abi: poolAbi, functionName: "marketId" }),
  publicClient.readContract({ address: market, abi: poolAbi, functionName: "resolver" }),
  publicClient.readContract({ address: market, abi: poolAbi, functionName: "manifestHash" }),
  publicClient.readContract({ address: market, abi: poolAbi, functionName: "closeTime" }),
]);
if (marketIdRead.toLowerCase() !== fixture.market_id.toLowerCase() || resolverRead.toLowerCase() !== genlayer.resolverAddress.toLowerCase() || manifestRead.toLowerCase() !== fixture.manifest_hash.toLowerCase() || Number(closeTimeRead) !== fixture.close_time) throw new Error("deployed Pool binding readback mismatch");

const yesAlready = await publicClient.readContract({ address: market, abi: poolAbi, functionName: "yesReceipts", args: [account.address] });
const noAlready = await publicClient.readContract({ address: market, abi: poolAbi, functionName: "noReceipts", args: [account.address] });
const yesRemaining = yesAlready < stakeEach ? stakeEach - yesAlready : 0n;
const noRemaining = noAlready < stakeEach ? stakeEach - noAlready : 0n;
const neededFunds = yesRemaining + noRemaining;
const currentUsdc = await publicClient.readContract({ address: usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
if (currentUsdc < neededFunds) throw new Error(`insufficient integration USDC for remaining stakes: need ${formatUnits(neededFunds, 6)}, have ${formatUnits(currentUsdc, 6)}`);
const approvalNeeded = neededFunds > 0n;
let approvalTx;
if (approvalNeeded) {
  const currentAllowance = await publicClient.readContract({ address: usdcAddress, abi: [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] }], functionName: "allowance", args: [account.address, market] });
  if (currentAllowance < neededFunds) ({ hash: approvalTx } = await submitAndConfirm("approvalTx", () => walletClient.writeContract({ address: usdcAddress, abi: erc20Abi, functionName: "approve", args: [market, neededFunds] })));
}
let yesTx;
if (yesRemaining > 0n) ({ hash: yesTx } = await submitAndConfirm("yesStakeTx", () => walletClient.writeContract({ address: market, abi: poolAbi, functionName: "stake", args: [true, yesRemaining] })));
let noTx;
if (noRemaining > 0n) ({ hash: noTx } = await submitAndConfirm("noStakeTx", () => walletClient.writeContract({ address: market, abi: poolAbi, functionName: "stake", args: [false, noRemaining] })));
const [yesTotal, noTotal, balanceAfter, block] = await Promise.all([
  publicClient.readContract({ address: market, abi: poolAbi, functionName: "yesTotal" }),
  publicClient.readContract({ address: market, abi: poolAbi, functionName: "noTotal" }),
  publicClient.readContract({ address: usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  publicClient.getBlock(),
]);
save({ status: "FUNDED_BOTH_SIDES", market, createTx: (fs.existsSync(outPath) ? readJson("deployments/base-connected-pool-current.json").createTx : undefined), approvalTx: approvalTx ?? readJson("deployments/base-connected-pool-current.json").approvalTx, yesStakeTx: yesTx ?? readJson("deployments/base-connected-pool-current.json").yesStakeTx, noStakeTx: noTx ?? readJson("deployments/base-connected-pool-current.json").noStakeTx, yesTotal: yesTotal.toString(), noTotal: noTotal.toString(), usdcAfter: formatUnits(balanceAfter, 6), closeTime: fixture.close_time, resolutionAvailableTime: fixture.resolution_available_time, terminalDeadline: fixture.absolute_terminal_deadline, lastBaseBlock: block.number.toString() });
console.log(JSON.stringify({ chainId, market, marketId: fixture.market_id, resolver: genlayer.resolverAddress, manifestHash: fixture.manifest_hash, createTx: readJson("deployments/base-connected-pool-current.json").createTx, approvalTx: readJson("deployments/base-connected-pool-current.json").approvalTx, yesStakeTx: readJson("deployments/base-connected-pool-current.json").yesStakeTx, noStakeTx: readJson("deployments/base-connected-pool-current.json").noStakeTx, yesTotal: yesTotal.toString(), noTotal: noTotal.toString(), closeTime: fixture.close_time, resolutionAvailableTime: fixture.resolution_available_time, terminalDeadline: fixture.absolute_terminal_deadline, usdcAfter: formatUnits(balanceAfter, 6), status: "FUNDED_BOTH_SIDES" }));
