"use client";

import { useState } from "react";
import {
  X, Copy, Check, ExternalLink, AlertTriangle, CreditCard, Loader2,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";

export default function DepositModal() {
  const { genetiaWallet, genetiaWalletLoading, balance, closeDepositModal } = useAuth();
  const t = useTranslations("deposit");
  const [copied, setCopied] = useState(false);

  const walletAddress = genetiaWallet?.address;

  async function handleCopy() {
    if (!walletAddress) return;
    await navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) closeDepositModal(); }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-1 shadow-2xl shadow-black/60 animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <CreditCard size={14} className="text-brand-light" />
              <h2 className="font-bold text-white text-base">{t("depositTitle")}</h2>
            </div>
            <p className="text-xs text-slate-500">{t("depositSubtitle")}</p>
          </div>
          <button
            onClick={closeDepositModal}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-surface-3 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-6 space-y-5">
          {genetiaWalletLoading && !walletAddress ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <Loader2 size={24} className="animate-spin text-brand-light" />
              <p className="text-sm text-slate-400">{t("provisioning")}</p>
            </div>
          ) : !walletAddress ? (
            <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 p-4 text-center">
              <AlertTriangle size={20} className="text-yellow-400 mx-auto mb-2" />
              <p className="text-sm text-yellow-300">{t("notProvisioned")}</p>
            </div>
          ) : (
            <>
              {/* QR code */}
              <div className="flex justify-center">
                <div className="rounded-2xl bg-white p-4 shadow-lg">
                  <QRCodeSVG
                    value={walletAddress}
                    size={160}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                </div>
              </div>

              {/* Network info */}
              <div className="rounded-xl bg-surface-2 border border-border divide-y divide-border overflow-hidden">
                {[
                  { label: t("walletType"), value: `Circle ${genetiaWallet.accountType}` },
                  { label: t("networkLabel"), value: genetiaWallet.blockchain },
                  { label: t("tokenLabel"), value: "USDC (6 decimals)" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="text-xs text-slate-500">{label}</span>
                    <span className="text-xs font-medium text-slate-200">{value}</span>
                  </div>
                ))}
              </div>

              {/* Address */}
              <div>
                <p className="text-xs font-medium text-slate-400 mb-2">{t("yourAddress")}</p>
                <div className="flex items-center gap-2 rounded-xl bg-surface-2 border border-border px-3.5 py-3">
                  <code className="flex-1 text-[11px] text-slate-300 font-mono break-all leading-relaxed">
                    {walletAddress}
                  </code>
                  <button
                    onClick={handleCopy}
                    className={`shrink-0 h-8 w-8 flex items-center justify-center rounded-lg transition-all ${
                      copied
                        ? "bg-yes/20 text-yes"
                        : "bg-surface-3 text-slate-400 hover:text-white hover:bg-surface-4"
                    }`}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              {/* Balance */}
              <div className="rounded-xl bg-surface-2 border border-border divide-y divide-border overflow-hidden">
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-xs text-slate-500">{t("availableBalance")}</span>
                  <span className="text-xs font-semibold text-white">
                    ${parseFloat(balance.available).toFixed(2)} USDC
                  </span>
                </div>
                {parseFloat(balance.locked) > 0 && (
                  <div className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="text-xs text-slate-500">{t("lockedInBets")}</span>
                    <span className="text-xs font-semibold text-yellow-400">
                      ${parseFloat(balance.locked).toFixed(2)} USDC
                    </span>
                  </div>
                )}
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/20 px-3.5 py-3">
                <AlertTriangle size={13} className="text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-yellow-300/80 leading-relaxed">
                  Only send <strong>USDC on {genetiaWallet.blockchain}</strong> to this address.
                  Funds sent on other networks will be unrecoverable.
                </p>
              </div>

              {/* Faucet */}
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full rounded-xl border border-brand/30 bg-brand/5 py-3 text-sm font-medium text-brand-light hover:bg-brand/10 hover:border-brand/50 transition-all"
              >
                {t("faucet")}
                <ExternalLink size={13} />
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
