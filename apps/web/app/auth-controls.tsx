"use client";

import { useLogin, usePrivy, useWallets } from "@privy-io/react-auth";

const BASE_SEPOLIA = "84532";

export default function AuthControls() {
  const { authenticated, logout, user } = usePrivy();
  const { login } = useLogin();
  const { wallets } = useWallets();
  const wallet = wallets[0];

  if (!authenticated) return <button onClick={() => login()} className="rounded-lg border border-cyan-400 px-4 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-400/10">Connect / log in</button>;

  const address = wallet?.address ?? user?.wallet?.address;
  const chainId = wallet?.chainId?.replace("eip155:", "");
  return <div className="flex items-center gap-3 text-sm"><span className={chainId === BASE_SEPOLIA ? "text-emerald-300" : "text-amber-300"}>{chainId === BASE_SEPOLIA ? "Base Sepolia" : "Switch to Base Sepolia"}</span><span className="max-w-32 truncate text-slate-400">{address ?? "Wallet pending"}</span><button onClick={() => logout()} className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-slate-500">Log out</button></div>;
}
