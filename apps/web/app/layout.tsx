import "./globals.css";
import Providers from "./providers";
import type { Metadata } from "next";
import SiteHeader, { SiteFooter } from "./site-header";

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
          <div className="site-shell">
            <SiteHeader />
            <div className="flex flex-1 flex-col">{children}</div>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
