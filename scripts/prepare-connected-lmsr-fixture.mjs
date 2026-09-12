import fs from "node:fs";
import crypto from "node:crypto";
import { createPublicClient, http } from "../apps/api-worker/node_modules/viem/_esm/index.js";
import { privateKeyToAccount } from "../apps/api-worker/node_modules/viem/_esm/accounts/index.js";
import { baseSepolia } from "../apps/api-worker/node_modules/viem/_esm/chains/index.js";

const root = process.cwd();
const out = `${root}/contracts/genlayer/fixtures/connected_lmsr_live.json`;
const outRecord = `${root}/deployments/base-connected-lmsr.json`;
if (fs.existsSync(out) || fs.existsSync(outRecord)) throw new Error("LMSR connected fixture/record already exists; refusing to replace operation identity");
const fileEnv = Object.fromEntries(fs.readFileSync(`${root}/.env`, "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^['\"]|['\"]$/g, "")]; }));
const env = { ...fileEnv, ...process.env };
const base = JSON.parse(fs.readFileSync(`${root}/deployments/base-sepolia.json`, "utf8"));
const studio = JSON.parse(fs.readFileSync(`${root}/deployments/genlayer-studio-dev.json`, "utf8"));
const key = env.DEPLOYER_PRIVATE_KEY || env.PRIVATE_KEY;
if (!key) throw new Error("missing Base Sepolia integration signer");
const creator = privateKeyToAccount(key).address;
const client = createPublicClient({ chain: baseSepolia, transport: http(env.BASE_RPC || "https://sepolia-preconf.base.org") });
const factoryArtifact = JSON.parse(fs.readFileSync(`${root}/contracts/base/out/MarketFactory.sol/MarketFactory.json`, "utf8"));
const block = await client.getBlock();
const marketId = `0x${crypto.createHash("sha256").update(`genetia-lmsr-live-${block.hash}-${block.timestamp}-${Date.now()}`).digest("hex")}`;
const closeTime = Number(block.timestamp) + 1800;
const resolutionAvailableTime = closeTime + 60;
const terminalDeadline = resolutionAvailableTime + 96 * 60 * 60;
const fundingDeadline = closeTime - 120;
const b = 100_000_000n;
const factory = base.contracts.MarketFactory.address;
const terms = {
  marketId,
  financialReleaseId: base.financialReleases.lmsr.releaseId,
  resolverReleaseId: studio.sharedContracts.resolverFactory.childResolverReleaseId,
  manifestHash: `0x${"00".repeat(32)}`,
  resolver: `0x${"00".repeat(20)}`,
  creator,
  closeTime: BigInt(closeTime),
  resolutionAvailableTime: BigInt(resolutionAvailableTime),
  terminalDeadline: BigInt(terminalDeadline),
};
const [baseMarketAddress, vaultAddress] = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "predictLMSRAddresses", args: [terms, b, BigInt(fundingDeadline)] });
const manifest = {
  absolute_terminal_deadline: terminalDeadline,
  arbitrary_caller_urls_forbidden: true,
  authoritative_sources: [{ exact_url: "https://example.com/", identity: "example-domain", priority: 0, required: true, source_type: "controlled-static-integration-source" }],
  base_chain_id: 84532,
  base_market_address: baseMarketAddress,
  b: b.toString(),
  category: "integration-test",
  close_time: closeTime,
  corroboration_rule: "The locked source must contain the exact canonical heading in the question; missing or conflicting evidence remains UNRESOLVED.",
  discovery_rule: "Use only the exact locked URL in this manifest; no caller-supplied or discovered URLs are permitted.",
  engine: "LMSR",
  evidence_attempt_schedule_seconds: [0, 1800, 14400, 86400, 259200],
  fallback_sources: [],
  financial_release_id: base.financialReleases.lmsr.releaseId,
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
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}` : JSON.stringify(value);
manifest.manifest_hash = `0x${crypto.createHash("sha256").update(canonical(manifest), "utf8").digest("hex")}`;
terms.manifestHash = manifest.manifest_hash;
terms.resolver = `0x${"00".repeat(20)}`;
const verifiedPrediction = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: "predictLMSRAddresses", args: [terms, b, BigInt(fundingDeadline)] });
if (verifiedPrediction[0].toLowerCase() !== baseMarketAddress.toLowerCase() || verifiedPrediction[1].toLowerCase() !== vaultAddress.toLowerCase()) throw new Error("LMSR CREATE2 prediction changed unexpectedly");
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
fs.writeFileSync(outRecord, `${JSON.stringify({ chainId: 84532, engine: "LMSR", marketId, creator, baseMarketAddress, vaultAddress, manifestHash: manifest.manifest_hash, financialReleaseId: manifest.financial_release_id, resolverReleaseId: manifest.resolver_release_id, b: b.toString(), fundingTarget: "100000000", fundingDeadline, closeTime, resolutionAvailableTime, terminalDeadline, status: "MANIFEST_PREPARED" }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ fixture: "contracts/genlayer/fixtures/connected_lmsr_live.json", marketId, baseMarketAddress, vaultAddress, manifestHash: manifest.manifest_hash, b: b.toString(), fundingTarget: "100000000", closeTime, resolutionAvailableTime, terminalDeadline }));
