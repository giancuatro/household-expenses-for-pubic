"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TripRow } from "@/lib/types";
import { CURRENCIES } from "@/lib/currencyList";
import { startTrip, endTrip, updateTrip, deleteTrip } from "@/app/actions/trips";
import { toast } from "@/lib/toast";

/**
 * Trip management section embedded in /settings.
 *
 * Sections:
 *  1. Active trip card (only one can be active) — name / currency / est_rate
 *     + 「終了」 button.
 *  2. Past trips collapsible list.
 *  3. 「新しい旅行を開始」 form.
 */
export function TripSection({ trips }: { trips: TripRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const active = trips.find((t) => !t.ended_at) ?? null;
  const past = trips.filter((t) => t.ended_at);

  function refresh() {
    router.refresh();
  }
  function run(fn: () => Promise<unknown>, ok?: string) {
    return () =>
      start(async () => {
        setErr(null);
        try {
          await fn();
          if (ok) toast.success(ok);
          refresh();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setErr(msg);
          toast.error(msg);
        }
      });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">旅行モード</h2>
        <p className="text-xs text-muted-foreground">
          海外旅行中は現地通貨で記入できます。クレジットカードの明細をインポートすると、レートと円額が自動で確定します。
        </p>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {active ? (
        <ActiveTripCard
          trip={active}
          pending={pending}
          onEnd={run(() => endTrip({ id: active.id }), "旅行を終了しました")}
          onUpdate={(patch) => run(() => updateTrip({ id: active.id, ...patch }), "旅行を更新しました")()}
        />
      ) : (
        <NewTripForm pending={pending} run={run} />
      )}

      {past.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-medium">
            過去の旅行 ({past.length})
          </summary>
          <ul className="mt-3 divide-y divide-border text-sm">
            {past.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.started_at} 〜 {t.ended_at ?? "進行中"} ・ {t.default_currency} ・ {t.est_rate}¥
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-danger text-xs"
                  disabled={pending}
                  onClick={() => {
                    if (!confirm(`「${t.name}」を削除しますか？\n紐づく取引の旅行情報は外れますが、外貨情報は残ります。`)) return;
                    run(() => deleteTrip(t.id), "旅行を削除しました")();
                  }}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ActiveTripCard({
  trip,
  pending,
  onEnd,
  onUpdate,
}: {
  trip: TripRow;
  pending: boolean;
  onEnd: () => void;
  onUpdate: (patch: { name?: string; default_currency?: string; est_rate?: number }) => void;
}) {
  const [name, setName] = useState(trip.name);
  const [currency, setCurrency] = useState(trip.default_currency);
  const [rate, setRate] = useState(String(trip.est_rate));
  const dirty =
    name !== trip.name || currency !== trip.default_currency || String(trip.est_rate) !== rate;

  return (
    <div className="card space-y-3 border-primary/40 bg-primary/5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">✈️</span>
          <div>
            <div className="font-semibold">{trip.name}</div>
            <div className="text-xs text-muted-foreground">
              {trip.started_at} から進行中
            </div>
          </div>
        </div>
        <button className="btn-danger text-xs" disabled={pending} onClick={onEnd}>
          終了
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <label className="block space-y-1 col-span-2 sm:col-span-1">
          <span className="text-muted-foreground">旅行名</span>
          <input className="input text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-muted-foreground">デフォルト通貨</span>
          <select className="input text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.some((c) => c.code === currency) ? null : (
              <option value={currency}>{currency}</option>
            )}
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-muted-foreground">見積りレート ¥/{currency}</span>
          <input
            className="input text-sm"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
          />
        </label>
      </div>

      <button
        className="btn-primary text-sm w-full sm:w-auto"
        disabled={pending || !dirty}
        onClick={() =>
          onUpdate({
            name: name !== trip.name ? name : undefined,
            default_currency: currency !== trip.default_currency ? currency : undefined,
            est_rate: String(trip.est_rate) !== rate ? Number(rate) : undefined,
          })
        }
      >
        保存
      </button>
      {dirty && (
        <p className="text-[11px] text-muted-foreground">
          レートを変更すると、未確定 FX の見積り円額が再計算されます（確定済みは変わりません）。
        </p>
      )}
    </div>
  );
}

function NewTripForm({
  pending,
  run,
}: {
  pending: boolean;
  run: (fn: () => Promise<unknown>, ok?: string) => () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState("");
  const [startedAt, setStartedAt] = useState(today);
  const submit = run(
    () =>
      startTrip({
        name: name.trim(),
        default_currency: currency,
        est_rate: Number(rate),
        started_at: startedAt,
      }),
    "旅行を開始しました",
  );
  const valid = name.trim().length > 0 && Number(rate) > 0;

  return (
    <form
      className="card space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) submit();
      }}
    >
      <h3 className="font-medium">新しい旅行を開始</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <label className="block space-y-1 col-span-2">
          <span className="text-muted-foreground">旅行名</span>
          <input
            className="input text-sm"
            placeholder="例: 台湾 2026春"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="text-muted-foreground">通貨</span>
          <select className="input text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-muted-foreground">見積りレート ¥/{currency}</span>
          <input
            className="input text-sm"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="例: 4.85"
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="text-muted-foreground">開始日</span>
          <input
            type="date"
            className="input text-sm"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            required
          />
        </label>
      </div>
      <button type="submit" className="btn-primary text-sm w-full sm:w-auto" disabled={pending || !valid}>
        ✈️ 旅行モード開始
      </button>
    </form>
  );
}
