"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import AuthControls from "./auth-controls";

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [light, setLight] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  useEffect(() => {
    setQuery(new URLSearchParams(window.location.search).get("q") ?? "");
    const onSearch = (event: Event) => setQuery((event as CustomEvent<{ query: string }>).detail.query);
    window.addEventListener("genetia:search", onSearch);
    return () => window.removeEventListener("genetia:search", onSearch);
  }, []);

  function search(value: string) {
    setQuery(value);
    window.dispatchEvent(new CustomEvent("genetia:search", { detail: { query: value } }));
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const target = `/?q=${encodeURIComponent(query.trim())}`;
    if (pathname !== "/") router.push(target);
    else window.history.replaceState(null, "", target);
  }

  function toggleTheme() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    document.documentElement.classList.toggle("dark", !next);
  }

  return <header className="sticky top-0 z-50 border-b border-border bg-surface-0/95 backdrop-blur-md">
    <div className="flex h-[70px] items-center gap-4 px-4 sm:px-6">
      <Link href="/" className="mr-1 flex shrink-0 items-center gap-2" aria-label="Genetia home">
        <svg viewBox="0 0 200 200" className="h-10 w-10" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs><linearGradient id="genetiaMark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7c5cff" /><stop offset="1" stopColor="#22d3ee" /></linearGradient></defs>
          <path d="M150 60 A55 55 0 1 0 150 140 L150 110 L110 110" fill="none" stroke="url(#genetiaMark)" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M58 132 L86 108 L108 124 L150 78" fill="none" stroke="url(#genetiaMark)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
          <circle cx="150" cy="78" r="9" fill="#22d3ee" />
        </svg>
        <span className="brand-gradient-text text-base font-bold tracking-tight">Genetia</span>
        <span className="hidden rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:inline-flex">TESTNET</span>
      </Link>

      <form onSubmit={submitSearch} role="search" className="relative hidden w-[clamp(8rem,16vw,230px)] shrink-0 md:block">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input aria-label="Search markets" placeholder="Search markets…" value={query} onChange={(event) => search(event.target.value)} className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 transition focus:border-brand/60 focus:bg-surface-3 focus:outline-none" />
      </form>

      <nav aria-label="Primary" className="hidden shrink-0 items-center gap-0.5 xl:flex">
        <HeaderLink href="/" active={pathname === "/"}>Markets</HeaderLink>
        <HeaderLink href="/portfolio" active={pathname.startsWith("/portfolio")}>Portfolio</HeaderLink>
        <HeaderLink href="/wallet" active={pathname.startsWith("/wallet")}>Wallet</HeaderLink>
        <HeaderLink href="/about" active={pathname.startsWith("/about")}>How it works</HeaderLink>
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button type="button" onClick={() => setMobileSearchOpen((value) => !value)} aria-label="Search markets" aria-expanded={mobileSearchOpen} className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface-2 text-slate-400 md:hidden"><Icon name="search" className="h-4 w-4" /></button>
        <button type="button" onClick={toggleTheme} aria-label={light ? "Switch to dark mode" : "Switch to light mode"} className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface-2 text-slate-400 transition hover:border-border-strong hover:text-white"><Icon name={light ? "moon" : "sun"} className="h-4 w-4" /></button>
        <span className="hidden h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-[11px] font-semibold text-slate-400 sm:flex"><Icon name="globe" className="h-3.5 w-3.5" /> EN <span className="text-slate-600">⌄</span></span>
        <AuthControls />
      </div>
    </div>
    {mobileSearchOpen && <form onSubmit={submitSearch} role="search" className="relative border-t border-border bg-surface-0 p-3 md:hidden"><Icon name="search" className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input autoFocus aria-label="Search markets" placeholder="Search markets…" value={query} onChange={(event) => search(event.target.value)} className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-brand/60 focus:outline-none" /></form>}
  </header>;
}

function HeaderLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={href} className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${active ? "bg-surface-3 text-white" : "text-slate-400 hover:bg-surface-2 hover:text-white"}`}>{children}</Link>;
}

export function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const common = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  switch (name) {
    case "search": return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
    case "trend": return <svg {...common}><path d="M3 17 9 11l4 4 8-9" /><path d="M15 6h6v6" /></svg>;
    case "bolt": return <svg {...common}><path d="m13 2-3 8h7l-6 12 2-9H6l7-11Z" /></svg>;
    case "sparkle": return <svg {...common}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></svg>;
    case "grid": return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>;
    case "crypto": return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M9 7h4a2 2 0 0 1 0 4H9h5a2 2 0 0 1 0 4H9m2-10v12m3-12v1m0 10v1"/></svg>;
    case "politics": return <svg {...common}><path d="m3 9 9-6 9 6M5 10h14M6 10v8m4-8v8m4-8v8m4-8v8M3 21h18M4 18h16"/></svg>;
    case "sports": return <svg {...common}><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m8 5 4 7 8-1.5M4 8l8 4m0 0-1 8"/></svg>;
    case "science": return <svg {...common}><circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/></svg>;
    case "entertainment": return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 5 3 14m4-14 3 14M3 10h18m-18 4h18"/></svg>;
    case "sun": return <svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
    case "moon": return <svg {...common}><path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/></svg>;
    case "globe": return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18m0-18a14 14 0 0 0 0 18"/></svg>;
    case "inbox": return <svg {...common}><path d="M4 4h16l2 8v7H2v-7l2-8Z"/><path d="M2 12h6l2 3h4l2-3h6"/></svg>;
    case "wallet": return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 8h18m-5 4h.01M7 5V3h11v2"/></svg>;
    case "download": return <svg {...common}><path d="M12 3v12m-5-5 5 5 5-5M4 19h16"/></svg>;
    default: return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
  }
}
