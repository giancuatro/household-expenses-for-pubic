"use client";

/**
 * Animated illustration for "世帯で共有する家計簿" onboarding slide.
 *
 * Shows three transaction rows side-by-side colored by kind, then a
 * summary band at the bottom showing each member's net balance and
 * the household-wide net.
 *
 * Phases:
 *   1. Rows fade in with their respective color tags (共同 / 個人 / 立替).
 *   2. The 立替 row pulses, gets a 🔄 marker, then a "精算済み" tick
 *      appears next to it.
 *   3. The bottom summary band slides up with each user's net.
 */
export function HouseholdSharingIllustration() {
  return (
    <svg
      viewBox="0 0 320 240"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto sh-illustration"
      role="img"
      aria-label="世帯メンバーの取引が共同・個人・立替に分類され、それぞれの収支が集計される様子"
    >
      <rect x="8" y="8" width="304" height="224" rx="14" fill="hsl(var(--muted))" opacity="0.4" />

      <text x="20" y="28" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
        取引一覧
      </text>

      {/* Row 1: 共同 (variable) — Member A paid 食費 1,200 */}
      <g className="sh-row sh-row-1">
        <text x="20" y="50" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">5/10</text>
        <rect x="42" y="40" width="46" height="14" rx="7" fill="hsl(var(--primary))" opacity="0.18" />
        <text x="65" y="50" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--primary))" fontWeight="600">
          メンバーA
        </text>
        <rect x="92" y="40" width="36" height="14" rx="7" fill="hsl(var(--success))" opacity="0.18" />
        <text x="110" y="50" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--success))" fontWeight="600">食費</text>
        <rect x="132" y="40" width="32" height="14" rx="7" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="148" y="50" fontSize="8" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">共同</text>
        <text x="294" y="50" fontSize="11" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">¥1,200</text>
      </g>

      {/* Row 2: 個人 — Member B paid for self 1,800 */}
      <g className="sh-row sh-row-2">
        <text x="20" y="74" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">5/9</text>
        <rect x="42" y="64" width="46" height="14" rx="7" fill="hsl(var(--success))" opacity="0.18" />
        <text x="65" y="74" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--success))" fontWeight="600">メンバーB</text>
        <rect x="92" y="64" width="44" height="14" rx="7" fill="hsl(var(--accent))" />
        <text x="114" y="74" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">個人支出</text>
        <rect x="140" y="64" width="32" height="14" rx="7" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="156" y="74" fontSize="8" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">個人</text>
        <text x="294" y="74" fontSize="11" textAnchor="end" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--muted-foreground))">¥1,800</text>
      </g>

      {/* Row 3: 立替 — Member A paid Member B's share, 4,000 */}
      <g className="sh-row sh-row-3">
        <text x="20" y="98" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">5/8</text>
        <rect x="42" y="88" width="46" height="14" rx="7" fill="hsl(var(--primary))" opacity="0.18" />
        <text x="65" y="98" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--primary))" fontWeight="600">
          メンバーA
        </text>
        <text x="94" y="98" fontSize="11" fontFamily="system-ui">🔄</text>
        <rect x="106" y="88" width="34" height="14" rx="7" fill="hsl(var(--warning))" opacity="0.22" className="sh-advance-chip" />
        <text x="123" y="98" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--warning))" fontWeight="700">立替</text>
        <text x="294" y="98" fontSize="11" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">¥4,000</text>
        {/* Settled tick — appears after the row */}
        <g className="sh-settled">
          <rect x="220" y="106" width="74" height="14" rx="7" fill="hsl(var(--success))" opacity="0.18" />
          <text x="232" y="116" fontSize="9" fontFamily="system-ui" fill="hsl(var(--success))" fontWeight="700">✓ 精算済み</text>
        </g>
      </g>

      {/* Divider */}
      <line x1="20" y1="138" x2="300" y2="138" stroke="hsl(var(--border))" strokeDasharray="2 3" />

      {/* Summary cards: 2 user cards + 1 household-net card */}
      <g className="sh-summary">
        <text x="20" y="155" fontSize="10" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">今月の収支</text>

        {/* Card: Member A */}
        <rect x="20" y="164" width="86" height="58" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <rect x="20" y="164" width="3" height="58" fill="hsl(var(--primary))" />
        <text x="30" y="180" fontSize="9" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--primary))">メンバーA</text>
        <text x="30" y="195" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">支出</text>
        <text x="100" y="195" fontSize="9" textAnchor="end" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">¥5,200</text>
        <text x="30" y="208" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">立替差</text>
        <text x="100" y="208" fontSize="9" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--success))">+¥4,000</text>

        {/* Card: Member B */}
        <rect x="116" y="164" width="86" height="58" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <rect x="116" y="164" width="3" height="58" fill="hsl(var(--success))" />
        <text x="126" y="180" fontSize="9" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--success))">メンバーB</text>
        <text x="126" y="195" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">支出</text>
        <text x="196" y="195" fontSize="9" textAnchor="end" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">¥1,800</text>
        <text x="126" y="208" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">立替差</text>
        <text x="196" y="208" fontSize="9" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--destructive))">-¥4,000</text>

        {/* Card: 共同合計 */}
        <rect x="212" y="164" width="86" height="58" rx="8" fill="hsl(var(--primary))" opacity="0.10" stroke="hsl(var(--primary))" />
        <text x="220" y="180" fontSize="9" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--primary))">共同支出</text>
        <text x="220" y="195" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">合計</text>
        <text x="292" y="195" fontSize="9" textAnchor="end" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--foreground))">¥5,200</text>
        <text x="220" y="208" fontSize="8" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">予算比</text>
        <text x="292" y="208" fontSize="9" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--success))">52%</text>
      </g>

      <style>{`
        .sh-illustration .sh-row { opacity: 0; transform: translateX(-6px); }
        .sh-illustration .sh-row-1 { animation: sh-row-in 6s ease-out infinite both; animation-delay: 0s; }
        .sh-illustration .sh-row-2 { animation: sh-row-in 6s ease-out infinite both; animation-delay: 0s; }
        .sh-illustration .sh-row-3 { animation: sh-row-in 6s ease-out infinite both; animation-delay: 0s; }
        .sh-illustration .sh-advance-chip { animation: sh-pulse 6s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
        .sh-illustration .sh-settled { opacity: 0; animation: sh-settled 6s ease-out infinite; }
        .sh-illustration .sh-summary { opacity: 0; transform: translateY(6px); animation: sh-summary 6s ease-out infinite; }

        @keyframes sh-row-in {
          0%       { opacity: 0; transform: translateX(-6px); }
          16%      { opacity: 1; transform: translateX(0); }
          100%     { opacity: 1; transform: translateX(0); }
        }
        /* stagger via different delays */
        .sh-illustration .sh-row-2 { animation-delay: 0.4s !important; }
        .sh-illustration .sh-row-3 { animation-delay: 0.8s !important; }

        @keyframes sh-pulse {
          0%, 30%, 50%, 100% { transform: scale(1); opacity: 0.22; }
          38%, 42%           { transform: scale(1.05); opacity: 0.45; }
        }
        @keyframes sh-settled {
          0%, 50%  { opacity: 0; transform: translateX(8px); }
          58%      { opacity: 1; transform: translateX(0); }
          100%     { opacity: 1; transform: translateX(0); }
        }
        @keyframes sh-summary {
          0%, 64%  { opacity: 0; transform: translateY(6px); }
          74%      { opacity: 1; transform: translateY(0); }
          100%     { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .sh-illustration * { animation: none !important; opacity: 1; transform: none !important; }
        }
      `}</style>
    </svg>
  );
}
