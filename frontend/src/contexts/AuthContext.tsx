"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useAccount, useDisconnect } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";

/**
 * Genetia Wallet — the user's Circle Developer-Controlled SCA wallet.
 * This is the ONLY wallet used for deposits, balances, bets, settlement,
 * winnings, and withdrawals.
 */
export interface GenetiaWallet {
  provider: "circle";
  circleWalletId: string;
  address: string;
  blockchain: string;
  accountType: string;
}

interface AuthContextValue {
  // Identity (from Privy)
  privyUserId: string | undefined;
  userEmail: string | undefined;
  isConnected: boolean;
  ready: boolean;
  authenticated: boolean;

  // Connected external wallet (auth/funding/withdrawal only — never the betting wallet)
  connectedWalletAddress: `0x${string}` | undefined;

  // Privy controls
  login: () => void;
  logout: () => Promise<void>;

  // Genetia Wallet (Circle SCA) — the actual app wallet
  genetiaWallet: GenetiaWallet | null;
  genetiaWalletLoading: boolean;
  balance: { available: string; locked: string; pending: string; onChainUsdc?: string };
  refreshGenetiaWallet: () => Promise<void>;

  // Bearer-authed fetch helper for the rest of the app
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  // Deposit modal
  showDepositModal: boolean;
  openDepositModal: () => void;
  closeDepositModal: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { login, logout: privyLogout, ready, authenticated, user, getAccessToken } = usePrivy();

  const [showDepositModal, setShowDepositModal] = useState(false);
  const [genetiaWallet, setGenetiaWallet] = useState<GenetiaWallet | null>(null);
  const [genetiaWalletLoading, setGenetiaWalletLoading] = useState(false);
  const [balance, setBalance] = useState<AuthContextValue["balance"]>({
    available: "0",
    locked: "0",
    pending: "0",
  });

  const privyUserId = user?.id;
  const userEmail = user?.email?.address ?? user?.google?.email;

  // Authed fetch — automatically attaches the Privy access token.
  const authedFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const token = await getAccessToken();
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (!headers.has("Content-Type") && init.body) {
        headers.set("Content-Type", "application/json");
      }
      return fetch(input, { ...init, headers });
    },
    [getAccessToken]
  );

  const refreshGenetiaWallet = useCallback(async () => {
    if (!authenticated || !privyUserId) return;
    try {
      const res = await authedFetch("/api/wallets/balance");
      if (!res.ok) return;
      const data = await res.json();
      if (data?.genetiaWallet) setGenetiaWallet(data.genetiaWallet);
      if (data?.balance) setBalance(data.balance);
    } catch {
      // non-fatal
    }
  }, [authedFetch, authenticated, privyUserId]);

  // After Privy login: sync the user + provision Circle wallet, then load balance.
  useEffect(() => {
    if (!ready || !authenticated || !privyUserId) return;

    let cancelled = false;
    async function sync() {
      setGenetiaWalletLoading(true);
      try {
        const res = await authedFetch("/api/auth/sync-user", { method: "POST" });
        if (!res.ok) {
          console.error("[AuthContext] sync-user failed", await res.text());
          return;
        }
        const data = await res.json();
        if (!cancelled && data?.genetiaWallet) {
          setGenetiaWallet(data.genetiaWallet);
        }
        await refreshGenetiaWallet();
      } catch (err) {
        console.error("[AuthContext] sync error", err);
      } finally {
        if (!cancelled) setGenetiaWalletLoading(false);
      }
    }
    sync();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, privyUserId, authedFetch, refreshGenetiaWallet]);

  // Poll balance while logged in. 90s is enough for deposit detection without
  // hammering the Privy verify endpoint behind every request.
  useEffect(() => {
    if (!authenticated || !privyUserId) {
      setGenetiaWallet(null);
      setBalance({ available: "0", locked: "0", pending: "0" });
      return;
    }
    const interval = setInterval(refreshGenetiaWallet, 90_000);
    return () => clearInterval(interval);
  }, [authenticated, privyUserId, refreshGenetiaWallet]);

  const logout = useCallback(async () => {
    disconnect();
    if (ready) await privyLogout();
    setGenetiaWallet(null);
    setBalance({ available: "0", locked: "0", pending: "0" });
  }, [disconnect, privyLogout, ready]);

  return (
    <AuthContext.Provider
      value={{
        privyUserId,
        userEmail,
        isConnected: isConnected || authenticated,
        ready,
        authenticated,
        connectedWalletAddress: address,
        login,
        logout,
        genetiaWallet,
        genetiaWalletLoading,
        balance,
        refreshGenetiaWallet,
        authedFetch,
        showDepositModal,
        openDepositModal: () => setShowDepositModal(true),
        closeDepositModal: () => setShowDepositModal(false),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
