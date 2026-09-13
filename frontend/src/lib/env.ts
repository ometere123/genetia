import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),

  // Privy (auth)
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().optional(),
  PRIVY_SECRET: z.string().optional(), // legacy alias

  // Circle (Genetia Wallet)
  CIRCLE_API_KEY: z.string().min(1),
  CIRCLE_ENTITY_SECRET: z.string().min(1),
  CIRCLE_WALLET_SET_ID: z.string().min(1),
  CIRCLE_BLOCKCHAIN: z.string().default("ARC-TESTNET"),
  CIRCLE_ACCOUNT_TYPE: z.string().default("SCA"),
  CIRCLE_USDC_TOKEN_ID: z.string().optional(),

  // GenLayer (market resolution)
  GENLAYER_RPC: z.string().url().default("https://studio.genlayer.com/api"),
  GENLAYER_RPC_URL: z.string().url().optional(),
  GENLAYER_CHAIN_ID: z.string().default("61999"),
  GENLAYER_CONTRACT_ADDRESS: z.string().optional(),
  GENLAYER_RELAYER_PRIVATE_KEY: z.string().optional(),

  // Arc settlement
  ARC_RESOLVER_PRIVATE_KEY: z.string().optional(),
  ARC_ADMIN_PRIVATE_KEY: z.string().optional(),
  ARC_RESOLVER_ADDRESS: z.string().optional(),
  ARC_OPERATOR_PRIVATE_KEY: z.string().optional(),
  BLOCKSCOUT_API_KEY: z.string().optional(),

  // Cron / scheduling
  CRON_SECRET: z.string().optional(),
  APP_URL: z.string().optional(),
  POLL_INTERVAL_MS: z.string().optional(),
  INDEX_INTERVAL_MS: z.string().optional(),
  ADMIN_WALLET_ADDRESS: z.string().optional(),
  TREASURY_ADDRESS: z.string().optional(),
  ADMIN_SLUG: z.string().optional(),
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().min(1),
  NEXT_PUBLIC_ARC_CHAIN_ID: z.string().default("5042002"),
  NEXT_PUBLIC_ARC_RPC_URL: z.string().default("https://rpc.testnet.arc.network"),
  NEXT_PUBLIC_MARKET_FACTORY_ADDRESS: z.string().optional(),
  NEXT_PUBLIC_LMSR_FACTORY_ADDRESS: z.string().optional(),
  NEXT_PUBLIC_OUTCOME_TOKENS_ADDRESS: z.string().optional(),
  NEXT_PUBLIC_ARC_USDC_ADDRESS: z.string().optional(),
  NEXT_PUBLIC_ARC_EXPLORER_URL: z.string().optional(),
  NEXT_PUBLIC_GENLAYER_RESOLVER_ADDRESS: z.string().optional(),
  NEXT_PUBLIC_ARC_RESOLVER_ADDRESS: z.string().optional(),
  NEXT_PUBLIC_ADMIN_ADDRESS: z.string().optional(),
  NEXT_PUBLIC_ADMIN_SLUG: z.string().optional(),
  NEXT_PUBLIC_TREASURY_ADDRESS: z.string().optional(),
  NEXT_PUBLIC_MIN_TRADE_USDC: z.string().optional(),
  NEXT_PUBLIC_MAX_TRADE_USDC: z.string().optional(),
});

function validateServerEnv() {
  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((i) => i.path.join("."))
      .join(", ");
    throw new Error(`Missing server env vars: ${missing}`);
  }
  return result.data;
}

function validatePublicEnv() {
  const result = publicEnvSchema.safeParse(process.env);
  if (!result.success) {
    console.warn("Missing public env vars:", result.error.issues);
    return publicEnvSchema.parse({
      NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
      NEXT_PUBLIC_ARC_CHAIN_ID: process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002",
      NEXT_PUBLIC_ARC_RPC_URL: process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
      NEXT_PUBLIC_MARKET_FACTORY_ADDRESS: process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS,
      NEXT_PUBLIC_LMSR_FACTORY_ADDRESS: process.env.NEXT_PUBLIC_LMSR_FACTORY_ADDRESS,
      NEXT_PUBLIC_OUTCOME_TOKENS_ADDRESS: process.env.NEXT_PUBLIC_OUTCOME_TOKENS_ADDRESS,
      NEXT_PUBLIC_ARC_USDC_ADDRESS: process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS,
      NEXT_PUBLIC_ARC_EXPLORER_URL: process.env.NEXT_PUBLIC_ARC_EXPLORER_URL,
      NEXT_PUBLIC_GENLAYER_RESOLVER_ADDRESS: process.env.NEXT_PUBLIC_GENLAYER_RESOLVER_ADDRESS,
      NEXT_PUBLIC_ARC_RESOLVER_ADDRESS: process.env.NEXT_PUBLIC_ARC_RESOLVER_ADDRESS,
      NEXT_PUBLIC_ADMIN_ADDRESS: process.env.NEXT_PUBLIC_ADMIN_ADDRESS,
      NEXT_PUBLIC_ADMIN_SLUG: process.env.NEXT_PUBLIC_ADMIN_SLUG,
      NEXT_PUBLIC_TREASURY_ADDRESS: process.env.NEXT_PUBLIC_TREASURY_ADDRESS,
      NEXT_PUBLIC_MIN_TRADE_USDC: process.env.NEXT_PUBLIC_MIN_TRADE_USDC,
      NEXT_PUBLIC_MAX_TRADE_USDC: process.env.NEXT_PUBLIC_MAX_TRADE_USDC,
    });
  }
  return result.data;
}

// Only called in server contexts
export const serverEnv = () => validateServerEnv();

// Safe to call anywhere
export const publicEnv = validatePublicEnv();
