// Sets environment variables that resolver-pipeline.ts reads at module load
// time (i.e., at the const ARC_RESOLVER_KEY = process.env... lines).
// Must live in setupFiles (runs BEFORE the test module registry is loaded).

process.env.ARC_RESOLVER_PRIVATE_KEY = "0x" + "a".repeat(64);
process.env.GENLAYER_RELAYER_PRIVATE_KEY = "test-relayer-key";
process.env.NEXT_PUBLIC_ARC_CHAIN_ID = "5042002";
process.env.NEXT_PUBLIC_ARC_RPC_URL = "http://localhost:8545";
// Default GENLAYER_CONTRACT_ADDRESS is already a valid 40-hex address so
// validateGenLayerConfig passes without setting it explicitly.
