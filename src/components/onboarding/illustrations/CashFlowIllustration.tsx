"use client";

import { useEffect, useRef } from "react";

/**
 * Animated illustration for the "現金スナップショット → CF 予測" onboarding slide.
 *
 * Stylized — not a 1:1 of the real settings screen, but uses the app's color
 * tokens so it feels native. Animates in three beats:
 *  1. Balance number ticks up to ¥300,000 inside a small "settings card".
 *  2. A faint "保存" button pulses.
 *  3. A 60-day cash-flow line draws itself across the lower chart pane.
 */
export function CashFlowIllustration() {
  const numRef = useRef<SVGTSpanElement | null>(null);

  // Animate ¥0 → ¥300,000 in 1.0s using rAF (no React re-renders).
  useEffect(() => {
    const target = 300_000;
    const duration = 1000;
    let raf = 0;
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(target * eased);
      if (numRef.current) numRef.current.textContent = value.toLocaleString("ja-JP");
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      viewBox="0 0 320 180"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto onboarding-illustration"
      role="img"
      aria-label="現金残高を入力すると、60 日先までのキャッシュフロー予測が描画される様子"
    >
      <rect x="8" y="8" width="304" height="164" rx="12" fill="hsl(var(--muted))" opacity="0.4" />

      <g className="cf-row-1">
        <text x="20" y="32" fontSize="11" fill="hsl(var(--muted-foreground))" fontFamily="system-ui">
          現金残高
        </text>
        <rect x="20" y="40" width="180" height="28" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text
          x="194"
          y="59"
          fontSize="14"
          textAnchor="end"
          fontFamily="system-ui"
          fontWeight="600"
          fill="hsl(var(--foreground))"
        >
          ¥<tspan ref={numRef}>0</tspan>
        </text>
        <rect x="212" y="40" width="80" height="28" rx="8" fill="hsl(var(--primary))" className="cf-save-btn" />
        <text
          x="252"
          y="59"
          fontSize="11"
          textAnchor="middle"
          fill="hsl(var(--primary-foreground))"
          fontFamily="system-ui"
          fontWeight="600"
        >
          保存
        </text>
      </g>

      <g className="cf-chart">
        <rect x="20" y="84" width="280" height="76" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="28" y="98" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="system-ui">
          60 日キャッシュフロー予測
        </text>
        <line x1="28" y1="148" x2="292" y2="148" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <line x1="28" y1="130" x2="292" y2="130" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <line x1="28" y1="112" x2="292" y2="112" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <path
          d="M 28 118 L 60 124 L 92 120 L 124 132 L 156 138 L 188 130 L 220 122 L 252 116 L 284 110"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="cf-line"
        />
        <circle cx="284" cy="110" r="3.5" fill="hsl(var(--primary))" className="cf-dot" />
      </g>

      <style>{`
        .onboarding-illustration .cf-row-1 { animation: cf-fade 0.4s ease-out both; }
        .onboarding-illustration .cf-save-btn { animation: cf-pulse 1.6s ease-in-out 1.6s infinite; transform-origin: 252px 54px; }
        .onboarding-illustration .cf-chart { animation: cf-fade 0.5s ease-out 0.5s both; }
        .onboarding-illustration .cf-line {
          stroke-dasharray: 600;
          stroke-dashoffset: 600;
          animation: cf-draw 1.6s ease-out 1.0s forwards;
        }
        .onboarding-illustration .cf-dot { opacity: 0; animation: cf-fade 0.3s ease-out 2.5s forwards; }
        @keyframes cf-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cf-draw { to { stroke-dashoffset: 0; } }
        @keyframes cf-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
        @media (prefers-reduced-motion: reduce) {
          .onboarding-illustration .cf-line,
          .onboarding-illustration .cf-row-1,
          .onboarding-illustration .cf-chart,
          .onboarding-illustration .cf-dot,
          .onboarding-illustration .cf-save-btn { animation: none !important; opacity: 1; transform: none; stroke-dashoffset: 0; }
        }
      `}</style>
    </svg>
  );
}
