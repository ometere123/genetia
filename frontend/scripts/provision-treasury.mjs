#!/usr/bin/env node
/**
 * One-off: provision the Genetia Treasury Circle wallet on ARC-TESTNET.
 *
 *   node scripts/provision-treasury.mjs
 *
 * Idempotent — re-running with the same `idempotencyKey` returns the same
 * wallet, so it's safe to run twice if something goes wrong.
 *
 * Required env (read from frontend/.env via dotenv):
 *   CIRCLE_API_KEY
 *   CIRCLE_ENTITY_SECRET     (64-char hex, NOT the ciphertext)
 *   CIRCLE_WALLET_SET_ID
 *
 * Outputs:
 *   - Treasury Circle wallet ID (UUID)         → CIRCLE_TREASURY_WALLET_ID
 *   - Treasury wallet address (0x…)            → TREASURY_ADDRESS
 *
 * Then it tells you exactly what to paste where.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Minimal .env loader — avoids a dotenv dep. Looks for ./.env relative to
// the script's parent (frontend/), so run this from the frontend/ directory.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const raw of lines) {
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
const BLOCKCHAIN  = process.env.CIRCLE_BLOCKCHAIN  ?? "ARC-TESTNET";
const ACCOUNT_TYPE = process.env.CIRCLE_ACCOUNT_TYPE ?? "SCA";

// Fixed UUIDv5 from "genetia-treasury-v1" under a project namespace.
// Recomputed deterministically below from `treasurySeed` so re-runs are
// idempotent (Circle returns the same wallet for the same UUID).
const TREASURY_NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341";
const TREASURY_SEED = "genetia-treasury-v1";

function uuidv5(seed, namespace) {
  // RFC 4122 §4.3 — SHA-1 based name UUID. Adequate for idempotency keys.
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const sha1 = crypto.createHash("sha1");
  sha1.update(nsBytes);
  sha1.update(Buffer.from(seed, "utf8"));
  const hash = sha1.digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}
const IDEMPOTENCY_KEY = uuidv5(TREASURY_SEED, TREASURY_NAMESPACE);

function headers() {
  const key = process.env.CIRCLE_API_KEY;
  if (!key) throw new Error("CIRCLE_API_KEY is not set in .env");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

async function getPublicKey() {
  const res = await fetch(`${CIRCLE_API_BASE}/config/entity/publicKey`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Circle publicKey failed: ${JSON.stringify(err)}`);
  }
  const body = await res.json();
  const pem = body?.data?.publicKey ?? body?.publicKey;
  if (!pem || !String(pem).includes("BEGIN")) {
    throw new Error("Circle returned no public key");
  }
  return pem;
}

async function freshEntitySecretCiphertext() {
  const secret = process.env.CIRCLE_ENTITY_SECRET;
  if (!secret) throw new Error("CIRCLE_ENTITY_SECRET is not set in .env");
  const entityBytes = Buffer.from(secret.trim(), "hex");
  if (entityBytes.length !== 32) {
    throw new Error("CIRCLE_ENTITY_SECRET must be 64-char hex (32 bytes)");
  }
  const pem = await getPublicKey();
  const ciphertext = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    entityBytes
  );
  return ciphertext.toString("base64");
}

async function main() {
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID;
  if (!walletSetId) throw new Error("CIRCLE_WALLET_SET_ID is not set in .env");

  const body = {
    idempotencyKey: IDEMPOTENCY_KEY,
    blockchains: [BLOCKCHAIN],
    accountType: ACCOUNT_TYPE,
    count: 1,
    walletSetId,
    entitySecretCiphertext: await freshEntitySecretCiphertext(),
    metadata: [
      {
        name: "genetia-treasury",
        refId: "treasury",
      },
    ],
  };

  console.log(`→ Creating treasury wallet on ${BLOCKCHAIN} (${ACCOUNT_TYPE})…`);

  const res = await fetch(`${CIRCLE_API_BASE}/developer/wallets`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Circle createWallet failed: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  const wallet = data?.data?.wallets?.[0];
  if (!wallet) {
    throw new Error(`Circle returned no wallet: ${JSON.stringify(data)}`);
  }

  console.log("");
  console.log("✓ Treasury wallet provisioned.");
  console.log("");
  console.log("  Wallet ID :", wallet.id);
  console.log("  Address   :", wallet.address);
  console.log("  Blockchain:", wallet.blockchain);
  console.log("  State     :", wallet.state);
  console.log("");
  console.log("─── Paste these into your env ───────────────────────────────");
  console.log("");
  console.log("  contracts/arc/.env:");
  console.log(`    TREASURY_ADDRESS=${wallet.address}`);
  console.log("");
  console.log("  frontend/.env:");
  console.log(`    CIRCLE_TREASURY_WALLET_ID=${wallet.id}`);
  console.log("");
  console.log("─── Next ───────────────────────────────────────────────────");
  console.log("");
  console.log("  1. Faucet the treasury address with USDC:");
  console.log(`     https://faucet.circle.com   →   send to ${wallet.address}`);
  console.log("     Aim for ~500 USDC (enough to seed ~5 markets at b=100).");
  console.log("");
  console.log("  2. The factory deploy step will tell you when to do the");
  console.log("     `USDC.approve(factory, MAX)` step. Hold off on that for");
  console.log("     now — we need the factory address first.");
  console.log("");
}

main().catch((err) => {
  console.error("✗ Failed:", err.message ?? err);
  process.exit(1);
});
