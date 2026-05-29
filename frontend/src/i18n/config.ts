export const locales = ["en", "es", "fr", "pt", "zh"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  pt: "Português",
  zh: "中文",
};

// 2-letter region codes (used as compact text glyphs in the locale switcher,
// replacing the previous flag emojis for consistency with the lucide icon set).
export const localeFlags: Record<Locale, string> = {
  en: "GB",
  es: "ES",
  fr: "FR",
  pt: "BR",
  zh: "CN",
};
