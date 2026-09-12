import fs from "node:fs";
import { attest } from "../workers/resolution-watcher/src/index.ts";

process.on("uncaughtException", (error) => { console.error(`watcher integration diagnostic failed: ${error.message}`); process.exitCode = 1; });
process.on("unhandledRejection", (reason) => { console.error(`watcher integration diagnostic rejected: ${reason instanceof Error ? reason.message : "unknown error"}`); process.exitCode = 1; });

const readEnv = (filename) => Object.fromEntries(fs.readFileSync(filename, "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
}));
const envValues = readEnv(new URL("../.env", import.meta.url));
const baseDeployment = JSON.parse(fs.readFileSync(new URL("../deployments/base-sepolia.json", import.meta.url), "utf8"));
const record = JSON.parse(fs.readFileSync(new URL("../deployments/genlayer-connected-e2e.json", import.meta.url), "utf8"));
const manifest = JSON.parse(fs.readFileSync(new URL("../contracts/genlayer/fixtures/connected_pool_manifest.json", import.meta.url), "utf8"));
const key = envValues.TEST_WATCHER_1_PRIVATE_KEY;
if (!key) throw new Error("watcher signer is not configured");
const envelope = {
  marketId: record.marketId,
  baseMarket: manifest.base_market_address,
  baseChainId: 84532,
  resolver: record.resolverAddress,
  genlayerChainId: 61997,
  genlayerTxId: record.resolveTx,
  manifestHash: record.manifestHash,
  resolverReleaseId: manifest.resolver_release_id,
  attempt: record.resolveAttempt,
  outcome: 0,
  evidenceCommitment: record.attemptRecord.evidence_commitment,
  resultCommitment: record.attemptRecord.result_commitment,
  gateway: baseDeployment.contracts.ResolutionGateway.address,
};
try {
  await attest(envelope, { WATCHER_ID: "watcher-1", WATCHER_PRIVATE_KEY: key, GENLAYER_RPC: "https://studio-dev.genlayer.com/api" });
  throw new Error("watcher unexpectedly attested an UNRESOLVED resolver result");
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown rejection";
  if (!message.includes("wrong resolver result") && !message.includes("resolver commitments are missing")) throw new Error(`watcher rejected for an unexpected reason: ${message}`);
  console.log(JSON.stringify({ result: "UNRESOLVED_REJECTED", transaction: record.resolveTx, resolver: record.resolverAddress, attempt: record.resolveAttempt, readVariant: "LATEST_FINAL", reason: message }));
}
