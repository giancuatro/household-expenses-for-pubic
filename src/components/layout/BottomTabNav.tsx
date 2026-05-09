"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FileText, Home, Settings, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const items: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "ホーム", icon: Home },
  { href: "/report", label: "月次", icon: FileText },
  { href: "/dashboard", label: "推移", icon: BarChart3 },
  { href: "/investment", label: "投資", icon: TrendingUp },
  { href: "/settings", label: "設定", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function BottomTabNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav
      aria-label="メインナビゲーション"
      className={cn(
        "md:hidden fixed inset-x-0 bottom-0 z-30",
        "bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75",
        "border-t border-border",
        "pb-safe-bottom",
      )}
    >
      <ul className="flex items-stretch justify-around px-2 pt-1">
        {items.map((n) => {
          const Icon = n.icon;
          const active = isActive(pathname, n.href);
          return (
            <li key={n.href} className="flex-1">
              <Link
                href={n.href}
                prefetch
                aria-current={active ? "page" : undefined}
                aria-label={n.label}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl transition-colors",
                  "active:bg-accent",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={active ? 2.4 : 2} />
                <span className={cn("text-[10px] leading-none", active && "font-semibold")}>
                  {n.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
