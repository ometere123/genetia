"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Settings as SettingsIcon, User, Bell, Monitor, Sun, Moon, Loader2,
  Wallet, Mail, ExternalLink, Copy, Check, LogOut, Shield, ArrowLeft,
  AlertCircle, CheckCircle2,
} from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme, type ThemeMode } from "../../contexts/ThemeContext";
import {
  DEFAULT_PREFERENCES,
  type UserPreferences,
} from "../../lib/user-preferences";

type Tab = "account" | "notifications" | "appearance";

interface NotificationToggleSpec {
  key: keyof UserPreferences["notifications"];
  label: string;
  hint: string;
}

const NOTIFICATION_TOGGLES: NotificationToggleSpec[] = [
  { key: "depositConfirmed",  label: "Deposit confirmed",     hint: "When a deposit lands in your Genetia Wallet." },
  { key: "withdrawalUpdates", label: "Withdrawal updates",    hint: "Status changes on outgoing transfers." },
  { key: "betSettled",        label: "Bet settled",           hint: "When one of your bets resolves with a payout." },
  { key: "marketResolved",    label: "Market resolved",       hint: "When a market you bet on reaches a verdict." },
  { key: "suggestionReview",  label: "Suggestion reviewed",   hint: "When admin approves or rejects a market you suggested." },
  { key: "productUpdates",    label: "Product updates",       hint: "Occasional emails about new Genetia features." },
];

export default function SettingsPage() {
  const {
    authenticated, ready, login, logout, authedFetch,
    userEmail, privyUserId, connectedWalletAddress,
    genetiaWallet,
  } = useAuth();
  const { user, linkEmail, linkWallet, unlinkWallet } = usePrivy();
  const { mode: themeMode, setMode: setThemeMode, resolved: resolvedTheme } = useTheme();

  const [tab, setTab] = useState<Tab>("account");
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load preferences from server when authenticated.
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await authedFetch("/api/me/preferences");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.preferences) setPrefs(data.preferences);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated, authedFetch]);

  async function patch(partial: Partial<UserPreferences> | { notifications: Partial<UserPreferences["notifications"]> }, key: string) {
    setSaving(key);
    setError(null);
    try {
      const res = await authedFetch("/api/me/preferences", {
        method: "PATCH",
        body: JSON.stringify(partial),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save");
        return;
      }
      setPrefs(data.preferences);
      setSavedAt(Date.now());
    } catch {
      setError("Network error");
    } finally {
      setSaving(null);
    }
  }

  const onToggleNotification = useCallback(
    (key: keyof UserPreferences["notifications"]) => {
      const next = !prefs.notifications[key];
      setPrefs((p) => ({
        ...p,
        notifications: { ...p.notifications, [key]: next },
      }));
      patch({ notifications: { [key]: next } }, `notif:${key}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefs]
  );

  const onChangeTheme = useCallback((m: ThemeMode) => {
    setThemeMode(m);                              // local + applies immediately
    patch({ theme: m }, "theme");                 // sync to server
  }, [setThemeMode]);

  async function copyAddress(addr: string) {
    await navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-md py-24 px-4 text-center text-sm text-slate-500">
        <Loader2 className="animate-spin mx-auto mb-3" />
        Loading…
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="mx-auto max-w-md py-24 px-4 text-center">
        <div className="h-16 w-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center mx-auto mb-4">
          <SettingsIcon size={28} className="text-slate-500" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Settings</h2>
        <p className="text-sm text-slate-500 mb-6">
          Sign in to manage your account, notifications and theme.
        </p>
        <button
          onClick={login}
          className="rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-dark transition-all shadow-lg shadow-brand/20"
        >
          Sign in
        </button>
      </div>
    );
  }

  const linkedAccounts = (user?.linkedAccounts ?? []) as Array<{ type: string; address?: string; email?: string }>;
  const linkedWalletAccounts = linkedAccounts.filter((a) => a.type === "wallet");
  const linkedEmail = linkedAccounts.find((a) => a.type === "email") ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <SettingsIcon size={14} className="text-brand-light" />
            <span className="text-xs font-semibold text-brand-light uppercase tracking-wider">Settings</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Your account</h1>
          <p className="text-sm text-slate-500 mt-1">Manage how Genetia works for you.</p>
        </div>
        <Link
          href="/"
          className="hidden sm:flex items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs text-slate-400 hover:text-white hover:border-border-strong transition-all"
        >
          <ArrowLeft size={12} />
          Back
        </Link>
      </div>

      {/* Save status banner */}
      {(saving || savedAt || error) && (
        <div
          className={clsx(
            "flex items-center gap-2 rounded-xl px-3 py-2 text-xs",
            error ? "bg-red-500/10 border border-red-500/20 text-red-300"
                  : saving ? "bg-surface-2 border border-border text-slate-400"
                           : "bg-yes/10 border border-yes/30 text-yes"
          )}
        >
          {error ? (
            <>
              <AlertCircle size={13} /> {error}
            </>
          ) : saving ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Saving…
            </>
          ) : (
            <>
              <CheckCircle2 size={13} /> Saved
            </>
          )}
        </div>
      )}

      {/* Tab bar */}
      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        <div className="flex border-b border-border">
          {([
            { id: "account",       label: "Account",       Icon: User    },
            { id: "notifications", label: "Notifications", Icon: Bell    },
            { id: "appearance",    label: "Appearance",    Icon: Monitor },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id as Tab)}
              className={clsx(
                "flex-1 flex items-center justify-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                tab === id
                  ? "border-brand text-brand-light"
                  : "border-transparent text-slate-500 hover:text-white"
              )}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === "account" && (
            <div className="space-y-5">
              {/* Identity card */}
              <Section title="Identity" hint="How Privy knows you. Not the betting wallet.">
                <Row icon={<Mail size={13} />} label="Email">
                  <span className="text-sm text-slate-200">{userEmail ?? "—"}</span>
                  {!linkedEmail && (
                    <button
                      onClick={() => linkEmail()}
                      className="text-[11px] text-brand-light hover:text-brand transition-colors"
                    >
                      Add
                    </button>
                  )}
                </Row>
                <Row icon={<Wallet size={13} />} label="Privy user ID">
                  <code className="text-[11px] font-mono text-slate-500 break-all">{privyUserId}</code>
                </Row>
              </Section>

              {/* Genetia Wallet */}
              <Section title="Genetia Wallet" hint="Your app wallet — deposits, balances, bets, winnings, withdrawals.">
                {genetiaWallet ? (
                  <>
                    <Row icon={<Wallet size={13} className="text-brand-light" />} label="Address">
                      <code className="text-[11px] font-mono text-slate-300 flex-1 truncate">{genetiaWallet.address}</code>
                      <button
                        onClick={() => copyAddress(genetiaWallet.address)}
                        className={clsx(
                          "shrink-0 h-7 w-7 flex items-center justify-center rounded-md transition-colors",
                          copied ? "bg-yes/20 text-yes" : "bg-surface-3 text-slate-400 hover:text-white"
                        )}
                      >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </Row>
                    <Row label="Network">
                      <span className="text-xs text-slate-200">{genetiaWallet.blockchain} · {genetiaWallet.accountType}</span>
                    </Row>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Genetia Wallet is being provisioned…</p>
                )}
              </Section>

              {/* Connected wallets */}
              <Section
                title="Connected wallets"
                hint="External wallets used for login, funding and withdrawal destinations."
              >
                {connectedWalletAddress && (
                  <Row icon={<Wallet size={13} />} label="Primary">
                    <code className="text-[11px] font-mono text-slate-300 flex-1 truncate">{connectedWalletAddress}</code>
                    <span className="text-[10px] text-slate-600">login</span>
                  </Row>
                )}
                {linkedWalletAccounts.map((w) => (
                  <Row key={w.address} label="">
                    <code className="text-[11px] font-mono text-slate-400 flex-1 truncate">{w.address}</code>
                    {w.address && w.address !== connectedWalletAddress && (
                      <button
                        onClick={() => unlinkWallet(w.address as string)}
                        className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                      >
                        Unlink
                      </button>
                    )}
                  </Row>
                ))}
                <button
                  onClick={() => linkWallet()}
                  className="w-full mt-1 rounded-lg border border-dashed border-border bg-surface-2/50 py-2 text-xs text-slate-400 hover:text-white hover:bg-surface-2 transition-colors"
                >
                  + Connect another wallet
                </button>
              </Section>

              {/* Sign out */}
              <Section title="Session">
                <button
                  onClick={logout}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300 hover:bg-red-500/15 transition-colors"
                >
                  <LogOut size={13} />
                  Sign out
                </button>
              </Section>
            </div>
          )}

          {tab === "notifications" && (
            <div className="space-y-5">
              <p className="text-xs text-slate-500 leading-relaxed">
                Choose which events trigger a notification. We don&apos;t send marketing or third-party email — only the toggles below.
              </p>

              {loading ? (
                <div className="flex items-center justify-center py-8 gap-2 text-slate-500 text-sm">
                  <Loader2 size={14} className="animate-spin" /> Loading preferences…
                </div>
              ) : (
                <div className="rounded-xl border border-border divide-y divide-border bg-surface-2 overflow-hidden">
                  {NOTIFICATION_TOGGLES.map(({ key, label, hint }) => (
                    <ToggleRow
                      key={key}
                      label={label}
                      hint={hint}
                      checked={prefs.notifications[key]}
                      saving={saving === `notif:${key}`}
                      onChange={() => onToggleNotification(key)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "appearance" && (
            <div className="space-y-5">
              <Section title="Theme" hint="How the app looks. System follows your OS preference.">
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { id: "dark",   label: "Dark",   Icon: Moon    },
                    { id: "light",  label: "Light",  Icon: Sun     },
                    { id: "system", label: "System", Icon: Monitor },
                  ] as const).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      onClick={() => onChangeTheme(id as ThemeMode)}
                      className={clsx(
                        "flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-all",
                        themeMode === id
                          ? "border-brand bg-brand/10 text-brand-light shadow-lg shadow-brand/10"
                          : "border-border bg-surface-2 text-slate-400 hover:border-border-strong hover:text-white"
                      )}
                    >
                      <Icon size={16} />
                      {label}
                      {themeMode === id && saving === "theme" && (
                        <Loader2 size={10} className="animate-spin" />
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-600 mt-3">
                  Active theme: <span className="text-slate-400">{resolvedTheme}</span>
                </p>
              </Section>
            </div>
          )}
        </div>
      </div>

      {/* Helpful links */}
      <div className="rounded-2xl border border-border bg-surface-1 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Shield size={13} className="text-slate-500" />
          <span className="text-xs font-semibold text-slate-300">Help & Legal</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { label: "How it works", href: "/about" },
            { label: "Wallet",       href: "/wallet" },
            { label: "Portfolio",    href: "/portfolio" },
          ].map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              className="flex items-center justify-between rounded-lg bg-surface-2 border border-border px-3 py-2 text-xs text-slate-300 hover:bg-surface-3 transition-colors"
            >
              {label} <ExternalLink size={11} className="text-slate-500" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2">
        <h3 className="text-xs font-semibold text-slate-300">{title}</h3>
        {hint && <p className="text-[11px] text-slate-600 mt-0.5">{hint}</p>}
      </div>
      <div className="rounded-xl border border-border divide-y divide-border bg-surface-2 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function Row({
  icon, label, children,
}: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      {icon && <span className="text-slate-500">{icon}</span>}
      {label && <span className="text-[11px] text-slate-500 w-24 shrink-0">{label}</span>}
      <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">{children}</div>
    </div>
  );
}

function ToggleRow({
  label, hint, checked, saving, onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  saving: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-100">{label}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>
      </div>
      <button
        type="button"
        onClick={onChange}
        disabled={saving}
        aria-pressed={checked}
        className={clsx(
          "shrink-0 mt-0.5 relative inline-flex h-5 w-9 rounded-full transition-colors",
          checked ? "bg-brand" : "bg-surface-4",
          saving && "opacity-60 cursor-wait"
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}
