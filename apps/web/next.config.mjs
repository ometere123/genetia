/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@genetia/sdk", "@genetia/shared"],
  webpack(config) {
    // Privy treats Farcaster Solana support as optional. Keep the EVM-only
    // Base Sepolia build deterministic when that optional peer is absent.
    config.resolve.alias["@farcaster/mini-app-solana"] = false;
    return config;
  },
};
export default nextConfig;
