"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useTranslations, useLocale } from "next-intl";
import {
  Search, Bell, ChevronDown, User, Settings, LogOut,
  TrendingUp, Globe, Shield, ArrowDownToLine, Wallet,
  Loader2, CreditCard, Menu, X,
} from "lucide-react";
import { shortAddr } from "../lib/format";
import { locales, localeNames, localeFlags, type Locale } from "../i18n/config";
import { useAuth } from "../contexts/AuthContext";
import clsx from "clsx";

const ADMIN_SLUG = process.env.NEXT_PUBLIC_ADMIN_SLUG ?? "/admin";

function formatBalance(val: string | undefined): string {
  if (!val) return "0.00";
  const n = parseFloat(val);
  if (isNaN(n)) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Navbar() {
  const t        = useTranslations("nav");
  const locale   = useLocale() as Locale;
  const pathname = usePathname();
  const router   = useRouter();

  const [searchQuery,  setSearchQuery]  = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const {
    login, logout: authLogout, openDepositModal,
    isConnected, genetiaWallet, genetiaWalletLoading, balance,
    userEmail, connectedWalletAddress: address, privyUserId,
  } = useAuth();

  const { user, ready, authenticated } = usePrivy();

  // Admin flag: set via env or database
  const isAdmin = !!process.env.NEXT_PUBLIC_ADMIN_ADDRESS &&
    (address?.toLowerCase() === process.env.NEXT_PUBLIC_ADMIN_ADDRESS?.toLowerCase());

  const adminHref = `/${ADMIN_SLUG}`;

  const displayEmail = userEmail;
  const displayName  = displayEmail
    ? displayEmail.split("@")[0]
    : address ? shortAddr(address) : "User";

  const usdcBalance = balance.available;
  const lockedBalance = balance.locked;

  function switchLocale(next: Locale) {
    setLangMenuOpen(false);
    if (next === locale) return;
    // i18n is cookie-based (no [locale] segment in app routing). Set the
    // cookie and refresh the page so the server re-reads the locale and
    // serves the new translation set.
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    router.refresh();
    // router.refresh() doesn't always re-evaluate getRequestConfig on the
    // same request, so a hard navigation gives the most reliable swap.
    window.location.reload();
  }

  // Cookie-based i18n — there's no /[locale]/... segment, so the active
  // path is just the current pathname.
  const activePath = pathname;

  const navLinks = [
    { href: "/",          key: "markets"   },
    { href: "/portfolio", key: "portfolio" },
    { href: "/wallet",    key: "wallet"    },
    { href: "/about",     key: "howItWorks" },
    ...(isAdmin ? [{ href: adminHref, key: "admin" }] : []),
  ];

  const showAuth = ready;
  const loggedIn = isConnected || authenticated;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface-0/95 backdrop-blur-md">
      <div className="mx-auto max-w-[1400px] flex items-center gap-4 px-4 h-14">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0 mr-2" aria-label="Genetia home">
          <svg viewBox="0 0 200 200" className="h-8 w-8" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="genetiaMark" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#7c5cff" />
                <stop offset="1" stopColor="#22d3ee" />
              </linearGradient>
            </defs>
            <path
              d="M150 60 A55 55 0 1 0 150 140 L150 110 L110 110"
              fill="none" stroke="url(#genetiaMark)" strokeWidth="18"
              strokeLinecap="round" strokeLinejoin="round"
            />
            <path
              d="M58 132 L86 108 L108 124 L150 78"
              fill="none" stroke="url(#genetiaMark)" strokeWidth="10"
              strokeLinecap="round" strokeLinejoin="round" opacity="0.95"
            />
            <circle cx="150" cy="78" r="9" fill="#22d3ee" />
          </svg>
          <span className="font-bold text-base tracking-tight bg-gradient-to-br from-[#7c5cff] to-[#22d3ee] bg-clip-text text-transparent">
            Genetia
          </span>
          <span className="hidden sm:inline-flex items-center rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
            TESTNET
          </span>
        </Link>

        {/* Search — hidden on phones, the hamburger drawer hosts it */}
        <div className="hidden md:block flex-1 max-w-md relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-brand/60 focus:bg-surface-3 transition-all"
          />
        </div>

        {/* spacer so the right cluster hugs the edge on mobile */}
        <div className="md:hidden flex-1" />

        {/* Nav links */}
        <nav className="hidden lg:flex items-center gap-1">
          {navLinks.map(({ href, key }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                activePath === href || (key === "admin" && activePath.startsWith(`/${ADMIN_SLUG}`))
                  ? "bg-surface-3 text-white"
                  : "text-slate-400 hover:text-white hover:bg-surface-2"
              )}
            >
              {key === "admin" && <Shield size={12} className="text-brand-light" />}
              {key === "wallet" && <Wallet size={12} />}
              {t(key as "markets" | "portfolio" | "wallet" | "howItWorks" | "admin")}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {/* Hamburger — replaces the desktop nav row on < lg */}
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="lg:hidden h-9 w-9 flex items-center justify-center rounded-lg border border-border bg-surface-2 text-slate-300 hover:text-white hover:border-border-strong transition-all"
          >
            <Menu size={16} />
          </button>

          {/* Language switcher */}
          <div className="relative">
            <button
              onClick={() => { setLangMenuOpen(!langMenuOpen); setUserMenuOpen(false); }}
              className="h-9 flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-slate-400 hover:text-white hover:border-border-strong transition-all"
            >
              <Globe size={13} />
              <span className="text-[11px] font-semibold tracking-wide">{localeFlags[locale]}</span>
              <ChevronDown size={11} className="text-slate-500" />
            </button>
            {langMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setLangMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 w-40 rounded-xl border border-border bg-surface-2 shadow-2xl shadow-black/50 z-50 animate-fade-in overflow-hidden">
                  {locales.map((loc) => (
                    <button
                      key={loc}
                      onClick={() => switchLocale(loc)}
                      className={clsx(
                        "w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors",
                        loc === locale ? "bg-surface-3 text-white" : "text-slate-300 hover:bg-surface-3 hover:text-white"
                      )}
                    >
                      <span className="text-[10px] font-semibold tracking-wide text-slate-500 w-7">{localeFlags[loc]}</span>
                      <span>{localeNames[loc]}</span>
                      {loc === locale && <span className="ml-auto text-brand-light text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {showAuth && (
            loggedIn ? (
              <>
                {/* Genetia Wallet balance */}
                <div className="hidden sm:flex flex-col items-end leading-none">
                  <span className="text-[10px] text-slate-500">Genetia · Available</span>
                  {genetiaWalletLoading && !genetiaWallet ? (
                    <Loader2 size={12} className="animate-spin text-slate-400 mt-0.5" />
                  ) : (
                    <span className="text-sm font-semibold text-white">
                      ${formatBalance(usdcBalance)}
                    </span>
                  )}
                  {lockedBalance && parseFloat(lockedBalance) > 0 && (
                    <span className="text-[10px] text-yellow-500">
                      ${formatBalance(lockedBalance)} locked
                    </span>
                  )}
                </div>

                {/* Deposit */}
                <button
                  onClick={openDepositModal}
                  className="hidden sm:flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 text-xs font-medium text-slate-400 hover:text-white hover:border-border-strong transition-all"
                >
                  <ArrowDownToLine size={13} />
                  <span className="hidden md:inline">{t("deposit")}</span>
                </button>

                {/* Notifications */}
                <button className="h-9 w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-surface-2 transition-colors">
                  <Bell size={16} />
                </button>

                {/* User menu */}
                <div className="relative">
                  <button
                    onClick={() => { setUserMenuOpen(!userMenuOpen); setLangMenuOpen(false); }}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 hover:border-border-strong hover:bg-surface-3 transition-all"
                  >
                    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-brand to-indigo-400 shrink-0 flex items-center justify-center">
                      {displayEmail && (
                        <span className="text-[9px] text-white font-bold">
                          {displayEmail[0].toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="hidden sm:block text-slate-300 text-xs font-mono">{displayName}</span>
                    <ChevronDown size={12} className="text-slate-500" />
                  </button>

                  {userMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl border border-border bg-surface-2 shadow-2xl shadow-black/50 z-50 animate-fade-in overflow-hidden">
                        {/* Account info */}
                        <div className="px-3 py-3 border-b border-border">
                          {displayEmail && (
                            <p className="text-xs text-slate-300 mb-1 font-medium">{displayEmail}</p>
                          )}
                          {genetiaWallet?.address && (
                            <div className="flex items-center gap-1.5">
                              <CreditCard size={11} className="text-brand-light shrink-0" />
                              <p className="text-[11px] font-mono text-slate-500" title="Genetia Wallet">
                                {genetiaWallet.address.slice(0, 10)}…{genetiaWallet.address.slice(-6)}
                              </p>
                            </div>
                          )}
                          <div className="mt-2 rounded-lg bg-surface-3 px-2.5 py-1.5">
                            <div className="flex justify-between text-[11px]">
                              <span className="text-slate-500">Available</span>
                              <span className="text-white font-semibold">${formatBalance(usdcBalance)}</span>
                            </div>
                            {lockedBalance && parseFloat(lockedBalance) > 0 && (
                              <div className="flex justify-between text-[11px] mt-0.5">
                                <span className="text-slate-500">In bets</span>
                                <span className="text-yellow-400">${formatBalance(lockedBalance)}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <Link href="/portfolio" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-surface-3 hover:text-white transition-colors">
                          <User size={14} /> Portfolio
                        </Link>
                        <Link href="/wallet" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-surface-3 hover:text-white transition-colors">
                          <Wallet size={14} /> Wallet
                        </Link>
                        <button onClick={() => { openDepositModal(); setUserMenuOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-surface-3 hover:text-white transition-colors">
                          <ArrowDownToLine size={14} /> Add Funds
                        </button>
                        {isAdmin && (
                          <Link href={adminHref} onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-brand-light hover:bg-surface-3 hover:text-white transition-colors">
                            <Shield size={14} /> Admin
                          </Link>
                        )}
                        <Link href="/settings" onClick={() => setUserMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 hover:bg-surface-3 hover:text-white transition-colors">
                          <Settings size={14} /> Settings
                        </Link>
                        <div className="border-t border-border my-1" />
                        <button
                          onClick={() => { authLogout(); setUserMenuOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-400 hover:bg-surface-3 transition-colors"
                        >
                          <LogOut size={14} /> Sign out
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <button
                onClick={login}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark transition-colors shadow-lg shadow-brand/20"
              >
                {t("connectWallet")}
              </button>
            )
          )}
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-72 max-w-[85%] bg-surface-1 border-l border-border shadow-2xl flex flex-col animate-fade-in">
            <div className="flex items-center justify-between px-4 h-14 border-b border-border">
              <span className="text-sm font-semibold text-white">Menu</span>
              <button
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close menu"
                className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-surface-2 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Search on mobile */}
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder={t("searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface-2 border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-brand/60 focus:bg-surface-3 transition-all"
                />
              </div>
            </div>

            {/* Nav links */}
            <nav className="flex-1 overflow-y-auto py-2">
              {navLinks.map(({ href, key }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileNavOpen(false)}
                  className={clsx(
                    "flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors",
                    activePath === href || (key === "admin" && activePath.startsWith(`/${ADMIN_SLUG}`))
                      ? "bg-surface-3 text-white border-l-2 border-brand"
                      : "text-slate-400 hover:text-white hover:bg-surface-2"
                  )}
                >
                  {key === "admin"  && <Shield size={14} className="text-brand-light" />}
                  {key === "wallet" && <Wallet size={14} />}
                  {key === "portfolio" && <User size={14} />}
                  {key === "markets" && <TrendingUp size={14} />}
                  {key === "howItWorks" && <Globe size={14} />}
                  {t(key as "markets" | "portfolio" | "wallet" | "howItWorks" | "admin")}
                </Link>
              ))}
            </nav>

            {/* Balance + Deposit at bottom (only when logged in) */}
            {loggedIn && (
              <div className="border-t border-border p-3 space-y-2">
                <div className="rounded-lg bg-surface-2 px-3 py-2.5">
                  <div className="text-[10px] text-slate-500 mb-0.5">Genetia · Available</div>
                  {genetiaWalletLoading && !genetiaWallet ? (
                    <Loader2 size={14} className="animate-spin text-slate-400" />
                  ) : (
                    <div className="text-base font-semibold text-white">${formatBalance(usdcBalance)}</div>
                  )}
                  {lockedBalance && parseFloat(lockedBalance) > 0 && (
                    <div className="text-[11px] text-yellow-500 mt-0.5">${formatBalance(lockedBalance)} locked</div>
                  )}
                </div>
                <button
                  onClick={() => { openDepositModal(); setMobileNavOpen(false); }}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark transition-colors"
                >
                  <ArrowDownToLine size={14} />
                  {t("deposit")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
