"use client";

import { X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useTranslations } from "next-intl";

export default function AuthModal() {
  const { login, closeDepositModal } = useAuth();
  const t = useTranslations("auth");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) closeDepositModal(); }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-1 shadow-2xl shadow-black/60 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div>
            <h2 className="font-bold text-white text-base">{t("title")}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t("subtitle")}</p>
          </div>
          <button
            onClick={closeDepositModal}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-surface-3 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-6 py-6">
          <button
            onClick={login}
            className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-dark transition-all shadow-lg shadow-brand/20"
          >
            {t("signInWithPrivy")}
          </button>
        </div>
      </div>
    </div>
  );
}
