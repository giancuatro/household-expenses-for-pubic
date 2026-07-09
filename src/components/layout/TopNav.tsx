"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "ホーム" },
  { href: "/report", label: "月次" },
  { href: "/dashboard", label: "分析" },
  { href: "/investment", label: "投資" },
  { href: "/settings", label: "設定" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function TopNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="hidden md:flex gap-1 text-sm">
      {items.map((n) => {
        const active = isActive(pathname, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            prefetch
            aria-current={active ? "page" : undefined}
            className={cn(
              "px-3 py-1.5 rounded-full transition-colors whitespace-nowrap",
              active
                ? "bg-primary/10 text-primary font-medium"
                : "text-foreground/70 hover:text-foreground hover:bg-accent",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
