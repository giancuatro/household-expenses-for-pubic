"use client";

/**
 * Animated illustration for the "ダッシュボード" onboarding slide.
 *
 * Shows a 2×2 grid of mini-charts that mirror what /dashboard actually
 * renders:
 *   - Monthly income/expense/net bars
 *   - Category breakdown donut
 *   - Asset trend line
 *   - Budget achievement heatmap
 *
 * Each card animates in sequentially over ~5s, then loops.
 */
export function DashboardIllustration() {
  return (
    <svg
      viewBox="0 0 320 240"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto db-illustration"
      role="img"
      aria-label="ダッシュボードで月別収支、カテゴリ別、資産推移、予算ヒートマップなど複数のチャートを確認できる様子"
    >
      <rect x="8" y="8" width="304" height="224" rx="14" fill="hsl(var(--muted))" opacity="0.4" />

      <text x="20" y="28" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
        ダッシュボード
      </text>

      {/* Top-left: monthly income/expense bars */}
      <g className="db-card db-card-1">
        <rect x="20" y="40" width="138" height="86" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="28" y="54" fontSize="8.5" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          月別 収入・支出
        </text>
        <line x1="28" y1="116" x2="148" y2="116" stroke="hsl(var(--border))" />
        {[0, 1, 2, 3, 4].map((i) => {
          const x = 32 + i * 22;
          const incomeH = [22, 26, 24, 28, 30][i];
          const expenseH = [18, 20, 22, 19, 24][i];
          return (
            <g key={i}>
              <rect
                x={x}
                y={116 - incomeH}
                width="8"
                height={incomeH}
                fill="hsl(var(--success))"
                opacity="0.85"
                className="db-bar"
                style={{ animationDelay: `${0.4 + i * 0.08}s` } as React.CSSProperties}
              />
              <rect
                x={x + 9}
                y={116 - expenseH}
                width="8"
                height={expenseH}
                fill="hsl(var(--primary))"
                opacity="0.85"
                className="db-bar"
                style={{ animationDelay: `${0.5 + i * 0.08}s` } as React.CSSProperties}
              />
            </g>
          );
        })}
      </g>

      {/* Top-right: category donut */}
      <g className="db-card db-card-2">
        <rect x="162" y="40" width="138" height="86" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="170" y="54" fontSize="8.5" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          カテゴリ別 割合
        </text>
        {/* donut arcs */}
        <g transform="translate(202, 92)" className="db-donut">
          <circle r="22" fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
          <circle r="22" fill="none" stroke="hsl(var(--primary))" strokeWidth="10"
            strokeDasharray="55 200" strokeDashoffset="0" transform="rotate(-90)" className="db-arc" />
          <circle r="22" fill="none" stroke="hsl(var(--success))" strokeWidth="10"
            strokeDasharray="35 200" strokeDashoffset="-55" transform="rotate(-90)" className="db-arc" />
          <circle r="22" fill="none" stroke="hsl(var(--warning))" strokeWidth="10"
            strokeDasharray="25 200" strokeDashoffset="-90" transform="rotate(-90)" className="db-arc" />
          <circle r="22" fill="none" stroke="hsl(var(--destructive))" strokeWidth="10"
            strokeDasharray="22 200" strokeDashoffset="-115" transform="rotate(-90)" className="db-arc" />
        </g>
        {/* legend */}
        <g fontFamily="system-ui" fontSize="7.5" fill="hsl(var(--muted-foreground))">
          <rect x="248" y="58" width="6" height="6" fill="hsl(var(--primary))" rx="1" />
          <text x="258" y="64">食費</text>
          <rect x="248" y="70" width="6" height="6" fill="hsl(var(--success))" rx="1" />
          <text x="258" y="76">外食</text>
          <rect x="248" y="82" width="6" height="6" fill="hsl(var(--warning))" rx="1" />
          <text x="258" y="88">移動</text>
          <rect x="248" y="94" width="6" height="6" fill="hsl(var(--destructive))" rx="1" />
          <text x="258" y="100">日用</text>
        </g>
      </g>

      {/* Bottom-left: asset trend line */}
      <g className="db-card db-card-3">
        <rect x="20" y="134" width="138" height="86" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="28" y="148" fontSize="8.5" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          資産推移
        </text>
        <line x1="28" y1="208" x2="148" y2="208" stroke="hsl(var(--border))" />
        <line x1="28" y1="190" x2="148" y2="190" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <line x1="28" y1="172" x2="148" y2="172" stroke="hsl(var(--border))" strokeDasharray="2 3" />
        <path
          d="M 28 198 L 50 192 L 72 188 L 94 182 L 116 174 L 138 168 L 148 164"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="db-line"
        />
        <text x="148" y="160" fontSize="8" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--success))">
          +12%
        </text>
      </g>

      {/* Bottom-right: budget heatmap */}
      <g className="db-card db-card-4">
        <rect x="162" y="134" width="138" height="86" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="170" y="148" fontSize="8.5" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          予算達成率
        </text>
        {(() => {
          const months = ["12", "1", "2", "3", "4", "5"];
          const cats = ["食費", "外食", "移動", "日用"];
          const cells: React.ReactNode[] = [];
          // 4 rows × 6 cols heatmap, hard-coded ratios for visual variety
          const ratios = [
            [0.7, 0.8, 0.9, 1.05, 0.85, 0.95], // 食費
            [0.5, 0.6, 0.95, 0.7, 0.88, 0.9], // 外食
            [0.6, 0.55, 0.7, 0.8, 0.65, 0.75], // 移動
            [0.4, 0.5, 1.1, 0.6, 0.7, 1.05], // 日用
          ];
          for (let r = 0; r < 4; r++) {
            cells.push(
              <text
                key={`l${r}`}
                x="172"
                y={166 + r * 12}
                fontSize="7"
                fontFamily="system-ui"
                fill="hsl(var(--muted-foreground))"
              >
                {cats[r]}
              </text>,
            );
            for (let c = 0; c < 6; c++) {
              const ratio = ratios[r][c];
              const fill = ratio > 1
                ? "hsl(var(--destructive))"
                : ratio > 0.85
                ? "hsl(var(--warning))"
                : ratio > 0.6
                ? "hsl(var(--success))"
                : "hsl(var(--primary))";
              const op = 0.30 + Math.min(1, ratio) * 0.55;
              cells.push(
                <rect
                  key={`${r}-${c}`}
                  x={194 + c * 16}
                  y={158 + r * 12}
                  width="14"
                  height="10"
                  rx="2"
                  fill={fill}
                  opacity={op}
                  className="db-cell"
                  style={{ animationDelay: `${0.8 + (r * 6 + c) * 0.03}s` } as React.CSSProperties}
                />,
              );
            }
          }
          // x labels
          for (let c = 0; c < 6; c++) {
            cells.push(
              <text
                key={`x${c}`}
                x={201 + c * 16}
                y="216"
                fontSize="6.5"
                textAnchor="middle"
                fontFamily="system-ui"
                fill="hsl(var(--muted-foreground))"
              >
                {months[c]}
              </text>,
            );
          }
          return cells;
        })()}
      </g>

      <style>{`
        .db-illustration .db-card { opacity: 0; transform: translateY(6px); }
        .db-illustration .db-card-1 { animation: db-card 6s ease-out 0.1s infinite both; }
        .db-illustration .db-card-2 { animation: db-card 6s ease-out 0.5s infinite both; }
        .db-illustration .db-card-3 { animation: db-card 6s ease-out 1.5s infinite both; }
        .db-illustration .db-card-4 { animation: db-card 6s ease-out 1.9s infinite both; }
        .db-illustration .db-bar { transform-origin: bottom; transform: scaleY(0); animation: db-bar 6s ease-out infinite both; }
        .db-illustration .db-arc { stroke-dasharray: 0 200; animation: db-arc 6s ease-out infinite both; }
        .db-illustration .db-card-2 .db-arc:nth-child(2) { animation-delay: 0.7s; stroke-dasharray: 55 200; }
        .db-illustration .db-card-2 .db-arc:nth-child(3) { animation-delay: 0.85s; stroke-dasharray: 35 200; }
        .db-illustration .db-card-2 .db-arc:nth-child(4) { animation-delay: 1.0s; stroke-dasharray: 25 200; }
        .db-illustration .db-card-2 .db-arc:nth-child(5) { animation-delay: 1.15s; stroke-dasharray: 22 200; }
        .db-illustration .db-line {
          stroke-dasharray: 200;
          stroke-dashoffset: 200;
          animation: db-line 6s ease-out 1.7s infinite both;
        }
        .db-illustration .db-cell { transform-origin: center; transform: scale(0.6); animation: db-cell 6s ease-out infinite both; }

        @keyframes db-card {
          0%, 8%   { opacity: 0; transform: translateY(6px); }
          18%      { opacity: 1; transform: translateY(0); }
          100%     { opacity: 1; transform: translateY(0); }
        }
        @keyframes db-bar {
          0%, 8%   { transform: scaleY(0); }
          25%      { transform: scaleY(1); }
          100%     { transform: scaleY(1); }
        }
        @keyframes db-arc {
          0%, 12%  { stroke-dashoffset: 200; }
          25%      { stroke-dashoffset: 0; }
          100%     { stroke-dashoffset: 0; }
        }
        @keyframes db-line {
          0%, 8%   { stroke-dashoffset: 200; }
          30%      { stroke-dashoffset: 0; }
          100%     { stroke-dashoffset: 0; }
        }
        @keyframes db-cell {
          0%, 12%  { transform: scale(0.6); opacity: 0; }
          25%      { transform: scale(1); opacity: 0.7; }
          100%     { transform: scale(1); opacity: 0.7; }
        }

        @media (prefers-reduced-motion: reduce) {
          .db-illustration * { animation: none !important; opacity: 1; transform: none !important; stroke-dashoffset: 0 !important; }
        }
      `}</style>
    </svg>
  );
}
