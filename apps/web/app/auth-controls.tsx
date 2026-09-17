"use client";

import Link from "next/link";
import { useState } from "react";
import { useLogin, usePrivy, useWallets } from "@privy-io/react-auth";
import { useI18n } from "./i18n";

const BASE_SEPOLIA = "84532";

export default function AuthControls() {
  const { t } = useI18n();
  const { authenticated, logout, user, linkWallet } = usePrivy();
  const { login } = useLogin();
  const { wallets } = useWallets();
  const [open, setOpen] = useState(false);
  const wallet = wallets[0];

  if (!authenticated) return <button onClick={() => login()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-dark">{t("auth.connect")}</button>;

  const address = wallet?.address ?? user?.wallet?.address;
  const chainId = wallet?.chainId?.replace("eip155:", "");
  return <div className="relative">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 transition hover:border-border-strong hover:bg-surface-3 sm:px-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-indigo-400 text-[10px] font-bold text-white">{user?.email?.address?.[0]?.toUpperCase() ?? ""}</span>
      <span className="hidden font-mono text-xs text-slate-300 sm:inline">{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : t("auth.walletPending")}</span>
      <span className="text-xs text-slate-500" aria-hidden="true">⌄</span>
    </button>
    {open && <div className="absolute right-0 top-full z-[70] mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surface-2 p-1.5 shadow-2xl shadow-black/50">
      <div className="border-b border-border px-3 py-2.5"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t("auth.userOwned")}</p><p className="mt-1 break-all font-mono text-xs text-slate-300">{address ?? t("auth.walletPending")}</p><p className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] ${chainId === BASE_SEPOLIA ? "border-emerald-900/80 bg-emerald-950/40 text-emerald-300" : "border-amber-900/80 bg-amber-950/40 text-amber-300"}`}>{chainId === BASE_SEPOLIA ? "Base Sepolia" : t("auth.switchNetwork")}</p></div><button type="button" onClick={() => { linkWallet({ walletChainType: "ethereum-only" }); setOpen(false); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-slate-300 transition hover:bg-surface-3 hover:text-white">Link external wallet</button>
      <Link href="/portfolio" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm text-slate-300 transition hover:bg-surface-3 hover:text-white">{t("nav.portfolio")}</Link>
      <button onClick={() => { void logout(); setOpen(false); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-rose-300 transition hover:bg-surface-3">{t("auth.signOut")}</button>
    </div>}
  </div>;
}
