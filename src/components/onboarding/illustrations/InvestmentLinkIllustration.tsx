"use client";

import { useEffect, useRef } from "react";

/**
 * Animated illustration for the "投資の売買が自動で現金残高に反映" onboarding slide.
 *
 * Beats:
 *  1. Investment trade form fades in with "Buy 10株 ¥10,000" pre-filled.
 *  2. The "記録" button pulses, then a coin icon drops down.
 *  3. The cash balance number tickers from ¥500,000 → ¥490,000.
 */
export function InvestmentLinkIllustration() {
  const cashRef = useRef<SVGTSpanElement | null>(null);

  // Animate ¥500,000 → ¥490,000 starting after the coin drops (~2.0s).
  useEffect(() => {
    const startVal = 500_000;
    const endVal = 490_000;
    const duration = 800;
    const delay = 2000;
    let raf = 0;
    const t0 = performance.now() + delay;
    function tick(now: number) {
      const elapsed = now - t0;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(startVal + (endVal - startVal) * eased);
      if (cashRef.current) cashRef.current.textContent = value.toLocaleString("ja-JP");
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      viewBox="0 0 320 180"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto inv-illustration"
      role="img"
      aria-label="投資タブで売買を記録すると、現金残高に自動反映される様子"
    >
      <rect x="8" y="8" width="304" height="164" rx="12" fill="hsl(var(--muted))" opacity="0.4" />

      {/* Top: trade form */}
      <g className="inv-trade">
        <text x="20" y="28" fontSize="11" fill="hsl(var(--muted-foreground))" fontFamily="system-ui">
          投資タブ
        </text>
        <rect x="20" y="36" width="280" height="42" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="30" y="55" fontSize="11" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">
          AAPL
        </text>
        <text x="30" y="68" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">
          買い  10 株  ¥10,000
        </text>
        <rect x="232" y="46" width="60" height="22" rx="6" fill="hsl(var(--primary))" className="inv-record-btn" />
        <text x="262" y="61" fontSize="11" textAnchor="middle" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--primary-foreground))">
          記録
        </text>
      </g>

      {/* Connector + coin animation */}
      <g className="inv-coin">
        <circle cx="160" cy="88" r="6" fill="hsl(var(--warning))" />
        <text x="160" y="92" fontSize="8" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="white">¥</text>
      </g>

      {/* Bottom: cash balance */}
      <g className="inv-cash">
        <rect x="20" y="120" width="280" height="42" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="30" y="138" fontSize="11" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">
          現金残高
        </text>
        <text x="290" y="148" fontSize="14" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          ¥<tspan ref={cashRef}>500,000</tspan>
        </text>
        <text x="290" y="156" fontSize="8" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--destructive))" className="inv-delta">
          -¥10,000
        </text>
      </g>

      <style>{`
        .inv-illustration .inv-trade { animation: inv-fade 0.4s ease-out both; }
        .inv-illustration .inv-record-btn { animation: inv-pulse 1.0s ease-in-out 0.7s 2; transform-origin: 262px 57px; }
        .inv-illustration .inv-coin {
          opacity: 0;
          transform: translateY(0);
          animation: inv-coin-drop 1.0s ease-in 1.5s forwards;
        }
        .inv-illustration .inv-cash { animation: inv-fade 0.4s ease-out 0.5s both; }
        .inv-illustration .inv-delta { opacity: 0; animation: inv-fade 0.3s ease-out 2.3s forwards; }
        @keyframes inv-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes inv-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes inv-coin-drop {
          0%   { opacity: 0; transform: translateY(-12px); }
          15%  { opacity: 1; }
          80%  { opacity: 1; transform: translateY(36px); }
          100% { opacity: 0; transform: translateY(36px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .inv-illustration * { animation: none !important; opacity: 1; transform: none; }
        }
      `}</style>
    </svg>
  );
}
