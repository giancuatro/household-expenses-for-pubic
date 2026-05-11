"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { importCardStatement } from "../actions/reconcile";
import type { PaymentMethodRow, UserRow } from "@/lib/types";

const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface Props {
  paymentMethods: PaymentMethodRow[];
  users: UserRow[];
}

export default function ImportClient({ paymentMethods }: Props) {
  const router = useRouter();
  const [pmId, setPmId] = useState(paymentMethods[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!pmId) return setErr("支払方法（クレジットカード）を登録してください。");
    if (!file) return setErr("ファイルを選択してください（CSV または PDF）。");
    if (file.size > MAX_FILE_BYTES) return setErr("ファイルサイズが上限（8MB）を超えています。");

    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const fileBase64 = arrayBufferToBase64(buf);
      const result = await importCardStatement({
        payment_method_id: pmId,
        filename: file.name,
        fileBase64,
      });
      router.push(`/reconcile/${result.importId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (paymentMethods.length === 0) {
    return (
      <section className="card">
        <h2 className="font-semibold mb-2">明細をインポート</h2>
        <p className="text-sm text-muted-foreground">
          クレジットカードの支払方法がまだ登録されていません。{" "}
          <a href="/settings" className="text-primary underline">設定 → 支払方法</a>
          {" "}から追加してください。
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="font-semibold mb-3">明細をインポート</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">クレジットカード</span>
          <select
            className="input"
            value={pmId}
            onChange={(e) => setPmId(e.target.value)}
            required
          >
            {paymentMethods.map((pm) => (
              <option key={pm.id} value={pm.id}>{pm.name}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">明細ファイル</span>
          <input
            type="file"
            accept=".csv,.pdf,text/csv,application/pdf,application/vnd.ms-excel"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
            className="block w-full text-sm"
          />
          <span className="text-[11px] text-muted-foreground">
            対応：CSV / PDF。AMEX、楽天カード、JCB、セゾン、三井住友、その他主要カードに対応。
          </span>
        </label>

        {err && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "アップロード中..." : "インポート"}
        </button>
      </form>
    </section>
  );
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(binary, "binary").toString("base64");
}
