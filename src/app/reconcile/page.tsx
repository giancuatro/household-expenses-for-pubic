import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase/server";
import { listAllPaymentMethods, listUsers } from "@/lib/queries";
import ImportClient from "./ImportClient";

export const dynamic = "force-dynamic";

interface ImportRow {
  id: string;
  payment_method_id: string;
  parser: string;
  source_filename: string | null;
  period_start: string | null;
  period_end: string | null;
  row_count: number;
  imported_at: string;
  archived_at: string | null;
}

export default async function ReconcileIndexPage() {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();

  const [paymentMethods, users, importsRes] = await Promise.all([
    listAllPaymentMethods(hid).catch(() => []),
    listUsers(hid),
    sb
      .from("card_statement_imports")
      .select("id, payment_method_id, parser, source_filename, period_start, period_end, row_count, imported_at, archived_at")
      .eq("household_id", hid)
      .order("imported_at", { ascending: false })
      .limit(30),
  ]);

  const imports = (importsRes.data ?? []) as ImportRow[];
  const cardPMs = paymentMethods.filter((pm) => pm.type === "credit_card" && !pm.archived);
  const pmById = new Map(paymentMethods.map((pm) => [pm.id, pm.name]));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">クレカ明細の突合</h1>
        <p className="text-sm text-muted-foreground">
          カードの月次明細 CSV をアップロードすると、家計簿との差分（漏れ・重複）を確認・補正できます。
        </p>
      </header>

      <ImportClient paymentMethods={cardPMs} users={users} />

      <section className="card">
        <h2 className="font-semibold mb-3">過去のインポート</h2>
        {imports.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだインポートはありません。</p>
        ) : (
          <ul className="divide-y divide-border">
            {imports.map((imp) => (
              <li key={imp.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {pmById.get(imp.payment_method_id) ?? "(支払方法未指定)"}{" "}
                    <span className="text-xs text-muted-foreground">/ {formatFormatLabel(imp.parser)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {imp.period_start ?? "?"} 〜 {imp.period_end ?? "?"} ・ {imp.row_count} 件 ・{" "}
                    {new Date(imp.imported_at).toLocaleString("ja-JP")}
                    {imp.archived_at && <span className="ml-2 text-amber-600">アーカイブ済</span>}
                  </div>
                </div>
                <Link href={`/reconcile/${imp.id}`} className="btn-secondary text-sm shrink-0">
                  突合する
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Render the internal parser id (csv-auto / pdf-auto) as a friendly format label. */
function formatFormatLabel(id: string): string {
  if (id === "pdf-auto") return "PDF";
  if (id === "csv-auto") return "CSV";
  // Legacy ids from earlier imports.
  if (id === "amex" || id === "generic") return "CSV";
  if (id === "amex-pdf") return "PDF";
  return id;
}
