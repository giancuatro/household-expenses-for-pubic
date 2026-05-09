import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client using the ANON key + cookies.
 * Use this from Server Components / Server Actions / Route Handlers.
 */
export function getSupabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) => {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            /* called from a Server Component — safe to ignore */
          }
        },
        remove: (name: string, options: CookieOptions) => {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            /* ignore */
          }
        },
      },
    }
  );
}

/**
 * Service-role client — bypasses RLS. Never expose to client code.
 */
export function getSupabaseAdmin() {
  const { createClient } = require("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
