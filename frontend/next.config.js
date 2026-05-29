const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // Stub optional peer deps that aren't installed
    config.resolve.alias["@farcaster/mini-app-solana"] =
      require.resolve("./src/lib/empty-module.js");
    config.resolve.alias["@react-native-async-storage/async-storage"] =
      require.resolve("./src/lib/empty-module.js");
    return config;
  },
};

module.exports = withNextIntl(nextConfig);
