import fs from "node:fs";
import { createPublicClient, formatEther, formatUnits, http, keccak256, toBytes } from "../apps/api-worker/node_modules/viem/_esm/index.js";
import { privateKeyToAccount } from "../apps/api-worker/node_modules/viem/_esm/accounts/index.js";
import { baseSepolia } from "../apps/api-worker/node_modules/viem/_esm/chains/index.js";

const env = { ...Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => {
  const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
})), ...process.env };
const manifest = JSON.parse(fs.readFileSync("deployments/base-sepolia.json", "utf8"));
const key = env.DEPLOYER_PRIVATE_KEY || env.PRIVATE_KEY;
if (!key) throw new Error("Base Sepolia signer configuration missing");
const account = privateKeyToAccount(key);
const client = createPublicClient({ chain: baseSepolia, transport: http(env.BASE_RPC || manifest.rpc || "https://sepolia-preconf.base.org") });
const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] }];
const roleAbi = [{ type: "function", name: "hasRole", stateMutability: "view", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [{ name: "", type: "bool" }] }];
const factoryAbi = JSON.parse(fs.readFileSync("contracts/base/out/MarketFactory.sol/MarketFactory.json", "utf8")).abi;
const [block, nativeBalance, usdcBalance, marketCreatorRole] = await Promise.all([
  client.getBlock(),
  client.getBalance({ address: account.address }),
  client.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [account.address] }),
  client.readContract({ address: manifest.contracts.MarketFactory.address, abi: factoryAbi, functionName: "hasRole", args: [keccak256(toBytes("MARKET_CREATOR_ROLE")), account.address] }),
]);
const candidateEntries = Object.entries(env).filter(([name, value]) => /PRIVATE_KEY$/i.test(name) && Boolean(value) && !/^TEST_WATCHER_[1-5]_PRIVATE_KEY$/.test(name));
const candidatesByAddress = new Map();
for (const [name, value] of candidateEntries) {
  const candidate = privateKeyToAccount(value);
  const existing = candidatesByAddress.get(candidate.address.toLowerCase());
  if (existing) existing.names.push(name); else candidatesByAddress.set(candidate.address.toLowerCase(), { candidate, names: [name] });
}
const alternateFunding = await Promise.all([...candidatesByAddress.values()].map(async ({ candidate, names }) => {
  const [native, token, creatorRole] = await Promise.all([
    client.getBalance({ address: candidate.address }),
    client.readContract({ address: usdc, abi: erc20, functionName: "balanceOf", args: [candidate.address] }),
    client.readContract({ address: manifest.contracts.MarketFactory.address, abi: factoryAbi, functionName: "hasRole", args: [keccak256(toBytes("MARKET_CREATOR_ROLE")), candidate.address] }),
  ]);
  return { keyNames: names, address: candidate.address, native: formatEther(native), usdc: formatUnits(token, 6), marketCreatorRole: creatorRole };
}));
const watcherKeysMatch = [];
for (let i = 1; i <= 5; i += 1) {
  const watcherKey = env[`TEST_WATCHER_${i}_PRIVATE_KEY`];
  watcherKeysMatch.push(Boolean(watcherKey && privateKeyToAccount(watcherKey).address.toLowerCase() === manifest.watcherAddresses[i - 1].toLowerCase()));
}
console.log(JSON.stringify({ chainId: 84532, block: block.number.toString(), blockTimestamp: Number(block.timestamp), deployer: account.address, native: formatEther(nativeBalance), usdc: formatUnits(usdcBalance, 6), marketCreatorRole, otherConfiguredSignerBalances: alternateFunding, watcherKeysMatch }));
