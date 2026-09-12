/** Legacy: format a 6-decimal bigint USDC amount with US-style grouping. */
export function formatUsdc(raw: bigint, decimals = 6): string {
  const n = Number(raw) / 10 ** decimals;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatProb(bps: bigint): string {
  return (Number(bps) / 100).toFixed(1) + "%";
}

export function timeUntil(unix: bigint): string {
  const ms = Number(unix) * 1000 - Date.now();
  if (ms <= 0) return "Ended";
  const days = Math.floor(ms / 86_400_000);
  const hrs  = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 1) return `${days}d left`;
  if (days === 1) return `1d ${hrs}h left`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hrs > 0) return `${hrs}h ${mins}m left`;
  return `${mins}m left`;
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export const CATEGORIES = ["crypto", "politics", "sports", "science", "entertainment"] as const;
export type Category = (typeof CATEGORIES)[number];

// ── Locale-aware formatting (Intl) ─────────────────────────────────────────
//
// Below are the locale-aware versions. Prefer these over the legacy
// helpers above when rendering for users; pass a locale string from
// `useLocale()` (next-intl) at the call site.

/**
 * Format a value as USD currency for the given locale.
 * - `en-US` → "$1,234.56"
 * - `es-ES` → "1234,56 $"  (Spain uses comma decimal)
 * - `fr-FR` → "1 234,56 $US"
 * - `pt-BR` → "US$ 1.234,56"
 *
 * Default locale is "en" if unspecified (matches our default app locale).
 */
export function formatUsdcLocale(
  value: number | string | bigint | undefined,
  opts: { decimals?: number; signed?: boolean; locale?: string } = {}
): string {
  const { decimals = 2, signed = false, locale = "en" } = opts;
  if (value == null) return formatUsdcLocale(0, opts);
  const n = typeof value === "string"
    ? parseFloat(value)
    : typeof value === "bigint"
      ? Number(value) / 1_000_000
      : value;
  if (!Number.isFinite(n)) return formatUsdcLocale(0, opts);
  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Math.abs(n));
    if (signed && n !== 0) return (n > 0 ? "+" : "−") + formatted;
    return n < 0 ? "−" + formatted : formatted;
  } catch {
    return `$${n.toFixed(decimals)}`;
  }
}

/** Format a 0..1 ratio as a locale-aware percentage. */
export function formatPercentLocale(
  value: number,
  opts: { decimals?: number; locale?: string } = {}
): string {
  const { decimals = 1, locale = "en" } = opts;
  if (!Number.isFinite(value)) return "0%";
  try {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${(value * 100).toFixed(decimals)}%`;
  }
}

/** Format a date for the given locale. */
export function formatDateLocale(
  date: Date | string | number | undefined,
  opts: { style?: "short" | "medium" | "long" | "relative"; locale?: string } = {}
): string {
  if (date == null) return "";
  const { style = "medium", locale = "en" } = opts;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";

  if (style === "relative") {
    const diff = (d.getTime() - Date.now()) / 1000;
    try {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      const abs = Math.abs(diff);
      if (abs < 60) return rtf.format(Math.round(diff), "second");
      if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
      return rtf.format(Math.round(diff / 86400), "day");
    } catch {
      // fall through to dateStyle
    }
  }

  const dateStyle = style === "short" ? "short" : style === "long" ? "long" : "medium";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle }).format(d);
  } catch {
    return d.toLocaleDateString(locale);
  }
}

/** Plain locale-grouped number (no currency symbol). */
export function formatNumberLocale(
  value: number | string,
  opts: { decimals?: number; locale?: string } = {}
): string {
  const { decimals = 2, locale = "en" } = opts;
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return "0";
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  } catch {
    return n.toFixed(decimals);
  }
}
