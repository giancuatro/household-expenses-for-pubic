"use client";

import { createBrowserClient } from "@supabase/ssr";

let _client: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Browser-side Supabase client. Used from "use client" components for
 * sign-in / sign-up / sign-out. Cookies are managed automatically by
 * @supabase/ssr so the SSR side picks up the session in middleware.
 */
export function getSupabaseBrowser() {
  if (_client) return _client;
  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return _client;
}
