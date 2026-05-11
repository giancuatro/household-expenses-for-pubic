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

type ParserId = "amex" | "amex-pdf" | "generic";

export default function ImportClient({ paymentMethods }: Props) {
  const router = useRouter();
  const [pmId, setPmId] = useState(paymentMethods[0]?.id ?? "");
  const [parser, setParser] = useState<ParserId>("amex");
  const [file, setFile] = useState<File | null>(null);
  const [genericCols, setGenericCols] = useState({ date: 0, amount: 1, merchant: 2 });
  const [skipHeader, setSkipHeader] = useState(1);
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
        parser,
        filename: file.name,
        fileBase64,
        ...(parser === "generic"
          ? { columns: genericCols, skipHeaderRows: skipHeader }
          : {}),
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">支払方法</span>
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
            <span className="text-sm font-medium">パーサ</span>
            <select
              className="input"
              value={parser}
              onChange={(e) => setParser(e.target.value as ParserId)}
            >
              <option value="amex">American Express（CSV 明細）</option>
              <option value="amex-pdf">American Express（PDF 明細）</option>
              <option value="generic">汎用（列を指定 / CSV）</option>
            </select>
          </label>
        </div>

        {parser === "generic" && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              CSV の何列目に何が入っているか、0始まりで指定してください。先頭ヘッダ行は除外できます。
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="text-xs space-y-1">
                <span>日付列</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  className="input"
                  value={genericCols.date}
                  onChange={(e) => setGenericCols((c) => ({ ...c, date: Number(e.target.value) }))}
                />
              </label>
              <label className="text-xs space-y-1">
                <span>金額列</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  className="input"
                  value={genericCols.amount}
                  onChange={(e) => setGenericCols((c) => ({ ...c, amount: Number(e.target.value) }))}
                />
              </label>
              <label className="text-xs space-y-1">
                <span>店名列</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  className="input"
                  value={genericCols.merchant}
                  onChange={(e) => setGenericCols((c) => ({ ...c, merchant: Number(e.target.value) }))}
                />
              </label>
              <label className="text-xs space-y-1">
                <span>ヘッダ行数</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  className="input"
                  value={skipHeader}
                  onChange={(e) => setSkipHeader(Number(e.target.value))}
                />
              </label>
            </div>
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-sm font-medium">
            {parser === "amex-pdf" ? "PDF ファイル" : "CSV ファイル"}
          </span>
          <input
            type="file"
            accept={
              parser === "amex-pdf"
                ? ".pdf,application/pdf"
                : ".csv,text/csv,application/vnd.ms-excel"
            }
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
            className="block w-full text-sm"
          />
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
