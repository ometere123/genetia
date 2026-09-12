import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { defaultLocale, locales, type Locale } from "./config";

// Internationalisation WITHOUT i18n routing.
// We don't put a [locale] segment in app/, and we don't use the next-intl
// middleware. Locale is read from the NEXT_LOCALE cookie (set by the
// language switcher) and falls back to the default for everyone else.
export default getRequestConfig(async () => {
  const cookieLocale = cookies().get("NEXT_LOCALE")?.value;
  const locale: Locale =
    cookieLocale && (locales as readonly string[]).includes(cookieLocale)
      ? (cookieLocale as Locale)
      : defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
