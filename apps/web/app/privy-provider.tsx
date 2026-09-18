"use client";
import { PrivyProvider } from "@privy-io/react-auth";

export default function ConfiguredPrivy({ appId, children }: { appId: string; children: React.ReactNode }) {
  return <PrivyProvider appId={appId} config={{ loginMethods: ["email", "google", "wallet", "apple"], embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } }, defaultChain: { id: 84532, name: "Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://base-sepolia-rpc.publicnode.com"] } } } }}>{children}</PrivyProvider>;
}
