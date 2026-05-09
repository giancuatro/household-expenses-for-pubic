import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { applyFixedCostsForMonth } from "@/lib/fixedCosts";
import { monthKey } from "@/lib/format";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TopNav } from "@/components/layout/TopNav";
import { BottomTabNav } from "@/components/layout/BottomTabNav";
import { SwRegister } from "@/components/SwRegister";
import { Toaster } from "@/components/Toaster";

export const metadata: Metadata = {
  title: "家計簿",
  description: "シンプルな共有家計簿 OSS",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/icons/apple-touch-icon.png", sizes: "167x167", type: "image/png" },
      { url: "/icons/apple-touch-icon.png", sizes: "152x152", type: "image/png" },
      { url: "/icons/apple-touch-icon.png", sizes: "120x120", type: "image/png" },
    ],
    shortcut: ["/icons/icon-192.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "家計簿",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#10131a" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const authed = !!session;
  if (session) {
    try {
      await applyFixedCostsForMonth(session.household.household_id, monthKey());
    } catch {
      /* non-fatal */
    }
  }
  const householdLabel = session?.household.household.name ?? "家計簿";
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {authed && (
            <header className="sticky top-0 z-20 bg-background/80 backdrop-blur border-b border-border pt-safe-top">
              <div className="mx-auto max-w-5xl px-2 sm:px-4 py-3 flex items-center justify-between gap-3">
                <Link href="/" className="font-bold text-lg shrink-0 truncate max-w-[40%]" title={householdLabel}>
                  {householdLabel}
                </Link>
                <TopNav />
                <ThemeToggle className="shrink-0" />
              </div>
            </header>
          )}
          <main className="flex-1 mx-auto w-full max-w-5xl px-2 sm:px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+5rem)] md:pb-8">
            {children}
          </main>
          {authed && <BottomTabNav />}
          <Toaster />
          <SwRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
