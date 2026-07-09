-- Perf: composite index for household+date scans, index for reconcile joins,
-- and a DB-side monthly rollup so the dashboard no longer transfers every row.

create index if not exists idx_txn_household_date
  on transactions (household_id, date desc);

create index if not exists idx_sct_matched_txn
  on staging_card_transactions (matched_transaction_id);

-- Monthly totals per (20-day cycle month, category_type, category). The cycle
-- rule mirrors format.ts#monthKey: day < 20 stays in the calendar month, day >=
-- 20 rolls into the next month. Advance payments are excluded (they net out).
create or replace function txn_monthly_rollup(p_household_id uuid)
returns table (ym text, category_type text, category_id uuid, total bigint, cnt bigint)
language sql
security invoker
set search_path = public
as $$
  select
    case when extract(day from date) < 20
         then to_char(date, 'YYYY-MM')
         else to_char(date + interval '1 month', 'YYYY-MM') end as ym,
    category_type,
    category_id,
    sum(amount)::bigint as total,
    count(*)::bigint as cnt
  from transactions
  where household_id = p_household_id
    and is_advance_payment = false
  group by 1, 2, 3
$$;

-- Service-role only: reads go through the admin client, never PostgREST.
revoke execute on function txn_monthly_rollup(uuid) from anon, authenticated;
