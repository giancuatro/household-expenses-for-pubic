"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Global pull-to-refresh handler.
 *
 * Listens to touch events on the document and triggers `router.refresh()` once
 * the user pulls down past a threshold while the scroll position is at the
 * top of the page. The indicator is a thin overlay anchored just below the
 * status bar so it doesn't disturb layout.
 *
 * A custom `app:refresh` window event is also dispatched so pages can hook
 * extra work (e.g. the investment tab re-fetches live prices) without each
 * page needing its own touch listener.
 */
const PULL_THRESHOLD = 64;
const MAX_PULL = 110;

export function PullToRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  // Refs that mirror state so the touch handlers can be registered once.
  // Re-registering on every touchmove would thrash event listeners.
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  pullRef.current = pull;
  refreshingRef.current = refreshing;

  useEffect(() => {
    function onStart(e: TouchEvent) {
      if (refreshingRef.current) return;
      // Only engage when we're at the very top of the document.
      if (window.scrollY > 0) return;
      if (e.touches.length !== 1) return;
      startYRef.current = e.touches[0].clientY;
      activeRef.current = true;
    }
    function onMove(e: TouchEvent) {
      if (!activeRef.current || startYRef.current === null) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        if (pullRef.current !== 0) setPull(0);
        return;
      }
      // Soft-clamp the pull distance with a sub-linear curve so the user
      // doesn't have to drag the whole screen height.
      const eased = Math.min(MAX_PULL, dy * 0.5);
      setPull(eased);
    }
    function onEnd() {
      if (!activeRef.current) return;
      activeRef.current = false;
      startYRef.current = null;
      const triggered = pullRef.current >= PULL_THRESHOLD;
      setPull(0);
      if (!triggered || refreshingRef.current) return;
      setRefreshing(true);
      window.dispatchEvent(new CustomEvent("app:refresh"));
      router.refresh();
      // The refresh is fire-and-forget — release the indicator after a
      // short visible beat so the user sees the spinner acknowledge.
      setTimeout(() => setRefreshing(false), 600);
    }
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [router]);

  const visible = pull > 0 || refreshing;
  const progress = Math.min(1, pull / PULL_THRESHOLD);
  const translateY = refreshing ? 24 : Math.min(MAX_PULL, pull);

  return (
    <div
      aria-hidden={!visible}
      className="pointer-events-none fixed top-0 left-1/2 z-[70] -translate-x-1/2"
      style={{
        transform: `translate(-50%, ${translateY - 32}px)`,
        opacity: visible ? 1 : 0,
        transition: refreshing
          ? "transform 200ms ease, opacity 200ms ease"
          : startYRef.current === null
            ? "transform 200ms ease, opacity 200ms ease"
            : "none",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-md">
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          className={refreshing ? "animate-spin" : ""}
          style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
        >
          <circle
            cx="9"
            cy="9"
            r="7"
            fill="none"
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity="0.25"
            strokeWidth="2"
          />
          <path
            d="M9 2 A7 7 0 0 1 16 9"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
