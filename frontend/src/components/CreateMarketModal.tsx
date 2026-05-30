"use client";

import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { CATEGORIES, type Category } from "../lib/format";
import { categoryMeta } from "../lib/category-icons";
import { X, Plus, Minus, Info, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import clsx from "clsx";

interface CreateMarketModalProps {
  onClose: () => void;
}

const STEP_LABELS = ["Market details", "Resolution", "Review"];

/**
 * Public-facing "Suggest a market" flow.
 *
 * No on-chain transactions, no wagmi, no wallet popups. The form POSTs
 * to /api/markets/suggest with the user's Privy bearer token. The
 * resulting `MarketSuggestion` row sits in the admin review queue until
 * an admin approves or rejects it.
 *
 * Admins should create real markets directly via the admin dashboard.
 */
export default function CreateMarketModal({ onClose }: CreateMarketModalProps) {
  const { authedFetch, authenticated, login } = useAuth();

  const [step, setStep]               = useState(0);
  const [question, setQuestion]       = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory]       = useState<Category>("crypto");
  const [criteria, setCriteria]       = useState("");
  const [sources, setSources]         = useState<string[]>(["", ""]);
  const [endDateStr, setEndDateStr]   = useState("");

  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState(false);

  function addSource()              { if (sources.length < 5) setSources([...sources, ""]); }
  function removeSource(i: number)  { setSources(sources.filter((_, idx) => idx !== i)); }
  function updateSource(i: number, v: string) {
    const copy = [...sources];
    copy[i] = v;
    setSources(copy);
  }

  async function handleSubmit() {
    if (!authenticated) {
      setError("Please sign in first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const trimmedSources = sources.map((s) => s.trim()).filter(Boolean);
      const res = await authedFetch("/api/markets/suggest", {
        method: "POST",
        body: JSON.stringify({
          question: question.trim(),
          description: description.trim() || undefined,
          category,
          expiry: new Date(endDateStr).toISOString(),
          criteria: criteria.trim(),
          sources: trimmedSources,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to submit suggestion");
        return;
      }
      setSuccess(true);
      setTimeout(onClose, 2200);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const canNext0 =
    question.trim().length >= 10 &&
    endDateStr &&
    new Date(endDateStr).getTime() > Date.now() + 60 * 60 * 1000;
  const canNext1 =
    criteria.trim().length >= 20 &&
    sources.map((s) => s.trim()).filter(Boolean).length >= 1;

  const CatIcon = categoryMeta(category).Icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface-1 shadow-2xl shadow-black/60 animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-bold text-white">Suggest a market</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Step {step + 1} of {STEP_LABELS.length} â€” {STEP_LABELS[step]}
            </p>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-surface-3 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1.5 px-6 pt-4">
          {STEP_LABELS.map((_, i) => (
            <div key={i} className={clsx("h-1 flex-1 rounded-full transition-all", i <= step ? "bg-brand" : "bg-surface-4")} />
          ))}
        </div>

        <div className="px-6 py-5 space-y-4">
          {!authenticated && (
            <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 p-3 flex items-start gap-2.5">
              <AlertCircle size={13} className="text-yellow-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-[11px] text-yellow-300/90 leading-relaxed">
                  You need to be signed in to suggest a market.
                </p>
                <button onClick={login} className="text-[11px] text-brand-light hover:text-brand transition-colors font-medium mt-1">
                  Sign in â†’
                </button>
              </div>
            </div>
          )}

          {/* Step 0 â€” Market details */}
          {step === 0 && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Market question <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Will ETH exceed $10,000 before the end of 2026?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={500}
                  className="w-full rounded-xl bg-surface-2 border border-border px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-brand/50 focus:outline-none resize-none transition-colors"
                />
                <p className="text-[11px] text-slate-600 mt-1">{question.length}/500 characters</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Description <span className="text-slate-600">(optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Short context for users browsing the markets listâ€¦"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  className="w-full rounded-xl bg-surface-2 border border-border px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-brand/50 focus:outline-none resize-none transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Category</label>
                  <div className="relative">
                    <CatIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as Category)}
                      className="w-full rounded-xl bg-surface-2 border border-border pl-9 pr-3 py-2.5 text-sm text-white focus:border-brand/50 focus:outline-none transition-colors appearance-none"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Resolution date <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={endDateStr}
                    onChange={(e) => setEndDateStr(e.target.value)}
                    min={new Date(Date.now() + 3_600_000).toISOString().slice(0, 16)}
                    className="w-full rounded-xl bg-surface-2 border border-border px-3.5 py-2.5 text-sm text-white focus:border-brand/50 focus:outline-none transition-colors"
                  />
                </div>
              </div>
            </>
          )}

          {/* Step 1 â€” Resolution */}
          {step === 1 && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Resolution criteria <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Resolves YES if ETH spot price exceeds $10,000 USD on at least one of Coinbase, Binance, or Kraken at any point before 2026-12-31 00:00 UTC. Resolves NO otherwise."
                  value={criteria}
                  onChange={(e) => setCriteria(e.target.value)}
                  maxLength={2000}
                  className="w-full rounded-xl bg-surface-2 border border-border px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-brand/50 focus:outline-none resize-none transition-colors"
                />
                <p className="text-[11px] text-slate-600 mt-1">{criteria.length}/2000 â€” be specific about dates, thresholds, and tie-breakers</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-400">
                    Data sources <span className="text-slate-600">(GenLayer will fetch these)</span>
                  </label>
                  {sources.length < 5 && (
                    <button onClick={addSource} className="flex items-center gap-1 text-[11px] text-brand-light hover:text-brand transition-colors">
                      <Plus size={11} /> Add source
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {sources.map((url, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="url"
                        placeholder="https://coinmarketcap.com/currencies/ethereum/"
                        value={url}
                        onChange={(e) => updateSource(i, e.target.value)}
                        className="flex-1 rounded-xl bg-surface-2 border border-border px-3.5 py-2 text-xs text-white placeholder:text-slate-600 font-mono focus:border-brand/50 focus:outline-none transition-colors"
                      />
                      {sources.length > 1 && (
                        <button onClick={() => removeSource(i)} className="h-9 w-9 flex items-center justify-center rounded-xl bg-surface-2 border border-border text-slate-500 hover:text-red-400 transition-colors shrink-0">
                          <Minus size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-brand/5 border border-brand/20 p-3">
                <Info size={13} className="text-brand-light shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  GenLayer validators will fetch these URLs and use an LLM to determine the outcome. Be specific about dates, thresholds, and authoritative sources.
                </p>
              </div>
            </>
          )}

          {/* Step 2 â€” Review */}
          {step === 2 && (
            <div className="space-y-3">
              {[
                { label: "Question", value: question },
                { label: "Category", value: category.charAt(0).toUpperCase() + category.slice(1) },
                { label: "Closes",   value: endDateStr ? new Date(endDateStr).toLocaleString() : "â€”" },
                { label: "Criteria", value: criteria || "â€”" },
                { label: "Sources",  value: sources.filter(Boolean).join("\n") || "None" },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-4">
                  <span className="text-xs text-slate-500 w-20 shrink-0 pt-0.5">{label}</span>
                  <span className="text-xs text-slate-200 flex-1 leading-relaxed whitespace-pre-line">{value}</span>
                </div>
              ))}

              <div className="flex items-start gap-2 rounded-xl bg-brand/5 border border-brand/20 p-3">
                <Info size={13} className="text-brand-light shrink-0 mt-0.5" />
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Your suggestion will be added to the admin review queue. If approved, it will go live as a real market and you&apos;ll be notified.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2.5">
                  <AlertCircle size={13} className="text-red-400 shrink-0" />
                  <p className="text-xs text-red-300">{error}</p>
                </div>
              )}

              {success && (
                <div className="rounded-xl bg-yes/10 border border-yes/30 p-3 text-center flex items-center justify-center gap-2">
                  <CheckCircle2 size={16} className="text-yes" />
                  <p className="text-sm font-semibold text-yes">Suggestion submitted! An admin will review it shortly.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={step === 0 ? onClose : () => setStep(step - 1)}
            className="flex-1 rounded-xl border border-border py-2.5 text-sm text-slate-300 hover:border-border-strong hover:bg-surface-2 transition-all"
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>

          {step < 2 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 0 ? !canNext0 : !canNext1}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-brand/20"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting || success || !authenticated}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-brand/20 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 size={13} className="animate-spin" />}
              {submitting ? "Submittingâ€¦" : success ? "Submitted!" : "Submit Suggestion"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
