import { type NextRequest, NextResponse } from "next/server";

// Server-only env var — never in the client bundle.
// Set ADMIN_SLUG in .env (no NEXT_PUBLIC_ prefix).
// Admin visits:  https://yourdomain.com/{ADMIN_SLUG}
// Anyone else:   https://yourdomain.com/admin  →  redirected silently to /
const ADMIN_SLUG = process.env.ADMIN_SLUG ?? "";

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Block direct /admin access from everyone
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Allow secret slug through — rewrite internally to /admin content.
  // Browser URL stays as /{ADMIN_SLUG}, never reveals /admin.
  if (
    ADMIN_SLUG &&
    (pathname === `/${ADMIN_SLUG}` || pathname.startsWith(`/${ADMIN_SLUG}/`))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(`/${ADMIN_SLUG}`, "/admin");
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|_vercel|.*\\..*).*)"],
};
