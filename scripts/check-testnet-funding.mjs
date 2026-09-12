import fs from "node:fs";
import { createPublicClient, formatEther, formatUnits, http } from "../apps/api-worker/node_modules/viem/_esm/index.js";
import { baseSepolia } from "../apps/api-worker/node_modules/viem/_esm/chains/index.js";
import { createAccount, createClient } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/index.js";
import { studioDevnet } from "../apps/orchestration-worker/node_modules/genlayer-js/dist/chains/index.js";

const fileEnv = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => {
  const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
}));
const env = { ...fileEnv, ...process.env };
const baseKey = env.DEPLOYER_PRIVATE_KEY || env.PRIVATE_KEY;
const glKey = env.GENLAYER_PRIVATE_KEY || env.RESOLVER_PRIVATE_KEY;
if (!baseKey || !glKey) throw new Error("testnet signer configuration missing");
const baseAccount = createAccount(baseKey);
const base = createPublicClient({ chain: baseSepolia, transport: http(env.BASE_RPC || "https://sepolia-preconf.base.org") });
const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const usdcAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] }];
const [ethBalance, usdcBalance] = await Promise.all([
  base.getBalance({ address: baseAccount.address }),
  base.readContract({ address: usdc, abi: usdcAbi, functionName: "balanceOf", args: [baseAccount.address] }),
]);
const glAccount = createAccount(glKey);
const gl = createClient({ chain: studioDevnet, endpoint: "https://studio-dev.genlayer.com/api", account: glAccount });
const glBalance = await gl.getBalance({ address: glAccount.address });
console.log(JSON.stringify({ baseSepolia: { address: baseAccount.address, eth: formatEther(ethBalance), usdc: formatUnits(usdcBalance, 6) }, studioDev: { address: glAccount.address, native: formatEther(glBalance) } }));
