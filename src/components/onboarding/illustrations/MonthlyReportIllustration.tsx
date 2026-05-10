"use client";

/**
 * Animated illustration for the "月次レポート" onboarding slide.
 *
 * Shows a stylized version of the real /report page:
 *   1. Month selector at the top.
 *   2. 共同出費 table — rows for each category with spent / budget / remaining.
 *      Budget bars fill in left-to-right as values appear.
 *   3. 収支集計 (income / expense / net) bottom card slides in.
 */
export function MonthlyReportIllustration() {
  const ROWS = [
    { name: "食費",     spent: 38000, budget: 40000 },
    { name: "外食費",   spent: 22000, budget: 25000 },
    { name: "移動",     spent: 15000, budget: 20000 },
    { name: "日用品",   spent: 11200, budget: 10000 }, // over-budget
  ];

  return (
    <svg
      viewBox="0 0 320 240"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto rep-illustration"
      role="img"
      aria-label="月次レポート画面で、各カテゴリの予算と支出が表として一覧表示される様子"
    >
      <rect x="8" y="8" width="304" height="224" rx="14" fill="hsl(var(--muted))" opacity="0.4" />

      {/* Month nav */}
      <g className="rep-header">
        <text x="20" y="28" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          月次レポート
        </text>
        <rect x="200" y="18" width="92" height="16" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="246" y="29" fontSize="9" textAnchor="middle" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">
          ◀ 2026-05 ▶
        </text>
      </g>

      {/* 共同出費 table */}
      <g className="rep-table">
        <text x="20" y="50" fontSize="10" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          共同出費
        </text>
        <line x1="20" y1="56" x2="300" y2="56" stroke="hsl(var(--border))" />

        {/* Column headers */}
        <text x="20" y="68" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">項目</text>
        <text x="170" y="68" fontSize="8" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">支出</text>
        <text x="220" y="68" fontSize="8" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">予算</text>
        <text x="296" y="68" fontSize="8" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">残額</text>

        {ROWS.map((r, i) => {
          const y = 86 + i * 22;
          const overBudget = r.spent > r.budget;
          const remaining = r.budget - r.spent;
          const barW = Math.min(1, r.spent / r.budget) * 100;
          return (
            <g key={r.name} className={`rep-row rep-row-${i}`}>
              <text x="20" y={y} fontSize="9" fontFamily="system-ui" fill="hsl(var(--foreground))">
                {r.name}
              </text>
              {/* Budget bar */}
              <rect x="60" y={y - 9} width="100" height="10" rx="3" fill="hsl(var(--muted))" />
              <rect
                x="60"
                y={y - 9}
                height="10"
                rx="3"
                width={barW}
                fill={overBudget ? "hsl(var(--destructive))" : "hsl(var(--success))"}
                opacity="0.85"
                className="rep-bar"
              />
              <text x="170" y={y} fontSize="9" textAnchor="end" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">
                ¥{r.spent.toLocaleString("ja-JP")}
              </text>
              <text x="220" y={y} fontSize="9" textAnchor="end" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">
                ¥{r.budget.toLocaleString("ja-JP")}
              </text>
              <text
                x="296"
                y={y}
                fontSize="9"
                textAnchor="end"
                fontFamily="system-ui"
                fontWeight={overBudget ? 700 : 400}
                fill={overBudget ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))"}
              >
                {remaining < 0 ? "-" : ""}¥{Math.abs(remaining).toLocaleString("ja-JP")}
              </text>
            </g>
          );
        })}
      </g>

      {/* Bottom: 収支集計 card */}
      <g className="rep-summary">
        <rect x="20" y="180" width="280" height="46" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="30" y="194" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">収入</text>
        <text x="30" y="210" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--success))">¥520,000</text>
        <line x1="120" y1="186" x2="120" y2="220" stroke="hsl(var(--border))" />
        <text x="130" y="194" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">支出</text>
        <text x="130" y="210" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">¥386,200</text>
        <line x1="220" y1="186" x2="220" y2="220" stroke="hsl(var(--border))" />
        <text x="230" y="194" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">収支</text>
        <text x="230" y="210" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--success))">+¥133,800</text>
      </g>

      <style>{`
        .rep-illustration .rep-header { animation: rep-fade 5s ease-out infinite both; }
        .rep-illustration .rep-table { animation: rep-fade 5s ease-out 0.2s infinite both; }
        .rep-illustration .rep-row { opacity: 0; }
        .rep-illustration .rep-row-0 { animation: rep-row 5s ease-out 0.4s infinite both; }
        .rep-illustration .rep-row-1 { animation: rep-row 5s ease-out 0.7s infinite both; }
        .rep-illustration .rep-row-2 { animation: rep-row 5s ease-out 1.0s infinite both; }
        .rep-illustration .rep-row-3 { animation: rep-row 5s ease-out 1.3s infinite both; }
        .rep-illustration .rep-bar { transform-origin: left center; transform: scaleX(0); animation: rep-bar 5s ease-out infinite both; }
        .rep-illustration .rep-row-0 .rep-bar { animation-delay: 0.6s; }
        .rep-illustration .rep-row-1 .rep-bar { animation-delay: 0.9s; }
        .rep-illustration .rep-row-2 .rep-bar { animation-delay: 1.2s; }
        .rep-illustration .rep-row-3 .rep-bar { animation-delay: 1.5s; }
        .rep-illustration .rep-summary { opacity: 0; transform: translateY(6px); animation: rep-summary 5s ease-out infinite both; }

        @keyframes rep-fade {
          0%   { opacity: 0; transform: translateY(2px); }
          12%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes rep-row {
          0%   { opacity: 0; transform: translateX(-4px); }
          15%  { opacity: 1; transform: translateX(0); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes rep-bar {
          0%   { transform: scaleX(0); }
          100% { transform: scaleX(1); }
        }
        @keyframes rep-summary {
          0%, 60% { opacity: 0; transform: translateY(6px); }
          75%     { opacity: 1; transform: translateY(0); }
          100%    { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .rep-illustration * { animation: none !important; opacity: 1; transform: none !important; }
          .rep-illustration .rep-bar { transform: scaleX(1) !important; }
        }
      `}</style>
    </svg>
  );
}
