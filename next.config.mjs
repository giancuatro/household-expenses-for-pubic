import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Lifted from the default 1MB and the previous 2MB cap so credit-card
    // PDF statements (~5–8MB once base64-encoded becomes ~10MB) can flow
    // through importCardStatement as a Server Action.
    serverActions: { bodySizeLimit: "12mb" },
    // Tree-shakes recharts (~100kB savings) and de-duplicates clsx imports.
    optimizePackageImports: ["recharts", "clsx"],
  },
  // Defensive HTTP response headers applied to every route. Caching headers
  // for static assets are added in the second/third entries below.
  async headers() {
    // Conservative CSP. Tailwind + recharts emit inline `style` attributes,
    // so 'unsafe-inline' for styles is unavoidable; scripts stay locked down
    // (only 'self' + 'unsafe-inline' for Next.js's hydration bootstrap, no
    // remote script CDNs).
    let supabaseHost = "";
    try {
      if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
        supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
      }
    } catch {
      // ignore — connect-src below still allows *.supabase.co
    }
    const connectSrc = ["'self'", "https://*.supabase.co", "wss://*.supabase.co"];
    if (supabaseHost) connectSrc.push(`https://${supabaseHost}`, `wss://${supabaseHost}`);
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      `connect-src ${connectSrc.join(" ")}`,
      "font-src 'self' data:",
      "manifest-src 'self'",
      "worker-src 'self' blob:",
    ].join("; ");

    const securityHeaders = [
      // Block clickjacking — the app is never meant to be embedded in an iframe.
      { key: "X-Frame-Options", value: "DENY" },
      // Disable MIME sniffing so a misconfigured response can't be reinterpreted.
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Don't leak full URLs (e.g. invite tokens in the path) on outbound links.
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Force HTTPS for one year, including subdomains.
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      // Drop access to sensors / payment APIs we don't use.
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      // Block legacy Adobe Flash / PDF cross-domain policy lookups. We never
      // serve a crossdomain.xml, so deny by header rather than by 404.
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
      { key: "Content-Security-Policy", value: csp },
    ];

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // Always serve app icons fresh enough that updates take effect
        // within a day, but cache aggressively across single visits.
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, must-revalidate" }],
      },
    ];
  },
};

export default withSerwist(nextConfig);
