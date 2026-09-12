import fs from "node:fs";
import crypto from "node:crypto";
import { createPublicClient, http } from "../apps/api-worker/node_modules/viem/_esm/index.js";
import { privateKeyToAccount } from "../apps/api-worker/node_modules/viem/_esm/accounts/index.js";
import { baseSepolia } from "../apps/api-worker/node_modules/viem/_esm/chains/index.js";

const root = process.cwd();
const output = `${root}/contracts/genlayer/fixtures/connected_pool_live.json`;
if (fs.existsSync(output)) throw new Error("live Pool fixture already exists; refusing to overwrite its market identity");
const env = Object.fromEntries(fs.readFileSync(`${root}/.env`, "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => {
  const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
}));
const base = JSON.parse(fs.readFileSync(`${root}/deployments/base-sepolia.json`, "utf8"));
const studio = JSON.parse(fs.readFileSync(`${root}/deployments/genlayer-studio-dev.json`, "utf8"));
const deployer = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY || env.PRIVATE_KEY);
const factoryAbi = JSON.parse(fs.readFileSync(`${root}/contracts/base/out/MarketFactory.sol/MarketFactory.json`, "utf8")).abi;
const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const latest = await client.getBlock();
const marketId = `0x${crypto.createHash("sha256").update(`genetia-pool-live-${latest.hash}-${latest.timestamp}`).digest("hex")}`;
const closeTime = Number(latest.timestamp) + 7200;
const resolutionAvailableTime = closeTime + 60;
const terminalDeadline = resolutionAvailableTime + 96 * 60 * 60;
const terms = {
  marketId,
  financialReleaseId: base.financialReleases.pool.releaseId,
  resolverReleaseId: studio.sharedContracts.resolverFactory.childResolverReleaseId,
  manifestHash: `0x${"00".repeat(32)}`,
  resolver: `0x${"00".repeat(20)}`,
  creator: deployer.address,
  closeTime: BigInt(closeTime),
  resolutionAvailableTime: BigInt(resolutionAvailableTime),
  terminalDeadline: BigInt(terminalDeadline),
};
const baseMarketAddress = await client.readContract({ address: base.contracts.MarketFactory.address, abi: factoryAbi, functionName: "predictPoolAddress", args: [terms] });
const body = {
  absolute_terminal_deadline: terminalDeadline,
  arbitrary_caller_urls_forbidden: true,
  authoritative_sources: [{ exact_url: "https://example.com/", identity: "example-domain", priority: 0, required: true, source_type: "controlled-static-integration-source" }],
  base_chain_id: 84532,
  base_market_address: baseMarketAddress,
  category: "integration-test",
  close_time: closeTime,
  corroboration_rule: "The locked source must contain the exact canonical heading in the question; missing or conflicting evidence remains UNRESOLVED.",
  discovery_rule: "Use only the exact locked URL in this manifest; no caller-supplied or discovered URLs are permitted.",
  engine: "POOL",
  evidence_attempt_schedule_seconds: [0, 1800, 14400, 86400, 259200],
  fallback_sources: [],
  financial_release_id: base.financialReleases.pool.releaseId,
  freshness_rule: "The locked page must be fetched at the eligible evidence attempt.",
  genlayer_chain_id: 61997,
  manifest_release_id: "genetia-manifest-canonical-json-sha256-2026-09",
  market_id: marketId,
  minimum_corroborating_sources: 1,
  no_definition: "NO if the locked page does not display the canonical heading 'Example Domain'.",
  official_source_required: false,
  prompt_release_id: "genetia-resolution-prompt-2026-09",
  question: "Does the locked Example Domain page display the heading 'Example Domain'?",
  resolution_available_time: resolutionAvailableTime,
  resolution_profile: "STRUCTURED",
  resolver_release_id: studio.sharedContracts.resolverFactory.childResolverReleaseId,
  source_policy: "The exact https://example.com/ page is the sole source for this controlled Studio Dev/Base Sepolia integration fixture.",
  void_conditions: ["VOID if the locked source is unavailable or remains unresolved after the final scheduled evidence attempt."],
  yes_definition: "YES if the exact locked page displays the heading 'Example Domain'.",
};
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
body.manifest_hash = `0x${crypto.createHash("sha256").update(canonical(body), "utf8").digest("hex")}`;
fs.writeFileSync(output, `${JSON.stringify(body, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ fixture: "contracts/genlayer/fixtures/connected_pool_live.json", marketId, baseMarketAddress, manifestHash: body.manifest_hash, closeTime, resolutionAvailableTime, terminalDeadline, financialReleaseId: body.financial_release_id, resolverReleaseId: body.resolver_release_id }));
