import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase/server";
import { listAllPaymentMethods, listCategories, listUsers } from "@/lib/queries";
import ReconcileClient from "./ReconcileClient";

export const dynamic = "force-dynamic";

export default async function ReconcileDetailPage({ params }: { params: { importId: string } }) {
  const { household } = await requireSession();
  const hid = household.household_id;
  const sb = getSupabaseServer();

  const [importRes, paymentMethods, users, categories] = await Promise.all([
    sb
      .from("card_statement_imports")
      .select("*")
      .eq("household_id", hid)
      .eq("id", params.importId)
      .maybeSingle(),
    listAllPaymentMethods(hid).catch(() => []),
    listUsers(hid),
    listCategories(hid),
  ]);
  const imp = importRes.data;
  if (!imp) notFound();

  // Pull staging rows + matched txn details + the full set of unmatched txns
  // for the same payment method in a widened period so the user can also see
  // transactions that exist in the app but NOT on the statement (= 余分).
  const periodStart = (imp.period_start as string | null) ?? "1970-01-01";
  const periodEnd = (imp.period_end as string | null) ?? "9999-12-31";

  const [stagingRes, txnRes] = await Promise.all([
    sb
      .from("staging_card_transactions")
      .select("id, raw_date, raw_amount, raw_merchant, date, amount, merchant, status, match_confidence, matched_transaction_id, match_group_id")
      .eq("household_id", hid)
      .eq("import_id", params.importId)
      .order("date", { ascending: true }),
    sb
      .from("transactions")
      .select("id, date, amount, note, user_id, category_type, category_id, payment_method_id, statement_row_id")
      .eq("household_id", hid)
      .eq("payment_method_id", imp.payment_method_id)
      .gte("date", shiftDays(periodStart, -7))
      .lte("date", shiftDays(periodEnd, 7)),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/reconcile" className="hover:underline">← 一覧に戻る</Link>
      </div>
      <ReconcileClient
        importRow={imp as ImportRow}
        paymentMethods={paymentMethods}
        users={users}
        categories={categories}
        stagingRows={(stagingRes.data ?? []) as StagingRow[]}
        transactions={(txnRes.data ?? []) as TxnRow[]}
      />
    </div>
  );
}

function shiftDays(iso: string, delta: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

interface ImportRow {
  id: string;
  payment_method_id: string;
  parser: string;
  source_filename: string | null;
  period_start: string | null;
  period_end: string | null;
  row_count: number;
  imported_at: string;
}

interface StagingRow {
  id: string;
  raw_date: string | null;
  raw_amount: string | null;
  raw_merchant: string | null;
  date: string;
  amount: number;
  merchant: string | null;
  status: "unmatched" | "suggested" | "confirmed" | "ignored" | "created";
  match_confidence: number | null;
  matched_transaction_id: string | null;
  match_group_id: string | null;
}

interface TxnRow {
  id: string;
  date: string;
  amount: number;
  note: string | null;
  user_id: string;
  category_type: string;
  category_id: string | null;
  payment_method_id: string | null;
  statement_row_id: string | null;
}

export type { ImportRow, StagingRow, TxnRow };
