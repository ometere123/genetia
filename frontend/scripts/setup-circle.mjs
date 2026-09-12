// Genetia — one-shot Circle setup helper.
//
// Reads CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET from .env.local.
// Does these things:
//   1. Fetches Circle's RSA public key
//   2. Encrypts your entity secret → CIRCLE_ENTITY_SECRET_CIPHERTEXT
//   3. (Optional) Registers the entity secret + saves the recovery file
//   4. Creates a wallet set named "genetia" → CIRCLE_WALLET_SET_ID
//   5. Looks up USDC token IDs across supported chains → CIRCLE_USDC_TOKEN_ID
//
// Run with:  node --env-file=.env.local scripts/setup-circle.mjs

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://api.circle.com/v1/w3s";

const API_KEY = process.env.CIRCLE_API_KEY;
const ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;

if (!API_KEY) {
  console.error("✗ CIRCLE_API_KEY is missing in .env.local");
  process.exit(1);
}
if (!ENTITY_SECRET) {
  console.error("✗ CIRCLE_ENTITY_SECRET is missing in .env.local");
  process.exit(1);
}

const entityBytes = Buffer.from(ENTITY_SECRET.trim(), "hex");
if (entityBytes.length !== 32) {
  console.error(
    `✗ CIRCLE_ENTITY_SECRET must be 64 hex characters (32 bytes). ` +
      `Got ${entityBytes.length} bytes from value of length ${ENTITY_SECRET.trim().length}.`
  );
  process.exit(1);
}

function authHeader() {
  return { Authorization: `Bearer ${API_KEY}` };
}

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      ...authHeader(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

function pickPublicKeyPem(body) {
  // Circle has used a few shapes here historically; try them all.
  return (
    body?.data?.publicKey ??
    body?.publicKey ??
    body?.data ??
    null
  );
}

function encryptEntitySecret(publicKeyPem) {
  // Circle uses RSA-OAEP with SHA-256.
  const ciphertext = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    entityBytes
  );
  return ciphertext.toString("base64");
}

async function main() {
  console.log("→ Fetching Circle public key…");
  const pk = await api("GET", "/config/entity/publicKey");
  if (!pk.ok) {
    console.error(`✗ publicKey ${pk.status}:`, pk.body);
    process.exit(1);
  }
  const publicKeyPem = pickPublicKeyPem(pk.body);
  if (!publicKeyPem || !String(publicKeyPem).includes("BEGIN")) {
    console.error("✗ Could not extract PEM from response:", pk.body);
    process.exit(1);
  }
  console.log("✓ Got public key");

  // 1. Ciphertext
  let ciphertext;
  try {
    ciphertext = encryptEntitySecret(publicKeyPem);
  } catch (err) {
    console.error("✗ RSA encrypt failed:", err);
    process.exit(1);
  }
  console.log("✓ Generated entity-secret ciphertext");

  // 2. Try to register the entity secret (saves recovery file). Idempotent —
  //    Circle returns 409/already initialized if it's been done.
  const recoveryFile = path.resolve(process.cwd(), "circle-recovery-file.dat");
  if (!fs.existsSync(recoveryFile)) {
    console.log("→ Registering entity secret (one-time)…");
    const init = await api("POST", "/developer/entitySecret", {
      entitySecretCiphertext: ciphertext,
    });
    if (init.ok) {
      const recovery = init.body?.data?.recoveryFile ?? init.body?.recoveryFile;
      if (recovery) {
        fs.writeFileSync(recoveryFile, recovery, "utf8");
        console.log(`✓ Saved recovery file → ${recoveryFile}`);
      } else {
        console.log("✓ Entity secret registered (no recovery file in response)");
      }
    } else if (init.status === 409 || /already/i.test(JSON.stringify(init.body))) {
      console.log("✓ Entity secret already registered");
    } else {
      console.warn(
        `! Entity secret registration returned ${init.status}. Continuing anyway:`,
        init.body
      );
    }
  } else {
    console.log(`✓ Recovery file already exists at ${recoveryFile}`);
  }

  // 3. Wallet set
  console.log("→ Creating wallet set…");
  const idempotencyKey = `genetia-walletset-${crypto.randomUUID()}`;
  const ws = await api("POST", "/developer/walletSets", {
    idempotencyKey,
    entitySecretCiphertext: ciphertext,
    name: "genetia",
  });
  let walletSetId;
  if (ws.ok) {
    walletSetId = ws.body?.data?.walletSet?.id;
    console.log(`✓ Wallet set: ${walletSetId}`);
  } else {
    // Check for an existing one if creation collided.
    console.warn(`! Create returned ${ws.status}:`, ws.body);
    const list = await api("GET", "/walletSets?pageSize=10");
    walletSetId = list?.body?.data?.walletSets?.[0]?.id;
    if (walletSetId) {
      console.log(`✓ Falling back to existing wallet set: ${walletSetId}`);
    } else {
      console.error("✗ No wallet set could be created or fetched.");
    }
  }

  // 4. USDC token ID — try ARC-TESTNET first, then fall back to other testnets.
  const chains = ["ARC-TESTNET", "MATIC-AMOY", "ETH-SEPOLIA", "ARB-SEPOLIA", "BASE-SEPOLIA"];
  let usdcTokenId, usdcChain;
  for (const chain of chains) {
    const tokens = await api("GET", `/tokens?blockchain=${chain}`);
    if (!tokens.ok) continue;
    const list = tokens.body?.data?.tokens ?? [];
    const usdc = list.find((t) => /^USDC/i.test(t.symbol));
    if (usdc) {
      usdcTokenId = usdc.id;
      usdcChain = chain;
      console.log(`✓ USDC token on ${chain}: ${usdcTokenId}`);
      break;
    }
  }
  if (!usdcTokenId) {
    console.log("! No USDC token found via /tokens. You can skip this var for now.");
  }

  // ── Output
  console.log("\n──────── Paste into frontend/.env.local ────────");
  console.log(`CIRCLE_ENTITY_SECRET_CIPHERTEXT=${ciphertext}`);
  if (walletSetId) console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
  if (usdcTokenId) console.log(`CIRCLE_USDC_TOKEN_ID=${usdcTokenId}`);
  if (usdcChain && usdcChain !== "ARC-TESTNET") {
    console.log(`# Note: USDC found on ${usdcChain}, not ARC-TESTNET.`);
    console.log(`CIRCLE_BLOCKCHAIN=${usdcChain}`);
  }
  console.log("────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
