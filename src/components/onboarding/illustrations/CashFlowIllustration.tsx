"use client";

import { useEffect, useRef } from "react";

/**
 * Animated illustration for the combined "現金スナップ + クレカ + CF予測" slide.
 *
 * 3-frame sequence that crossfades:
 *   Frame 1: settings → 現金残高 form. Balance ticks ¥0 → ¥300,000.
 *   Frame 2: settings → 支払方法 form. Closing day 15, payment day 27.
 *   Frame 3: dashboard → キャッシュフロー予測. 60-day chart with a
 *            visible step-down at the credit-card payment day.
 *
 * Loops every ~9s.
 */
export function CashFlowIllustration() {
  const balanceRef = useRef<SVGTSpanElement | null>(null);

  // Animate the balance number during frame 1 (~0–2.5s of each cycle).
  useEffect(() => {
    const cycle = 9000;
    const fillStart = 700;
    const fillEnd = 2200;
    const target = 300_000;
    let raf = 0;
    function tick(now: number) {
      const t = now % cycle;
      if (!balanceRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (t < fillStart) {
        balanceRef.current.textContent = "0";
      } else if (t < fillEnd) {
        const p = (t - fillStart) / (fillEnd - fillStart);
        const eased = 1 - Math.pow(1 - p, 3);
        balanceRef.current.textContent = Math.round(target * eased).toLocaleString("ja-JP");
      } else {
        balanceRef.current.textContent = target.toLocaleString("ja-JP");
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
      className="w-full h-auto cf-illustration"
      role="img"
      aria-label="現金残高を登録 → クレカの締め日と支払日を設定 → 60 日先までのキャッシュフロー予測が見える流れ"
    >
      <rect x="8" y="8" width="304" height="224" rx="14" fill="hsl(var(--muted))" opacity="0.4" />

      {/* Step indicator */}
      <g className="cf-steps">
        <circle cx="120" cy="22" r="7" className="cf-step-1" />
        <text x="120" y="26" fontSize="9" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="white">1</text>
        <line x1="129" y1="22" x2="151" y2="22" stroke="hsl(var(--border))" strokeWidth="2" />
        <circle cx="160" cy="22" r="7" className="cf-step-2" />
        <text x="160" y="26" fontSize="9" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="white">2</text>
        <line x1="169" y1="22" x2="191" y2="22" stroke="hsl(var(--border))" strokeWidth="2" />
        <circle cx="200" cy="22" r="7" className="cf-step-3" />
        <text x="200" y="26" fontSize="9" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="white">3</text>
      </g>

      {/* Frame 1: Cash snapshot form */}
      <g className="cf-frame cf-frame-1">
        <text x="20" y="56" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          設定 → 現金残高
        </text>
        <text x="20" y="80" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">日付</text>
        <rect x="20" y="86" width="120" height="22" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="32" y="100" fontSize="10" fontFamily="system-ui" fill="hsl(var(--foreground))">2026-05-10</text>
        <text x="20" y="124" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">残高（円）</text>
        <rect x="20" y="130" width="280" height="32" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="294" y="153" fontSize="18" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          ¥<tspan ref={balanceRef}>0</tspan>
        </text>
        <rect x="220" y="180" width="80" height="22" rx="6" fill="hsl(var(--primary))" />
        <text x="260" y="194" fontSize="11" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--primary-foreground))">残高を記録</text>
      </g>

      {/* Frame 2: Credit card setup */}
      <g className="cf-frame cf-frame-2">
        <text x="20" y="56" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          設定 → 支払方法（〇〇カード）
        </text>
        <text x="20" y="80" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">締め日</text>
        <rect x="20" y="86" width="80" height="26" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="60" y="103" fontSize="14" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">15</text>

        <text x="116" y="80" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">支払日</text>
        <rect x="116" y="86" width="80" height="26" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="156" y="103" fontSize="14" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">27</text>

        <text x="212" y="80" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">支払月</text>
        <rect x="212" y="86" width="80" height="26" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="252" y="103" fontSize="13" textAnchor="middle" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">翌月</text>

        {/* Mini calendar showing closing & payment days highlighted */}
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
          <rect x="80" y="208" width="10" height="10" fill="hsl(var(--destructive))" rx="2" />
          <text x="94" y="216" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">支払日（引落）</text>
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
        {/* gridlines */}
        <line x1="32" y1="180" x2="288" y2="180" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <line x1="32" y1="148" x2="288" y2="148" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <line x1="32" y1="116" x2="288" y2="116" stroke="hsl(var(--border))" strokeDasharray="2 3" />

        {/* y-axis labels */}
        <text x="28" y="120" fontSize="7" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">300k</text>
        <text x="28" y="152" fontSize="7" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">200k</text>
        <text x="28" y="184" fontSize="7" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">100k</text>

        {/* CF line with step-downs at credit card payment days */}
        <path
          d="M 32 116 L 100 122 L 130 122 L 130 140 L 200 144 L 230 144 L 230 162 L 288 168"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="cf-line"
        />
        {/* drop labels */}
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
        {/* end dot */}
        <circle cx="288" cy="168" r="3.5" fill="hsl(var(--primary))" className="cf-dot" />

        <text x="32" y="220" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">5/10</text>
        <text x="288" y="220" fontSize="8" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">7/9</text>
      </g>

      <style>{`
        /* Step circles light up by phase */
        .cf-illustration .cf-step-1 { fill: hsl(var(--primary)); }
        .cf-illustration .cf-step-2 { fill: hsl(var(--muted-foreground)); animation: cf-step-2 9s ease-in-out infinite; }
        .cf-illustration .cf-step-3 { fill: hsl(var(--muted-foreground)); animation: cf-step-3 9s ease-in-out infinite; }
        @keyframes cf-step-2 {
          0%, 28% { fill: hsl(var(--muted-foreground)); }
          33%, 100% { fill: hsl(var(--primary)); }
        }
        @keyframes cf-step-3 {
          0%, 60% { fill: hsl(var(--muted-foreground)); }
          65%, 100% { fill: hsl(var(--primary)); }
        }

        /* Frames cross-fade */
        .cf-illustration .cf-frame { opacity: 0; }
        .cf-illustration .cf-frame-1 { animation: cf-frame-1 9s ease-in-out infinite; }
        .cf-illustration .cf-frame-2 { animation: cf-frame-2 9s ease-in-out infinite; }
        .cf-illustration .cf-frame-3 { animation: cf-frame-3 9s ease-in-out infinite; }
        @keyframes cf-frame-1 {
          0%, 27%   { opacity: 1; }
          33%, 100% { opacity: 0; }
        }
        @keyframes cf-frame-2 {
          0%, 30%   { opacity: 0; }
          35%, 57%  { opacity: 1; }
          63%, 100% { opacity: 0; }
        }
        @keyframes cf-frame-3 {
          0%, 60%   { opacity: 0; }
          67%, 95%  { opacity: 1; }
          100%      { opacity: 0; }
        }

        /* CF line draws within frame 3 */
        .cf-illustration .cf-line {
          stroke-dasharray: 480;
          stroke-dashoffset: 480;
          animation: cf-line-draw 9s ease-out infinite;
        }
        @keyframes cf-line-draw {
          0%, 67%   { stroke-dashoffset: 480; }
          85%, 100% { stroke-dashoffset: 0; }
        }
        .cf-illustration .cf-drop-1, .cf-illustration .cf-drop-2 { opacity: 0; }
        .cf-illustration .cf-drop-1 { animation: cf-drop-1 9s ease-out infinite; }
        .cf-illustration .cf-drop-2 { animation: cf-drop-2 9s ease-out infinite; }
        @keyframes cf-drop-1 {
          0%, 78%   { opacity: 0; }
          84%, 100% { opacity: 1; }
        }
        @keyframes cf-drop-2 {
          0%, 86%   { opacity: 0; }
          90%, 100% { opacity: 1; }
        }
        .cf-illustration .cf-dot { opacity: 0; animation: cf-dot 9s ease-out infinite; }
        @keyframes cf-dot {
          0%, 88%   { opacity: 0; }
          92%, 100% { opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .cf-illustration * { animation: none !important; opacity: 1; transform: none !important; stroke-dashoffset: 0 !important; }
          .cf-illustration .cf-frame-1, .cf-illustration .cf-frame-2 { display: none; }
        }
      `}</style>
    </svg>
  );
}
