"use client";

/**
 * Animated illustration for the "クレカ締め日・支払日" onboarding slide.
 *
 * Shows: a settings card with closing/payment day inputs, then a calendar
 * row where the closing day pulses, then a CF chart on the right with a
 * step-down at the payment day. All scoped via .cc-illustration so it
 * doesn't collide with other slides.
 */
export function CreditCardIllustration() {
  return (
    <svg
      viewBox="0 0 320 180"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto cc-illustration"
      role="img"
      aria-label="クレカの締め日と支払日を入力すると、キャッシュフロー予測に反映される様子"
    >
      <rect x="8" y="8" width="304" height="164" rx="12" fill="hsl(var(--muted))" opacity="0.4" />

      {/* Settings row */}
      <g className="cc-row-1">
        <text x="20" y="30" fontSize="11" fill="hsl(var(--muted-foreground))" fontFamily="system-ui">
          支払方法 - 〇〇カード
        </text>
        {/* closing day field */}
        <text x="20" y="48" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="system-ui">締め日</text>
        <rect x="20" y="54" width="60" height="22" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="50" y="69" fontSize="12" textAnchor="middle" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">15</text>
        {/* payment day field */}
        <text x="92" y="48" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="system-ui">支払日</text>
        <rect x="92" y="54" width="60" height="22" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="122" y="69" fontSize="12" textAnchor="middle" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">27</text>
      </g>

      {/* Calendar (mini) */}
      <g className="cc-cal">
        <rect x="20" y="92" width="132" height="68" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="28" y="105" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="system-ui">5月</text>
        {/* 7×3 grid of small day cells */}
        {(() => {
          const cells = [] as React.ReactNode[];
          let day = 1;
          for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 7; c++) {
              const x = 28 + c * 17;
              const y = 112 + r * 14;
              const closing = day === 15;
              const pay = day === 27;
              cells.push(
                <g key={day}>
                  <rect
                    x={x}
                    y={y}
                    width="14"
                    height="11"
                    rx="2"
                    fill={closing ? "hsl(var(--warning))" : pay ? "hsl(var(--destructive))" : "transparent"}
                    opacity={closing || pay ? 0.85 : 1}
                    className={closing ? "cc-cell-closing" : pay ? "cc-cell-pay" : undefined}
                  />
                  <text
                    x={x + 7}
                    y={y + 8}
                    fontSize="7.5"
                    textAnchor="middle"
                    fontFamily="system-ui"
                    fill={closing || pay ? "white" : "hsl(var(--foreground))"}
                  >
                    {day}
                  </text>
                </g>,
              );
              day++;
              if (day > 31) break;
            }
            if (day > 31) break;
          }
          return cells;
        })()}
      </g>

      {/* CF chart with step-down */}
      <g className="cc-chart">
        <rect x="160" y="92" width="140" height="68" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="168" y="105" fontSize="9" fill="hsl(var(--muted-foreground))" fontFamily="system-ui">CF 予測</text>
        <line x1="168" y1="148" x2="292" y2="148" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <line x1="168" y1="135" x2="292" y2="135" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <line x1="168" y1="122" x2="292" y2="122" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <path
          d="M 168 118 L 200 118 L 222 118 L 222 138 L 260 138 L 292 138"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="cc-line"
        />
        {/* drop label */}
        <g className="cc-drop-label">
          <rect x="220" y="100" width="46" height="13" rx="3" fill="hsl(var(--destructive))" />
          <text x="243" y="110" fontSize="9" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="white">
            -¥50,000
          </text>
        </g>
      </g>

      <style>{`
        .cc-illustration .cc-row-1 { animation: cc-fade 0.4s ease-out both; }
        .cc-illustration .cc-cal { animation: cc-fade 0.4s ease-out 0.4s both; }
        .cc-illustration .cc-chart { animation: cc-fade 0.4s ease-out 0.7s both; }
        .cc-illustration .cc-cell-closing { animation: cc-pulse 1.4s ease-in-out 1.0s 2; transform-origin: center; transform-box: fill-box; }
        .cc-illustration .cc-cell-pay { animation: cc-pulse 1.4s ease-in-out 1.6s 2; transform-origin: center; transform-box: fill-box; }
        .cc-illustration .cc-line {
          stroke-dasharray: 240;
          stroke-dashoffset: 240;
          animation: cc-draw 1.4s ease-out 1.0s forwards;
        }
        .cc-illustration .cc-drop-label { opacity: 0; animation: cc-fade 0.3s ease-out 2.4s forwards; }
        @keyframes cc-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cc-draw { to { stroke-dashoffset: 0; } }
        @keyframes cc-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.25); } }
        @media (prefers-reduced-motion: reduce) {
          .cc-illustration * { animation: none !important; opacity: 1; transform: none; stroke-dashoffset: 0; }
        }
      `}</style>
    </svg>
  );
}
