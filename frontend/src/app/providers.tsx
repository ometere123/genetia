"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "@privy-io/wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import { wagmiConfig } from "../lib/wagmi";
import { arcTestnet } from "../lib/arc";
import { AuthProvider, useAuth } from "../contexts/AuthContext";
import { ThemeProvider } from "../contexts/ThemeContext";
import { lazy, Suspense } from "react";

const DepositModal = lazy(() => import("../components/DepositModal"));

const queryClient = new QueryClient();

function GlobalModals() {
  const { showDepositModal } = useAuth();
  return (
    <Suspense>
      {showDepositModal && <DepositModal />}
    </Suspense>
  );
}

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#8B5CF6",
          showWalletLoginFirst: false,
          walletChainType: "ethereum-only",
        },
        // No embedded wallets — Circle Smart Wallets handle all custody
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
          showWalletUIs: false,
        },
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet],
        // External wallet options
        externalWallets: {
          coinbaseWallet: { config: {} },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <ThemeProvider>
            <AuthProvider>
              {children}
              <GlobalModals />
            </AuthProvider>
          </ThemeProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
