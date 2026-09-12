"use client";

import { useCallback, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

/* ── Withdraw from Genetia (Circle SCA) Wallet ──────────────────────────── */

export interface UseWithdrawResult {
  withdraw: (destination: string, amount: string) => Promise<void>;
  isPending: boolean;
  error: string | null;
  success: boolean;
  reset: () => void;
}

export function useWithdraw(): UseWithdrawResult {
  const { authenticated, authedFetch, refreshGenetiaWallet } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const reset = useCallback(() => {
    setError(null);
    setSuccess(false);
  }, []);

  const withdraw = useCallback(
    async (destinationAddress: string, amount: string) => {
      if (!authenticated) {
        setError("Not authenticated");
        return;
      }
      setIsPending(true);
      setError(null);
      setSuccess(false);

      try {
        const res = await authedFetch("/api/wallets/withdraw", {
          method: "POST",
          body: JSON.stringify({ destinationAddress, amount }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Withdrawal failed");
          return;
        }
        setSuccess(true);
        await refreshGenetiaWallet();
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setIsPending(false);
      }
    },
    [authenticated, authedFetch, refreshGenetiaWallet]
  );

  return { withdraw, isPending, error, success, reset };
}

/* ── Place an LMSR buy ──────────────────────────────────────────────────── */
// Submits Market.buy(outcome, shares, maxCost) via Circle. Returns the
// Circle transaction id so callers can show "pending" state until the
// indexer mirrors the on-chain event.

export interface UsePlaceBetResult {
  placeBet: (
    marketId: string,
    side: "YES" | "NO",
    shares: string,
    maxCost: string
  ) => Promise<{ circleTxId: string } | null>;
  isPending: boolean;
  error: string | null;
  reset: () => void;
}

export function usePlaceBet(): UsePlaceBetResult {
  const { authenticated, authedFetch, refreshGenetiaWallet } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => setError(null), []);

  const placeBet = useCallback(
    async (marketId: string, side: "YES" | "NO", shares: string, maxCost: string) => {
      if (!authenticated) {
        setError("Not authenticated");
        return null;
      }
      setIsPending(true);
      setError(null);

      try {
        const res = await authedFetch("/api/bets/place", {
          method: "POST",
          body: JSON.stringify({ marketId, side, shares, maxCost }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to place bet");
          return null;
        }
        await refreshGenetiaWallet();
        return { circleTxId: data.circleTxId };
      } catch {
        setError("Network error. Please try again.");
        return null;
      } finally {
        setIsPending(false);
      }
    },
    [authenticated, authedFetch, refreshGenetiaWallet]
  );

  return { placeBet, isPending, error, reset };
}

/* ── Sell an LMSR position (cash out) ──────────────────────────────────── */

export interface UseExitBetResult {
  exitBet: (
    marketId: string,
    side: "YES" | "NO",
    shares: string,
    minReturn: string
  ) => Promise<{ circleTxId: string } | null>;
  isPending: boolean;
  error: string | null;
  reset: () => void;
}

export function useExitBet(): UseExitBetResult {
  const { authenticated, authedFetch, refreshGenetiaWallet } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => setError(null), []);

  const exitBet = useCallback(
    async (marketId: string, side: "YES" | "NO", shares: string, minReturn: string) => {
      if (!authenticated) {
        setError("Not authenticated");
        return null;
      }
      setIsPending(true);
      setError(null);

      try {
        const res = await authedFetch("/api/bets/exit", {
          method: "POST",
          body: JSON.stringify({ marketId, side, shares, minReturn }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to sell");
          return null;
        }
        await refreshGenetiaWallet();
        return { circleTxId: data.circleTxId };
      } catch {
        setError("Network error. Please try again.");
        return null;
      } finally {
        setIsPending(false);
      }
    },
    [authenticated, authedFetch, refreshGenetiaWallet]
  );

  return { exitBet, isPending, error, reset };
}

/* ── Redeem outcome tokens after a market resolves ─────────────────────── */

export interface UseClaimResult {
  claim: (marketId: string) => Promise<{
    circleTxId: string;
    yesRedeemed: string;
    noRedeemed: string;
  } | null>;
  isPending: boolean;
  error: string | null;
  reset: () => void;
}

export function useClaim(): UseClaimResult {
  const { authenticated, authedFetch, refreshGenetiaWallet } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => setError(null), []);

  const claim = useCallback(
    async (marketId: string) => {
      if (!authenticated) {
        setError("Not authenticated");
        return null;
      }
      setIsPending(true);
      setError(null);

      try {
        const res = await authedFetch("/api/bets/claim", {
          method: "POST",
          body: JSON.stringify({ marketId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Claim failed");
          return null;
        }
        await refreshGenetiaWallet();
        return {
          circleTxId: data.circleTxId,
          yesRedeemed: data.yesRedeemed,
          noRedeemed: data.noRedeemed,
        };
      } catch {
        setError("Network error. Please try again.");
        return null;
      } finally {
        setIsPending(false);
      }
    },
    [authenticated, authedFetch, refreshGenetiaWallet]
  );

  return { claim, isPending, error, reset };
}
