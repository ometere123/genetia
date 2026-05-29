#!/usr/bin/env node
/**
 * One-off: have the Genetia Treasury wallet `approve(factory, MAX_UINT256)`
 * on USDC so the LMSRMarketFactory can pull seed liquidity per new market.
 *
 *   node scripts/approve-treasury.mjs
 *
 * Submits via Circle's developer contractExecution endpoint and polls until
 * the tx confirms on Arc. Idempotent — re-running just sets MAX again (no-op
 * in practice).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const CIRCLE_API_BASE = "https://api.circle.com/v1/w3s";
const USDC = process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const FACTORY = process.env.NEXT_PUBLIC_LMSR_FACTORY_ADDRESS;
const TREASURY_WALLET_ID = process.env.CIRCLE_TREASURY_WALLET_ID;
const MAX_UINT256 = (2n ** 256n - 1n).toString();

const NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341";
const SEED = `genetia-treasury-approve-${FACTORY}`;

function uuidv5(seed, namespace) {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = crypto.createHash("sha1");
  h.update(nsBytes);
  h.update(Buffer.from(seed, "utf8"));
  const bytes = Buffer.from(h.digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

function headers() {
  const key = process.env.CIRCLE_API_KEY;
  if (!key) throw new Error("CIRCLE_API_KEY not set");
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}

async function getPublicKey() {
  const res = await fetch(`${CIRCLE_API_BASE}/config/entity/publicKey`, { headers: headers() });
  if (!res.ok) throw new Error(`Circle publicKey failed: ${await res.text()}`);
  const body = await res.json();
  return body?.data?.publicKey ?? body?.publicKey;
}

async function freshEntitySecretCiphertext() {
  const secret = process.env.CIRCLE_ENTITY_SECRET;
  if (!secret) throw new Error("CIRCLE_ENTITY_SECRET not set");
  const pem = await getPublicKey();
  return crypto
    .publicEncrypt(
      { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(secret.trim(), "hex")
    )
    .toString("base64");
}

async function getTx(id) {
  const res = await fetch(`${CIRCLE_API_BASE}/transactions/${id}`, { headers: headers() });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.data?.transaction ?? null;
}

async function main() {
  if (!FACTORY) throw new Error("NEXT_PUBLIC_LMSR_FACTORY_ADDRESS not set");
  if (!TREASURY_WALLET_ID) throw new Error("CIRCLE_TREASURY_WALLET_ID not set");

  console.log(`→ Treasury wallet:  ${TREASURY_WALLET_ID}`);
  console.log(`→ USDC:             ${USDC}`);
  console.log(`→ Factory:          ${FACTORY}`);
  console.log(`→ Approving MAX_UINT256…`);

  const body = {
    idempotencyKey: uuidv5(SEED, NAMESPACE),
    walletId: TREASURY_WALLET_ID,
    contractAddress: USDC,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [FACTORY, MAX_UINT256],
    feeLevel: "LOW",
    entitySecretCiphertext: await freshEntitySecretCiphertext(),
  };

  const res = await fetch(`${CIRCLE_API_BASE}/developer/transactions/contractExecution`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Circle contractExecution failed: ${JSON.stringify(err)}`);
  }
  const data = await res.json();
  const txId = data?.data?.id;
  console.log(`✓ Submitted. Circle tx id: ${txId}`);
  console.log(`  Polling for confirmation…`);

  const terminalSuccess = new Set(["CONFIRMED", "COMPLETE"]);
  const terminalFail = new Set(["DENIED", "FAILED", "CANCELLED"]);
  const deadline = Date.now() + 120_000;
  let lastState = "";
  while (Date.now() < deadline) {
    const tx = await getTx(txId);
    if (tx && tx.state !== lastState) {
      lastState = tx.state;
      console.log(`  state: ${tx.state}${tx.txHash ? `  tx: ${tx.txHash}` : ""}`);
    }
    if (tx && terminalSuccess.has(tx.state)) {
      console.log(`\n✓ Approve confirmed on Arc.`);
      if (tx.txHash) {
        console.log(`  Explorer: https://testnet.arcscan.app/tx/${tx.txHash}`);
      }
      return;
    }
    if (tx && terminalFail.has(tx.state)) {
      throw new Error(`Arc tx ${tx.state}: ${tx.errorReason ?? "no reason"}`);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error("Timed out waiting for confirmation (120s)");
}

main().catch((err) => {
  console.error("✗ Failed:", err.message ?? err);
  process.exit(1);
});
