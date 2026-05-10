"use client";

import { useEffect, useRef } from "react";

/**
 * Animated illustration for the "収支を記録" onboarding slide.
 *
 * Mirrors the real flow:
 *   1. Transaction list with a floating + button.
 *   2. + button pulses, the entry sheet slides up.
 *   3. The 3-step form fills in (payer chip → amount → category chip).
 *   4. 保存 button pulses, sheet slides back down.
 *   5. A new row fades into the top of the list.
 *
 * Total cycle ~7 s, then loops.
 */
export function RecordTransactionIllustration() {
  const amountRef = useRef<SVGTSpanElement | null>(null);

  // Animate the amount number 0 → 1,200 inside the form, looping with the
  // CSS animation timeline (cycle = 7 s, amount fills during 2.0–3.0 s).
  useEffect(() => {
    const cycle = 7000;
    const fillStart = 2000;
    const fillEnd = 3000;
    const target = 1200;
    let raf = 0;
    function tick(now: number) {
      const t = (now % cycle);
      if (!amountRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (t < fillStart) {
        amountRef.current.textContent = "0";
      } else if (t < fillEnd) {
        const p = (t - fillStart) / (fillEnd - fillStart);
        const eased = 1 - Math.pow(1 - p, 3);
        amountRef.current.textContent = Math.round(target * eased).toLocaleString("ja-JP");
      } else {
        amountRef.current.textContent = target.toLocaleString("ja-JP");
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
      className="w-full h-auto rec-illustration"
      role="img"
      aria-label="プラスボタンから支出を入力すると、取引一覧に新しい行が追加される様子"
    >
      {/* Background phone frame */}
      <rect x="8" y="8" width="304" height="224" rx="14" fill="hsl(var(--muted))" opacity="0.4" />

      {/* List view (always shown beneath the sheet) */}
      <g className="rec-list">
        <text x="20" y="28" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          取引一覧
        </text>

        {/* Newly-added row (highlights on appearance) */}
        <g className="rec-new-row">
          <rect x="20" y="38" width="280" height="22" rx="6" fill="hsl(var(--primary))" opacity="0.10" />
          <text x="28" y="52" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">5/10</text>
          <rect x="50" y="42" width="32" height="14" rx="7" fill="hsl(var(--primary))" opacity="0.18" />
          <text x="66" y="52" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--primary))" fontWeight="600">
            ジャンコ
          </text>
          <rect x="86" y="42" width="40" height="14" rx="7" fill="hsl(var(--success))" opacity="0.18" />
          <text x="106" y="52" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--success))" fontWeight="600">
            食費
          </text>
          <text x="294" y="52" fontSize="11" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
            ¥1,200
          </text>
        </g>

        {/* Existing rows below */}
        {[0, 1, 2, 3].map((i) => (
          <g key={i} className="rec-old-row" style={{ animationDelay: `${i * 60}ms` } as React.CSSProperties}>
            <text x="28" y={76 + i * 22} fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">
              5/{9 - i}
            </text>
            <rect x="50" y={66 + i * 22} width="32" height="14" rx="7" fill="hsl(var(--muted))" />
            <text x="66" y={76 + i * 22} fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">
              {i % 2 === 0 ? "ひか" : "ジャンコ"}
            </text>
            <rect x="86" y={66 + i * 22} width="40" height="14" rx="7" fill="hsl(var(--muted))" />
            <text x="106" y={76 + i * 22} fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">
              {["外食", "移動", "日用品", "食費"][i]}
            </text>
            <text x="294" y={76 + i * 22} fontSize="10" textAnchor="end" fontFamily="system-ui" fontWeight="600" fill="hsl(var(--muted-foreground))">
              ¥{["3,200", "420", "880", "1,500"][i]}
            </text>
          </g>
        ))}

        {/* Floating action button */}
        <g className="rec-fab">
          <circle cx="282" cy="208" r="14" fill="hsl(var(--primary))" />
          <path d="M 274 208 L 290 208 M 282 200 L 282 216" stroke="hsl(var(--primary-foreground))" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      </g>

      {/* Entry sheet — slides up from bottom */}
      <g className="rec-sheet">
        <rect x="8" y="32" width="304" height="200" rx="14" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <rect x="148" y="40" width="24" height="3" rx="1.5" fill="hsl(var(--border))" />
        <text x="20" y="64" fontSize="11" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          支出を入力
        </text>

        {/* ① 支払い者 */}
        <text x="20" y="84" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">① 支払い者</text>
        <g className="rec-payer">
          <rect x="20" y="90" width="60" height="18" rx="9" fill="hsl(var(--primary))" className="rec-payer-active" />
          <text x="50" y="102" fontSize="9" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--primary-foreground))" fontWeight="600">
            ジャンコ
          </text>
          <rect x="86" y="90" width="60" height="18" rx="9" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
          <text x="116" y="102" fontSize="9" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">
            ひか
          </text>
        </g>

        {/* ② 金額 */}
        <text x="20" y="126" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">② 金額</text>
        <rect x="20" y="132" width="280" height="30" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
        <text x="294" y="153" fontSize="16" textAnchor="end" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--foreground))">
          ¥<tspan ref={amountRef}>0</tspan>
        </text>

        {/* ③ カテゴリ */}
        <text x="20" y="178" fontSize="9" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">③ 種類・項目</text>
        <g className="rec-cats">
          <rect x="20" y="184" width="44" height="16" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
          <text x="42" y="195" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">外食</text>
          <rect x="68" y="184" width="44" height="16" rx="8" fill="hsl(var(--success))" className="rec-cat-active" />
          <text x="90" y="195" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="white" fontWeight="600">食費</text>
          <rect x="116" y="184" width="44" height="16" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
          <text x="138" y="195" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">移動</text>
          <rect x="164" y="184" width="50" height="16" rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
          <text x="189" y="195" fontSize="8.5" textAnchor="middle" fontFamily="system-ui" fill="hsl(var(--muted-foreground))">日用品</text>
        </g>

        {/* 保存 button */}
        <rect x="220" y="208" width="80" height="20" rx="6" fill="hsl(var(--primary))" className="rec-save" />
        <text x="260" y="221" fontSize="10" textAnchor="middle" fontFamily="system-ui" fontWeight="700" fill="hsl(var(--primary-foreground))">
          保存
        </text>
      </g>

      <style>{`
        .rec-illustration .rec-list { animation: rec-list-fade 7s ease-in-out infinite; }
        .rec-illustration .rec-old-row { animation: rec-old-fade 7s ease-in-out infinite; }
        .rec-illustration .rec-new-row {
          opacity: 0;
          transform: translateY(-4px);
          animation: rec-new-row 7s ease-out infinite;
        }
        .rec-illustration .rec-fab { animation: rec-fab 7s ease-in-out infinite; transform-origin: 282px 208px; }
        .rec-illustration .rec-sheet {
          transform: translateY(220px);
          animation: rec-sheet 7s ease-in-out infinite;
        }
        .rec-illustration .rec-payer-active { animation: rec-pop 7s ease-out infinite; transform-origin: 50px 99px; transform-box: fill-box; }
        .rec-illustration .rec-cat-active { animation: rec-pop-late 7s ease-out infinite; transform-origin: 90px 192px; transform-box: fill-box; }
        .rec-illustration .rec-save { animation: rec-save-pulse 7s ease-in-out infinite; transform-origin: 260px 218px; transform-box: fill-box; }

        @keyframes rec-fab {
          0%, 8%   { transform: scale(1); opacity: 1; }
          14%      { transform: scale(1.18); }
          22%      { transform: scale(1); opacity: 0; }
          70%      { opacity: 0; }
          78%      { opacity: 1; transform: scale(1); }
          100%     { transform: scale(1); opacity: 1; }
        }
        @keyframes rec-sheet {
          0%, 14% { transform: translateY(220px); }
          22%, 60% { transform: translateY(0); }
          70%      { transform: translateY(220px); }
          100%     { transform: translateY(220px); }
        }
        @keyframes rec-pop {
          0%, 26% { transform: scale(0.6); opacity: 0; }
          32%     { transform: scale(1.12); opacity: 1; }
          40%, 60% { transform: scale(1); opacity: 1; }
          70%      { opacity: 0; }
          100%     { opacity: 0; }
        }
        @keyframes rec-pop-late {
          0%, 44% { transform: scale(0.6); opacity: 0; }
          50%     { transform: scale(1.12); opacity: 1; }
          56%, 60% { transform: scale(1); opacity: 1; }
          70%      { opacity: 0; }
          100%     { opacity: 0; }
        }
        @keyframes rec-save-pulse {
          0%, 56% { transform: scale(1); }
          60%     { transform: scale(1.06); }
          64%     { transform: scale(1); }
          100%    { transform: scale(1); }
        }
        @keyframes rec-new-row {
          0%, 78%  { opacity: 0; transform: translateY(-4px); }
          84%      { opacity: 1; transform: translateY(0); }
          100%     { opacity: 1; transform: translateY(0); }
        }
        @keyframes rec-old-fade {
          0%, 78%  { opacity: 1; }
          100%     { opacity: 1; }
        }
        @keyframes rec-list-fade {
          0%, 100% { opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .rec-illustration .rec-sheet { transform: translateY(220px); animation: none; }
          .rec-illustration .rec-list, .rec-illustration .rec-fab, .rec-illustration .rec-new-row,
          .rec-illustration .rec-payer-active, .rec-illustration .rec-cat-active, .rec-illustration .rec-save,
          .rec-illustration .rec-old-row { animation: none !important; opacity: 1; transform: none; }
        }
      `}</style>
    </svg>
  );
}
