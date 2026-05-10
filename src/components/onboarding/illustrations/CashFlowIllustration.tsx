"use client";

import { useEffect, useRef } from "react";

/**
 * Animated illustration for the combined "現金スナップ + クレカ + CF予測" slide.
 *
 * Three frames play once over ~16s, with explicit button presses and focus
 * rings on the actual fields users need to fill, then hold their final state
 * (no infinite loop = no flicker). The SVG remounts when the slide is
 * re-entered, so each visit replays cleanly.
 *
 *   Frame 1 (0.0–5.5s)   設定 → 現金残高
 *     - Form fades in.
 *     - Balance number tickers ¥0 → ¥300,000 (0.6–2.4s).
 *     - "残高を記録" button gets a focus halo, then a subtle press
 *       (scale 0.97 + opacity 0.8) at ~4.0s.
 *
 *   Frame 2 (5.5–11.0s)  設定 → 支払方法
 *     - Form fades in.
 *     - Closing-day field (15) → payment-day field (27) → 支払月 (翌月)
 *       each get a focus ring in sequence.
 *     - Mini calendar populates; closing day pulses orange, payment day
 *       pulses red.
 *
 *   Frame 3 (11.0–16.0s) ダッシュボード → CF 予測
 *     - Chart card fades in.
 *     - 60-day line draws.
 *     - "-50k" and "-45k" drop labels fade in over the credit-card
 *       payment days.
 */
export function CashFlowIllustration() {
  const balanceRef = useRef<SVGTSpanElement | null>(null);

  useEffect(() => {
    const fillStart = 600;
    const fillEnd = 2400;
    const target = 300_000;
    const startTime = performance.now();
    let raf = 0;
    let stop = false;
    function tick(now: number) {
      if (stop) return;
      const t = now - startTime;
      if (!balanceRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (t < fillStart) {
        balanceRef.current.textContent = "0";
        raf = requestAnimationFrame(tick);
      } else if (t < fillEnd) {
        const p = (t - fillStart) / (fillEnd - fillStart);
        const eased = 1 - Math.pow(1 - p, 3);
        balanceRef.current.textContent = Math.round(target * eased).toLocaleString("ja-JP");
        raf = requestAnimationFrame(tick);
      } else {
        balanceRef.current.textContent = target.toLocaleString("ja-JP");
        // done
      }
    }
    raf = requestAnimationFrame(tick);
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <svg
      viewBox="0 0 320 240"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto cf-illustration"
      role="img"
      aria-label="現金残高を登録 → クレカの締め日と支払日を設定 → 60 日先までのキャッシュフロー予測が見える流れ"
    >
      <rect x="8" y="8" width="304" height="224" rx="14" fill="hsl(var(--muted))" opacity="0.4" />

      {/* Step indicator (lights up by phase) */}
      <g className="cf-steps">
        <circle cx="120" cy="22" r="7" className="cf-step cf-step-1" />
        <text x="120" y="26" fontSize="9" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="white">1</text>
        <line x1="129" y1="22" x2="151" y2="22" stroke="hsl(var(--border))" strokeWidth="2" />
        <circle cx="160" cy="22" r="7" className="cf-step cf-step-2" />
        <text x="160" y="26" fontSize="9" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="white">2</text>
        <line x1="169" y1="22" x2="191" y2="22" stroke="hsl(var(--border))" strokeWidth="2" />
        <circle cx="200" cy="22" r="7" className="cf-step cf-step-3" />
        <text x="200" y="26" fontSize="9" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="white">3</text>
      </g>

      {/* Frame 1: cash snapshot form */}
      <g className="cf-frame cf-frame-1">
        <text x="20" y="56" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          設定 → 現金残高
        </text>
        <text x="20" y="80" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">日付</text>
        <rect x="20" y="86" width="120" height="22" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="32" y="100" fontSize="10" fontFamily="system-ui" fill="hsl(var(--foreground))">2026-05-10</text>
        <text x="20" y="124" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">残高（円）</text>
        <rect x="20" y="130" width="280" height="32" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" className="cf-balance-input" />
        <text x="294" y="153" fontSize="18" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          ¥<tspan ref={balanceRef}>0</tspan>
        </text>
        {/* button + focus halo */}
        <rect x="216" y="178" width="84" height="26" rx="6" fill="hsl(var(--primary))" className="cf-record-btn" />
        <text x="258" y="194" fontSize="11" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--primary-foreground))">
          残高を記録
        </text>
        <rect x="212" y="174" width="92" height="34" rx="8" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" className="cf-record-halo" />
      </g>

      {/* Frame 2: credit card setup */}
      <g className="cf-frame cf-frame-2">
        <text x="20" y="56" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          設定 → 支払方法（クレジットカード）
        </text>

        {/* Three side-by-side fields with focus rings sequentially */}
        <text x="20" y="80" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">締め日</text>
        <rect x="20" y="86" width="80" height="26" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="60" y="103" fontSize="14" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">15</text>
        <rect x="18" y="84" width="84" height="30" rx="7" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" className="cf-focus-1" />

        <text x="116" y="80" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">支払日</text>
        <rect x="116" y="86" width="80" height="26" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="156" y="103" fontSize="14" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">27</text>
        <rect x="114" y="84" width="84" height="30" rx="7" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" className="cf-focus-2" />

        <text x="212" y="80" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">支払月</text>
        <rect x="212" y="86" width="80" height="26" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="252" y="103" fontSize="13" textAnchor="middle" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">翌月</text>
        <rect x="210" y="84" width="84" height="30" rx="7" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" className="cf-focus-3" />

        {/* Mini calendar */}
        <text x="20" y="132" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">5月のスケジュール</text>
        <g>
          {(() => {
            const cells: React.ReactNode[] = [];
            for (let r = 0; r < 4; r++) {
              for (let c = 0; c < 7; c++) {
                const day = r * 7 + c + 1;
                if (day > 31) break;
                const x = 20 + c * 40;
                const y = 138 + r * 16;
                const isClosing = day === 15;
                const isPayment = day === 27;
                cells.push(
                  <g key={day}>
                    <rect x={x} y={y} width="38" height="14" rx="3"
                      fill={isClosing ? "hsl(var(--warning))" : isPayment ? "hsl(var(--destructive))" : "transparent"}
                      opacity={isClosing || isPayment ? 0.85 : 1}
                      className={isClosing ? "cf-cal-closing" : isPayment ? "cf-cal-pay" : undefined}
                    />
                    <text x={x + 19} y={y + 10} fontSize="8" textAnchor="middle" fontFamily="system-ui"
                      fill={isClosing || isPayment ? "white" : "hsl(var(--foreground))"}
                      fontWeight={isClosing || isPayment ? 700 : 400}>
                      {day}
                    </text>
                  </g>,
                );
              }
            }
            return cells;
          })()}
        </g>
        <g>
          <rect x="20" y="208" width="10" height="10" fill="hsl(var(--warning))" rx="2" />
          <text x="34" y="216" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">締め日</text>
          <rect x="86" y="208" width="10" height="10" fill="hsl(var(--destructive))" rx="2" />
          <text x="100" y="216" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">支払日（引落）</text>
        </g>
      </g>

      {/* Frame 3: CF projection chart */}
      <g className="cf-frame cf-frame-3">
        <text x="20" y="56" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          ダッシュボード → CF 予測（60 日）
        </text>
        <text x="20" y="74" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">
          現金残高の推移と引落タイミングが反映されます
        </text>

        <rect x="20" y="86" width="280" height="116" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <line x1="32" y1="180" x2="288" y2="180" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <line x1="32" y1="148" x2="288" y2="148" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <line x1="32" y1="116" x2="288" y2="116" stroke="hsl(var(--border))" strokeDasharray="2 3" />

        <text x="28" y="120" fontSize="7" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">300k</text>
        <text x="28" y="152" fontSize="7" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">200k</text>
        <text x="28" y="184" fontSize="7" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">100k</text>

        <path
          d="M 32 116 L 100 122 L 130 122 L 130 140 L 200 144 L 230 144 L 230 162 L 288 168"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="cf-line"
        />
        <g className="cf-drop-1">
          <rect x="120" y="100" width="44" height="14" rx="3" fill="hsl(var(--destructive))" />
          <text x="142" y="110" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="white">-50k</text>
          <line x1="142" y1="114" x2="130" y2="122" stroke="hsl(var(--destructive))" strokeWidth="1.2" />
        </g>
        <g className="cf-drop-2">
          <rect x="220" y="124" width="44" height="14" rx="3" fill="hsl(var(--destructive))" />
          <text x="242" y="134" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="white">-45k</text>
          <line x1="242" y1="138" x2="230" y2="144" stroke="hsl(var(--destructive))" strokeWidth="1.2" />
        </g>
        <circle cx="288" cy="168" r="3.5" fill="hsl(var(--primary))" className="cf-dot" />

        <text x="32" y="220" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">5/10</text>
        <text x="288" y="220" fontSize="8" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">7/9</text>
      </g>

      <style>{`
        /* Step indicator: each circle activates when its phase begins. */
        .cf-illustration .cf-step { fill: hsl(var(--muted-foreground)); }
        .cf-illustration .cf-step-1 { fill: hsl(var(--primary)); animation: cf-step-1 16s linear forwards; }
        .cf-illustration .cf-step-2 { animation: cf-step-2 16s linear forwards; }
        .cf-illustration .cf-step-3 { animation: cf-step-3 16s linear forwards; }
        @keyframes cf-step-1 { 0%, 33% { fill: hsl(var(--primary)); } 34%, 100% { fill: hsl(var(--muted-foreground)); } }
        @keyframes cf-step-2 { 0%, 33%   { fill: hsl(var(--muted-foreground)); } 34%, 67% { fill: hsl(var(--primary)); } 68%, 100% { fill: hsl(var(--muted-foreground)); } }
        @keyframes cf-step-3 { 0%, 67%   { fill: hsl(var(--muted-foreground)); } 68%, 100% { fill: hsl(var(--primary)); } }

        /* Frames cross-fade once over 16s. */
        .cf-illustration .cf-frame { opacity: 0; }
        .cf-illustration .cf-frame-1 { animation: cf-frame-1 16s ease-in-out forwards; }
        .cf-illustration .cf-frame-2 { animation: cf-frame-2 16s ease-in-out forwards; }
        .cf-illustration .cf-frame-3 { animation: cf-frame-3 16s ease-in-out forwards; }
        @keyframes cf-frame-1 {
          0%      { opacity: 0; }
          3%      { opacity: 1; }
          31%     { opacity: 1; }
          35%, 100% { opacity: 0; }
        }
        @keyframes cf-frame-2 {
          0%, 33% { opacity: 0; }
          37%     { opacity: 1; }
          65%     { opacity: 1; }
          69%, 100% { opacity: 0; }
        }
        @keyframes cf-frame-3 {
          0%, 67% { opacity: 0; }
          71%     { opacity: 1; }
          100%    { opacity: 1; }
        }

        /* Frame 1: button focus + press */
        .cf-illustration .cf-record-halo {
          opacity: 0;
          animation: cf-halo 16s ease-in-out forwards;
        }
        @keyframes cf-halo {
          0%, 16%   { opacity: 0; transform: scale(1.04); }
          20%, 26%  { opacity: 0.6; transform: scale(1); }
          30%, 100% { opacity: 0; }
        }
        .cf-illustration .cf-record-btn {
          animation: cf-record-press 16s ease-in-out forwards;
          transform-origin: center; transform-box: fill-box;
        }
        @keyframes cf-record-press {
          0%, 22%  { transform: scale(1); opacity: 1; }
          24%, 26% { transform: scale(0.97); opacity: 0.8; }
          28%, 100%{ transform: scale(1); opacity: 1; }
        }

        /* Frame 2: focus rings sequentially light up the 3 fields */
        .cf-illustration .cf-focus-1 { opacity: 0; animation: cf-focus-1 16s ease-in-out forwards; }
        .cf-illustration .cf-focus-2 { opacity: 0; animation: cf-focus-2 16s ease-in-out forwards; }
        .cf-illustration .cf-focus-3 { opacity: 0; animation: cf-focus-3 16s ease-in-out forwards; }
        @keyframes cf-focus-1 {
          0%, 38%  { opacity: 0; }
          41%, 47% { opacity: 0.85; }
          50%, 100% { opacity: 0; }
        }
        @keyframes cf-focus-2 {
          0%, 47%  { opacity: 0; }
          50%, 56% { opacity: 0.85; }
          59%, 100% { opacity: 0; }
        }
        @keyframes cf-focus-3 {
          0%, 56%  { opacity: 0; }
          59%, 64% { opacity: 0.85; }
          67%, 100% { opacity: 0; }
        }

        /* Frame 2 calendar pulses */
        .cf-illustration .cf-cal-closing {
          animation: cf-cal-closing 16s ease-in-out forwards;
          transform-origin: center; transform-box: fill-box;
        }
        @keyframes cf-cal-closing {
          0%, 50%  { transform: scale(1); }
          54%, 56% { transform: scale(1.15); }
          60%, 100% { transform: scale(1); }
        }
        .cf-illustration .cf-cal-pay {
          animation: cf-cal-pay 16s ease-in-out forwards;
          transform-origin: center; transform-box: fill-box;
        }
        @keyframes cf-cal-pay {
          0%, 56%  { transform: scale(1); }
          60%, 62% { transform: scale(1.15); }
          66%, 100% { transform: scale(1); }
        }

        /* Frame 3: line + drops + dot */
        .cf-illustration .cf-line {
          stroke-dasharray: 480;
          stroke-dashoffset: 480;
          animation: cf-line 16s ease-out forwards;
        }
        @keyframes cf-line {
          0%, 71%  { stroke-dashoffset: 480; }
          84%, 100% { stroke-dashoffset: 0; }
        }
        .cf-illustration .cf-drop-1, .cf-illustration .cf-drop-2 { opacity: 0; }
        .cf-illustration .cf-drop-1 { animation: cf-drop-1 16s ease-out forwards; }
        .cf-illustration .cf-drop-2 { animation: cf-drop-2 16s ease-out forwards; }
        @keyframes cf-drop-1 { 0%, 84% { opacity: 0; } 88%, 100% { opacity: 1; } }
        @keyframes cf-drop-2 { 0%, 90% { opacity: 0; } 94%, 100% { opacity: 1; } }
        .cf-illustration .cf-dot { opacity: 0; animation: cf-dot 16s ease-out forwards; }
        @keyframes cf-dot { 0%, 92% { opacity: 0; } 96%, 100% { opacity: 1; } }

        @media (prefers-reduced-motion: reduce) {
          .cf-illustration * { animation: none !important; opacity: 1; transform: none !important; stroke-dashoffset: 0 !important; }
          .cf-illustration .cf-frame-1, .cf-illustration .cf-frame-2 { display: none; }
        }
      `}</style>
    </svg>
  );
}
