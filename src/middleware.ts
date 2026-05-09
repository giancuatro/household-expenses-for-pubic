import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Supabase-Auth middleware. Replaces the legacy shared-password gate.
 *
 *  - Public paths (/login, /signup, /auth/*) are always allowed.
 *  - Every other path requires a Supabase session cookie. Anonymous requests
 *    are redirected to /login with ?next=<original-pathname>.
 *  - Calling supabase.auth.getUser() also refreshes the access token cookie
 *    so SSR routes downstream see a valid session.
 */

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/auth",
  "/icons",
  "/manifest.webmanifest",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const res = NextResponse.next({ request: { headers: req.headers } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // If Supabase env vars are missing, fail open on public paths so the
  // setup screen isn't a redirect loop. All other paths still 302 to /login.
  if (!url || !key) {
    if (isPublic(pathname)) return res;
    const u = req.nextUrl.clone();
    u.pathname = "/login";
    return NextResponse.redirect(u);
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      get: (name: string) => req.cookies.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => {
        res.cookies.set({ name, value, ...options });
      },
      remove: (name: string, options: CookieOptions) => {
        res.cookies.set({ name, value: "", ...options });
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const authed = !!data?.user;

  if (!authed && !isPublic(pathname)) {
    const u = req.nextUrl.clone();
    u.pathname = "/login";
    u.searchParams.set("next", pathname);
    return NextResponse.redirect(u);
  }

  // Authed user accidentally lands on /login → push them to / (the home
  // page redirects to /signup if they have no household yet, so the loop
  // is broken there).
  // /signup is intentionally *always allowed*: a signed-in user with no
  // household yet needs to be able to land on /signup to create one.
  if (authed && pathname === "/login") {
    const u = req.nextUrl.clone();
    u.pathname = "/";
    u.search = "";
    return NextResponse.redirect(u);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw\\.js|.*\\..*).*)"],
};
