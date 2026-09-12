import fs from "node:fs";
import { createPublicClient, http } from "../apps/api-worker/node_modules/viem/_esm/index.js";
import { baseSepolia } from "../apps/api-worker/node_modules/viem/_esm/chains/index.js";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['"]|['"]$/g, "")]; }));
const record = JSON.parse(fs.readFileSync("deployments/base-connected-pool.json", "utf8"));
const base = JSON.parse(fs.readFileSync("deployments/base-sepolia.json", "utf8"));
const factoryAbi = JSON.parse(fs.readFileSync("contracts/base/out/MarketFactory.sol/MarketFactory.json", "utf8")).abi;
const client = createPublicClient({ chain: baseSepolia, transport: http(env.BASE_RPC || base.rpc) });
const poolAbi = JSON.parse(fs.readFileSync("contracts/base/out/PoolMarket.sol/PoolMarket.json", "utf8")).abi;
const [chainId, block, receipt, code, market, yesTotal, noTotal, yesReceipt, noReceipt, yesStake, noStake] = await Promise.all([
  client.getChainId(), client.getBlock(), client.getTransactionReceipt({ hash: record.createTx }),
  client.getBytecode({ address: record.market }),
  client.readContract({ address: base.contracts.MarketFactory.address, abi: factoryAbi, functionName: "markets", args: [record.marketId] }),
  client.readContract({ address: record.market, abi: poolAbi, functionName: "yesTotal" }),
  client.readContract({ address: record.market, abi: poolAbi, functionName: "noTotal" }),
  client.readContract({ address: record.market, abi: poolAbi, functionName: "yesReceipts", args: ["0x05500AFb3667F5a006cbAe18d41CaE241e2893d3"] }),
  client.readContract({ address: record.market, abi: poolAbi, functionName: "noReceipts", args: ["0x05500AFb3667F5a006cbAe18d41CaE241e2893d3"] }),
  client.getTransactionReceipt({ hash: record.yesStakeTx }),
  client.getTransactionReceipt({ hash: record.noStakeTx }),
]);
console.log(JSON.stringify({ chainId, block: block.number.toString(), market: record.market, createTx: record.createTx, receiptStatus: receipt.status, receiptBlock: receipt.blockNumber.toString(), receiptLogs: receipt.logs.length, codeBytes: code ? (code.length - 2) / 2 : 0, factoryMarket: market, yesTotal: yesTotal.toString(), noTotal: noTotal.toString(), yesReceipt: yesReceipt.toString(), noReceipt: noReceipt.toString(), yesStakeStatus: yesStake.status, noStakeStatus: noStake.status, yesStakeBlock: yesStake.blockNumber.toString(), noStakeBlock: noStake.blockNumber.toString(), yesStakeLogs: yesStake.logs.length, noStakeLogs: noStake.logs.length }));
