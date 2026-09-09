"use client";
import dynamic from "next/dynamic";

const ConfiguredPrivy = dynamic(() => import("./privy-provider"), { ssr: false });

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <>{children}</>;
  return <ConfiguredPrivy appId={appId}>{children}</ConfiguredPrivy>;
}
