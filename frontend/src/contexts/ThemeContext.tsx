"use client";

import {
  createContext, useContext, useEffect, useState, type ReactNode,
} from "react";

/**
 * Theme support — dark / light / system.
 *
 * The active theme is applied as a `dark` class on <html> (Tailwind's dark
 * mode). `system` follows the OS preference live via matchMedia.
 *
 * Persistence: localStorage. We don't sync to the DB here — preferences
 * sync still lives in /api/me/preferences and runs from Settings — but
 * the local copy means the right theme is applied before any auth roundtrip.
 */

export type ThemeMode = "dark" | "light" | "system";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: "dark" | "light";
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "genetia.theme";

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light" || stored === "system") return stored;
  return "dark";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(resolved: "dark" | "light") {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.classList.toggle("light", resolved === "light");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [resolved, setResolved] = useState<"dark" | "light">("dark");

  // Initial read (client-side only).
  useEffect(() => {
    const initial = readStoredMode();
    setModeState(initial);
  }, []);

  // Recompute and apply whenever mode changes (or the OS pref does, if "system").
  useEffect(() => {
    function compute() {
      const isDark = mode === "dark" || (mode === "system" && systemPrefersDark());
      setResolved(isDark ? "dark" : "light");
      applyTheme(isDark ? "dark" : "light");
    }
    compute();

    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", compute);
    return () => mq.removeEventListener("change", compute);
  }, [mode]);

  function setMode(next: ThemeMode) {
    setModeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
