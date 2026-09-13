import "./globals.css";
import Providers from "./providers";
import type { Metadata } from "next";
import SiteHeader from "./site-header";

export const metadata: Metadata = {
  title: "Genetia Markets",
  description: "Evidence-first prediction markets, backed by transparent Base state and GenLayer resolution.",
  icons: { icon: "/icon.svg", shortcut: "/icon.svg" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-surface-0 text-slate-100 antialiased">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <div className="flex flex-1 flex-col">{children}</div>
            <footer className="border-t border-border px-4 py-8 text-center text-sm text-slate-500">
              Genetia · Prediction markets on Base Sepolia · Resolved by GenLayer
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
