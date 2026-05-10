"use client";

import { useEffect, useRef } from "react";

/**
 * Animated illustration for the "投資の売買が自動で現金残高に反映" slide.
 *
 * Beats (cycle = 7 s, looped):
 *   0.0–1.0  trade form fades in with AAPL fields populating.
 *   1.0–1.4  記録 button pulses.
 *   1.4–2.4  yen coin drops from form down to the cash card.
 *   2.4–3.6  cash balance ticker animates ¥500,000 → ¥490,000,
 *            and a -¥10,000 delta chip appears.
 *   3.6–4.4  holdings table at the very bottom gains a new AAPL row
 *            (highlighted with a soft tint) — the same trade is now
 *            tracked in two places without any double-entry.
 *   4.4–7.0  hold so the user can read the result.
 */
export function InvestmentLinkIllustration() {
  const cashRef = useRef<SVGTSpanElement | null>(null);

  useEffect(() => {
    const cycle = 7000;
    const fillStart = 2400;
    const fillEnd = 3600;
    const startVal = 500_000;
    const endVal = 490_000;
    let raf = 0;
    function tick(now: number) {
      const t = now % cycle;
      if (!cashRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (t < fillStart) {
        cashRef.current.textContent = startVal.toLocaleString("ja-JP");
      } else if (t < fillEnd) {
        const p = (t - fillStart) / (fillEnd - fillStart);
        const eased = 1 - Math.pow(1 - p, 3);
        const value = Math.round(startVal + (endVal - startVal) * eased);
        cashRef.current.textContent = value.toLocaleString("ja-JP");
      } else {
        cashRef.current.textContent = endVal.toLocaleString("ja-JP");
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      viewBox="0 0 320 240"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto inv-illustration"
      role="img"
      aria-label="投資タブで売買を記録すると、家計簿の現金残高にも自動反映される様子"
    >
      <rect x="8" y="8" width="304" height="224" rx="14" fill="hsl(var(--muted))" opacity="0.4" />

      {/* Top: investment trade form */}
      <g className="inv-trade">
        <text x="20" y="28" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          投資タブ → 売買を記録
        </text>
        <rect x="20" y="40" width="280" height="56" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="30" y="58" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">AAPL</text>
        <text x="30" y="70" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">Apple Inc.</text>

        <rect x="30" y="76" width="36" height="14" rx="3" fill="hsl(var(--success))" opacity="0.18" />
        <text x="48" y="86" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--success))">買い</text>
        <text x="74" y="86" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">10 株</text>
        <text x="118" y="86" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">×</text>
        <text x="128" y="86" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">$100</text>
        <text x="158" y="86" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">@¥150</text>
        <text x="200" y="86" fontSize="9" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">= ¥10,000</text>

        <rect x="232" y="56" width="60" height="22" rx="6" fill="hsl(var(--primary))" className="inv-record-btn" />
        <text x="262" y="71" fontSize="11" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--primary-foreground))">記録</text>
      </g>

      {/* Coin animation between top and middle */}
      <g className="inv-coin">
        <circle cx="160" cy="106" r="7" fill="hsl(var(--warning))" />
        <text x="160" y="110" fontSize="9" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="white">¥</text>
      </g>

      {/* Middle: cash balance card */}
      <g className="inv-cash">
        <rect x="20" y="124" width="280" height="46" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="30" y="142" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">家計簿の現金残高</text>
        <text x="30" y="156" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">投資の支出として自動連動</text>
        <text x="290" y="150" fontSize="14" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          ¥<tspan ref={cashRef}>500,000</tspan>
        </text>
        <text x="290" y="162" fontSize="8.5" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--destructive))" className="inv-delta">
          -¥10,000
        </text>
      </g>

      {/* Bottom: holdings table */}
      <g className="inv-holdings">
        <text x="20" y="186" fontSize="9" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">投資タブ → 保有銘柄</text>
        <rect x="20" y="192" width="280" height="36" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        {/* existing rows */}
        <text x="30" y="206" fontSize="9" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">VOO</text>
        <text x="30" y="218" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">5 株</text>
        <text x="138" y="206" fontSize="9" textAnchor="end" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">¥285,000</text>
        <text x="138" y="218" fontSize="7.5" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--success))">+8.2%</text>

        {/* New AAPL row appears here */}
        <g className="inv-new-row">
          <rect x="148" y="196" width="148" height="28" rx="4" fill="hsl(var(--primary))" opacity="0.10" />
          <text x="156" y="208" fontSize="9" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--primary))">AAPL</text>
          <text x="156" y="220" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">10 株 (新規)</text>
          <text x="290" y="208" fontSize="9" textAnchor="end" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">¥10,000</text>
          <text x="290" y="220" fontSize="7.5" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">取得</text>
        </g>
      </g>

      <style>{`
        .inv-illustration .inv-trade { animation: inv-fade 7s ease-out infinite both; }
        .inv-illustration .inv-record-btn { animation: inv-pulse 7s ease-in-out infinite; transform-origin: 262px 67px; transform-box: fill-box; }
        .inv-illustration .inv-coin {
          opacity: 0;
          animation: inv-coin-drop 7s ease-in infinite;
        }
        .inv-illustration .inv-cash { opacity: 0; animation: inv-cash-in 7s ease-out infinite; }
        .inv-illustration .inv-delta { opacity: 0; animation: inv-delta 7s ease-out infinite; }
        .inv-illustration .inv-holdings { opacity: 0; animation: inv-hold 7s ease-out infinite; }
        .inv-illustration .inv-new-row { opacity: 0; transform: translateY(2px); animation: inv-new-row 7s ease-out infinite; }

        @keyframes inv-fade {
          0%   { opacity: 0; transform: translateY(4px); }
          7%   { opacity: 1; transform: translateY(0); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes inv-pulse {
          0%, 14%   { transform: scale(1); opacity: 1; }
          17%, 20%  { transform: scale(0.97); opacity: 0.8; }
          24%, 100% { transform: scale(1); opacity: 1; }
        }
        @keyframes inv-coin-drop {
          0%, 22%   { opacity: 0; transform: translateY(-12px); }
          26%       { opacity: 1; transform: translateY(0); }
          33%       { opacity: 1; transform: translateY(20px); }
          36%       { opacity: 0; transform: translateY(20px); }
          100%      { opacity: 0; transform: translateY(20px); }
        }
        @keyframes inv-cash-in {
          0%, 14%  { opacity: 0; transform: translateY(4px); }
          22%      { opacity: 1; transform: translateY(0); }
          100%     { opacity: 1; transform: translateY(0); }
        }
        @keyframes inv-delta {
          0%, 38%  { opacity: 0; }
          45%      { opacity: 1; }
          100%     { opacity: 1; }
        }
        @keyframes inv-hold {
          0%, 36%  { opacity: 0; transform: translateY(4px); }
          44%      { opacity: 1; transform: translateY(0); }
          100%     { opacity: 1; transform: translateY(0); }
        }
        @keyframes inv-new-row {
          0%, 52%  { opacity: 0; transform: translateY(2px); }
          60%      { opacity: 1; transform: translateY(0); }
          100%     { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .inv-illustration * { animation: none !important; opacity: 1; transform: none !important; }
        }
      `}</style>
    </svg>
  );
}
