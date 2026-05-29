export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import Providers from "./providers";
import Navbar from "../components/Navbar";

export const metadata: Metadata = {
  title: "Genetia — Prediction Markets",
  description: "AI-resolved prediction markets on Arc, powered by GenLayer",
  icons: { icon: "/favicon.ico" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale   = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <body className="bg-surface-0 text-slate-100 antialiased">
        <NextIntlClientProvider messages={messages}>
          <Providers>
            <div className="flex flex-col min-h-screen">
              <Navbar />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

async function Footer() {
  const t = await getTranslations("footer");
  return (
    <footer className="border-t border-border py-5 text-center text-xs text-slate-600">
      <span>Genetia · {t("markets")} </span>
      <a href="https://arc.io" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-slate-300 transition-colors">Arc</a>
      <span> · {t("resolvedBy")} </span>
      <a href="https://genlayer.com" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-slate-300 transition-colors">GenLayer</a>
    </footer>
  );
}
