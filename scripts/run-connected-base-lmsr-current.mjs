import fs from "node:fs";
import crypto from "node:crypto";
import { createPublicClient, createWalletClient, decodeEventLog, formatUnits, http, parseUnits } from "../apps/api-worker/node_modules/viem/_esm/index.js";
import { privateKeyToAccount } from "../apps/api-worker/node_modules/viem/_esm/accounts/index.js";
import { baseSepolia } from "../apps/api-worker/node_modules/viem/_esm/chains/index.js";

const root = process.cwd();
const read = (file) => JSON.parse(fs.readFileSync(`${root}/${file}`, "utf8"));
const fileEnv = Object.fromEntries(fs.readFileSync(`${root}/.env`, "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")]; }));
const env = { ...fileEnv, ...process.env };
const recordPath = `${root}/deployments/base-connected-lmsr-current.json`;
const record = read("deployments/base-connected-lmsr-current.json");
const fixture = read("contracts/genlayer/fixtures/connected_lmsr_live_current.json");
const genlayer = read("deployments/genlayer-connected-lmsr-live-current.json");
const base = read("deployments/base-sepolia.json");
if (genlayer.assessmentStatus !== "FINALIZED_SUCCESS" || genlayer.assessment?.decision !== "APPROVED" || genlayer.resolverStatus !== "FINALIZED_SUCCESS") throw new Error("LMSR fixture lacks finalized APPROVED assessment and resolver");
if (record.marketId !== fixture.market_id || record.manifestHash !== fixture.manifest_hash || genlayer.marketId !== record.marketId || genlayer.manifestHash !== record.manifestHash) throw new Error("LMSR fixture, resolver, and deployment record identities differ");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
const canonicalBody = Object.fromEntries(Object.entries(fixture).filter(([key]) => key !== "manifest_hash"));
const actualHash = `0x${crypto.createHash("sha256").update(canonical(canonicalBody), "utf8").digest("hex")}`;
if (actualHash !== fixture.manifest_hash) throw new Error("LMSR manifest SHA-256 mismatch");
const key = env.DEPLOYER_PRIVATE_KEY || env.PRIVATE_KEY;
if (!key) throw new Error("Base integration signer missing");
const account = privateKeyToAccount(key);
if (account.address.toLowerCase() !== record.creator.toLowerCase()) throw new Error("configured signer differs from approved LMSR fixture creator");
const rpc = env.BASE_RPC || "https://sepolia-preconf.base.org";
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });
const factoryArtifact = read("contracts/base/out/MarketFactory.sol/MarketFactory.json");
const marketArtifact = read("contracts/base/out/LMSRMarket.sol/LMSRMarket.json");
const vaultArtifact = read("contracts/base/out/LMSRLiquidityVault.sol/LMSRLiquidityVault.json");
const usdcAbi = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }, { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] }, { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] }];
const outcomeAbi = [{ type: "function", name: "tokenIdFor", stateMutability: "view", inputs: [{ name: "marketId", type: "bytes32" }, { name: "side", type: "uint8" }], outputs: [{ name: "", type: "uint256" }] }, { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] }];
let current = record;
function save(patch) { current = { ...current, ...patch, updatedAt: new Date().toISOString() }; const temp = `${recordPath}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(current, null, 2)}\n`, "utf8"); fs.renameSync(temp, recordPath); }
async function sendOnce(keyName, send) {
  if (current[keyName]) {
    const receipt = await publicClient.getTransactionReceipt({ hash: current[keyName] });
    if (receipt.status !== "success") throw new Error(`${keyName} previously failed; refusing an implicit retry`);
    return { hash: current[keyName], receipt };
  }
  const hash = await send();
  save({ [keyName]: hash, [`${keyName}Status`]: "SUBMITTED" });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") { save({ [`${keyName}Status`]: "FAILED" }); throw new Error(`${keyName} failed on Base Sepolia`); }
  save({ [`${keyName}Status`]: "CONFIRMED" });
  return { hash, receipt };
}
function event(receipt, name) { for (const log of receipt.logs) { try { const result = decodeEventLog({ abi: factoryArtifact.abi, data: log.data, topics: log.topics }); if (result.eventName === name) return result; } catch {} } return undefined; }
const chainId = await publicClient.getChainId();
if (chainId !== 84532) throw new Error(`wrong Base chain ${chainId}`);
const factory = base.contracts.MarketFactory.address;
const usdc = base.usdcAddress;
const b = BigInt(fixture.b);
const terms = { marketId: fixture.market_id, financialReleaseId: fixture.financial_release_id, resolverReleaseId: fixture.resolver_release_id, manifestHash: fixture.manifest_hash, resolver: genlayer.resolverAddress, creator: account.address, closeTime: BigInt(fixture.close_time), resolutionAvailableTime: BigInt(fixture.resolution_available_time), terminalDeadline: BigInt(fixture.absolute_terminal_deadline) };
const fundingDeadline = BigInt(current.fundingDeadline);
const prediction = await publicClient.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "predictLMSRAddresses", args: [terms, b, fundingDeadline] });
if (prediction[0].toLowerCase() !== current.baseMarketAddress.toLowerCase() || prediction[1].toLowerCase() !== current.vaultAddress.toLowerCase()) throw new Error("LMSR CREATE2 market/vault prediction mismatch");
let deployed = await publicClient.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "markets", args: [fixture.market_id] });
if (deployed === "0x0000000000000000000000000000000000000000") {
  const created = await sendOnce("createTx", () => walletClient.writeContract({ address: factory, abi: factoryArtifact.abi, functionName: "createLMSR", args: [terms, b, fundingDeadline] }));
  const createdEvent = event(created.receipt, "LMSRCreated");
  if (!createdEvent || createdEvent.args.market.toLowerCase() !== current.baseMarketAddress.toLowerCase() || createdEvent.args.vault.toLowerCase() !== current.vaultAddress.toLowerCase()) throw new Error("LMSRCreated event does not match predicted bindings");
  deployed = createdEvent.args.market;
}
if (deployed.toLowerCase() !== current.baseMarketAddress.toLowerCase()) throw new Error("market ID resolves to a different LMSR contract");
const market = current.baseMarketAddress;
const vault = current.vaultAddress;
const marketAbi = marketArtifact.abi;
const vaultAbi = vaultArtifact.abi;
const [code, onchainMarketId, onchainB, fundingTarget, resolver, manifestHash, storedVault] = await Promise.all([
  publicClient.getBytecode({ address: market }),
  publicClient.readContract({ address: market, abi: marketAbi, functionName: "marketId" }),
  publicClient.readContract({ address: market, abi: marketAbi, functionName: "b" }),
  publicClient.readContract({ address: market, abi: marketAbi, functionName: "fundingTarget" }),
  publicClient.readContract({ address: market, abi: marketAbi, functionName: "resolver" }),
  publicClient.readContract({ address: market, abi: marketAbi, functionName: "manifestHash" }),
  publicClient.readContract({ address: market, abi: marketAbi, functionName: "vault" }),
]);
if (!code || onchainMarketId.toLowerCase() !== fixture.market_id.toLowerCase() || onchainB !== b || fundingTarget !== 100_000_000n || resolver.toLowerCase() !== genlayer.resolverAddress.toLowerCase() || manifestHash.toLowerCase() !== fixture.manifest_hash.toLowerCase() || storedVault.toLowerCase() !== vault.toLowerCase()) throw new Error("deployed LMSR immutable binding verification failed");
save({ createTx: current.createTx, market, vault, status: "CREATED_BINDINGS_VERIFIED", codeBytes: (code.length - 2) / 2 });

const contribution = 100_000_000n;
const usdcBalance = await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [account.address] });
const oldContribution = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "shares", args: [account.address] });
if (oldContribution < contribution) {
  if (oldContribution !== 0n) throw new Error("partial LP funding found; refusing to add a second contribution blindly");
  const allowance = await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "allowance", args: [account.address, vault] });
  if (allowance < contribution) await sendOnce("fundingApprovalTx", () => walletClient.writeContract({ address: usdc, abi: usdcAbi, functionName: "approve", args: [vault, contribution] }));
  if (usdcBalance < contribution) throw new Error(`need 100 USDC for the locked LMSR target; available ${formatUnits(usdcBalance, 6)}`);
  await sendOnce("lpContributionTx", () => walletClient.writeContract({ address: vault, abi: vaultAbi, functionName: "contribute", args: [contribution] }));
}
const activatedBefore = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "activated" });
if (!activatedBefore) await sendOnce("activationTx", () => walletClient.writeContract({ address: vault, abi: vaultAbi, functionName: "activate", args: [] }));
const statusActive = await publicClient.readContract({ address: market, abi: marketAbi, functionName: "status" });
if (Number(statusActive) !== 1) throw new Error("LMSR funding activation was not confirmed onchain");
save({ status: "ACTIVE", fundingContribution: contribution.toString(), fundingTarget: fundingTarget.toString() });

const shareUnits = 2_000_000n;
const tokenAddress = base.contracts.OutcomeTokens.address.toLowerCase();
const tokens = await publicClient.readContract({ address: tokenAddress, abi: outcomeAbi, functionName: "tokenIdFor", args: [fixture.market_id, 1] });
const noToken = await publicClient.readContract({ address: tokenAddress, abi: outcomeAbi, functionName: "tokenIdFor", args: [fixture.market_id, 0] });
for (const [label, side] of [["yes", 1], ["no", 0]]) {
  const txName = `${label}BuyTx`;
  const positionId = label === "yes" ? tokens : noToken;
  const held = await publicClient.readContract({ address: tokenAddress, abi: outcomeAbi, functionName: "balanceOf", args: [account.address, positionId] });
  if (held < shareUnits && !current[txName]) {
    const quote = await publicClient.readContract({ address: market, abi: marketAbi, functionName: "quoteBuy", args: [side, shareUnits] });
    const maxTotal = quote[0] + quote[1];
    const approvalKey = `${label}TradeApprovalTx`;
    // Each USDC transferFrom consumes its exact allowance. On this testnet,
    // reads immediately after a confirmed receipt can lag; make each side's
    // approval a separately persisted operation instead of trusting that read.
    if (!current[approvalKey]) await sendOnce(approvalKey, () => walletClient.writeContract({ address: usdc, abi: usdcAbi, functionName: "approve", args: [market, maxTotal] }));
    await sendOnce(txName, () => walletClient.writeContract({ address: market, abi: marketAbi, functionName: "buy", args: [side, shareUnits, maxTotal] }));
    save({ [`${label}BuyQuoteNotional`]: quote[0].toString(), [`${label}BuyFee`]: quote[1].toString(), [`${label}BuyShares`]: shareUnits.toString() });
  }
}
for (const [label, side] of [["yes", 1], ["no", 0]]) {
  const txName = `${label}SellTx`;
  const positionId = label === "yes" ? tokens : noToken;
  const held = await publicClient.readContract({ address: tokenAddress, abi: outcomeAbi, functionName: "balanceOf", args: [account.address, positionId] });
  const sellUnits = 1_000_000n;
  if (!current[txName] && held >= sellUnits) {
    const quote = await publicClient.readContract({ address: market, abi: marketAbi, functionName: "quoteSell", args: [side, sellUnits] });
    const minNet = quote[0] - quote[1];
    await sendOnce(txName, () => walletClient.writeContract({ address: market, abi: marketAbi, functionName: "sell", args: [side, sellUnits, minNet] }));
    save({ [`${label}SellNotional`]: quote[0].toString(), [`${label}SellFee`]: quote[1].toString(), [`${label}SellShares`]: sellUnits.toString(), [`${label}SellMinNet`]: minNet.toString() });
  }
}
const [finalStatus, qYes, qNo, yesPosition, noPosition, usdcAfter, lastBlock] = await Promise.all([
  publicClient.readContract({ address: market, abi: marketAbi, functionName: "status" }),
  publicClient.readContract({ address: market, abi: marketAbi, functionName: "qYes" }),
  publicClient.readContract({ address: market, abi: marketAbi, functionName: "qNo" }),
  publicClient.readContract({ address: tokenAddress, abi: outcomeAbi, functionName: "balanceOf", args: [account.address, tokens] }),
  publicClient.readContract({ address: tokenAddress, abi: outcomeAbi, functionName: "balanceOf", args: [account.address, noToken] }),
  publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [account.address] }),
  publicClient.getBlock(),
]);
save({ status: "ACTIVE_TRADES_CONFIRMED", baseBlock: lastBlock.number.toString(), qYes: qYes.toString(), qNo: qNo.toString(), yesPosition: yesPosition.toString(), noPosition: noPosition.toString(), usdcAfterTrading: formatUnits(usdcAfter, 6), marketStatus: Number(finalStatus) });
console.log(JSON.stringify({ chainId, market, vault, marketId: fixture.market_id, resolver: genlayer.resolverAddress, manifestHash: fixture.manifest_hash, b: b.toString(), fundingTarget: fundingTarget.toString(), status: Number(finalStatus), qYes: qYes.toString(), qNo: qNo.toString(), yesPosition: yesPosition.toString(), noPosition: noPosition.toString(), usdcAfter: formatUnits(usdcAfter, 6), createTx: current.createTx, fundingApprovalTx: current.fundingApprovalTx, lpContributionTx: current.lpContributionTx, activationTx: current.activationTx, yesBuyTx: current.yesBuyTx, noBuyTx: current.noBuyTx, yesSellTx: current.yesSellTx, noSellTx: current.noSellTx, closeTime: fixture.close_time, resolutionAvailableTime: fixture.resolution_available_time, terminalDeadline: fixture.absolute_terminal_deadline, statusRecord: current.status }));
