"use client";
import dynamic from "next/dynamic";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ConfiguredPrivy = dynamic(() => import("./privy-provider"), { ssr: false });
const queryClient = new QueryClient();

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const content = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  if (!appId) return content;
  return <ConfiguredPrivy appId={appId}>{content}</ConfiguredPrivy>;
}
