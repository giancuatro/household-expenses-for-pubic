import { normalizeMerchant } from "@/lib/csvImport/normalize";

/**
 * Reconciliation matcher.
 *
 * For each staging card row, we score every candidate transaction in the
 * same household + payment_method window and pick the best. Only the
 * strongest match is suggested per card row, and a transaction can only
 * be claimed by one card row at a time (greedy assignment, sorted by
 * descending confidence so the strongest pairs lock in first).
 *
 * Confidence semantics (per the user's chosen UX):
 *   100 — same date AND same yen → auto-confirm
 *    < 100 — surfaced as a suggestion, never auto-applied
 *
 * The score function is deliberately simple: amount must match; date may
 * drift up to 7 days; merchant overlap adds a small bonus but is never the
 * sole match driver. A future LLM-based merchant similarity layer can plug
 * in here without changing the call sites.
 */

export interface CandidateTxn {
  id: string;
  date: string;          // YYYY-MM-DD
  amount: number;        // yen
  note: string | null;
  /** Already paired in this run — excluded from further candidates. */
  claimed?: boolean;
}

export interface CardRow {
  id: string;
  date: string;
  amount: number;
  merchant: string | null;
}

export interface MatchVerdict {
  cardRowId: string;
  matchedTxnId: string | null;
  confidence: number;    // 0..100
}

function daysBetween(a: string, b: string): number {
  const d1 = Date.parse(a + "T00:00:00Z");
  const d2 = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(d1) || Number.isNaN(d2)) return 9999;
  return Math.abs(Math.round((d1 - d2) / 86_400_000));
}

function merchantBonus(card: string | null, note: string | null): number {
  if (!card || !note) return 0;
  const a = normalizeMerchant(card);
  const b = normalizeMerchant(note);
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return 20;
  // Token overlap as a weaker signal.
  const aTok = new Set(a.split(" ").filter((t) => t.length >= 2));
  const bTok = new Set(b.split(" ").filter((t) => t.length >= 2));
  if (aTok.size === 0) return 0;
  let hits = 0;
  for (const t of aTok) if (bTok.has(t)) hits++;
  const overlap = hits / aTok.size;
  return overlap >= 0.6 ? 15 : overlap >= 0.3 ? 5 : 0;
}

export function scorePair(card: CardRow, txn: CandidateTxn): number {
  if (txn.amount !== card.amount) return 0;       // amount mismatch → not a candidate
  const days = daysBetween(card.date, txn.date);
  // Same date AND same yen is the ONLY auto-confirm (100). A merchant match
  // must never push a date-drifted pair to 100 — those stay suggestions.
  if (days === 0) return 100;
  let s: number;
  if (days <= 3) s = 80;
  else if (days <= 7) s = 60;
  else return 0;
  return Math.min(95, s + merchantBonus(card.merchant, txn.note));
}

/**
 * Assign each card row to at most one candidate transaction.
 *
 * Greedy: compute every (card × candidate) score above 0, sort
 * descending, and lock in pairs that don't conflict. A txn can only be
 * matched once, a card row only once.
 */
export function reconcile(cards: CardRow[], txns: CandidateTxn[]): MatchVerdict[] {
  const pairs: { cardId: string; txnId: string; score: number }[] = [];
  for (const c of cards) {
    for (const t of txns) {
      const s = scorePair(c, t);
      if (s > 0) pairs.push({ cardId: c.id, txnId: t.id, score: s });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const usedTxn = new Set<string>();
  const usedCard = new Set<string>();
  const verdicts = new Map<string, MatchVerdict>();
  for (const p of pairs) {
    if (usedTxn.has(p.txnId) || usedCard.has(p.cardId)) continue;
    usedTxn.add(p.txnId);
    usedCard.add(p.cardId);
    verdicts.set(p.cardId, {
      cardRowId: p.cardId,
      matchedTxnId: p.txnId,
      confidence: p.score,
    });
  }
  // Card rows with no match still get a verdict so the caller can persist
  // status='unmatched' uniformly.
  for (const c of cards) {
    if (!verdicts.has(c.id)) {
      verdicts.set(c.id, { cardRowId: c.id, matchedTxnId: null, confidence: 0 });
    }
  }
  return Array.from(verdicts.values());
}

/**
 * Map a verdict to the staging row status the user picked:
 *   confidence 100 → 'confirmed' (auto-confirm)
 *   confidence  ≥ 60 → 'suggested'
 *   else            → 'unmatched'
 */
export function statusFromConfidence(c: number): "unmatched" | "suggested" | "confirmed" {
  if (c === 100) return "confirmed";
  if (c >= 60) return "suggested";
  return "unmatched";
}

/* ---------------------------------------------------------------------- */
/*  Group matching                                                         */
/* ---------------------------------------------------------------------- */

/**
 * One transaction matched by a SET of card rows whose amounts sum to the
 * transaction's amount. The whole group is treated atomically by the
 * server actions: accepting one row accepts all, rejecting one resets all.
 */
export interface GroupMatchProposal {
  cardRowIds: string[];     // 2..MAX_GROUP_SIZE rows
  matchedTxnId: string;
  confidence: number;       // capped at 85, never auto-confirmed
}

const MAX_GROUP_SIZE = 5;
const GROUP_DATE_WINDOW_DAYS = 2;

/**
 * Score a group proposal:
 *   base = 80 (same date) / 70 (≤2 days)
 *   size penalty: -3 per row beyond 2 (so 2→0, 3→-3, 4→-6, 5→-9)
 *   merchant bonus: +10 if every card row's merchant shares a token with
 *     the transaction's note (e.g. all rows say "AMAZON").
 *
 * Capped at 85 so a group match never auto-confirms — the user always
 * sees it as a suggestion, which matches their stated UX preference.
 */
function scoreGroup(
  cards: CardRow[],
  txn: CandidateTxn,
  maxDateDiff: number,
): number {
  let base = maxDateDiff === 0 ? 80 : 70;
  base -= Math.max(0, cards.length - 2) * 3;
  // Merchant overlap: at least one card merchant token is also in note.
  if (txn.note) {
    const noteNorm = normalizeMerchant(txn.note);
    const noteToks = new Set(
      noteNorm.split(" ").filter((t) => t.length >= 3),
    );
    const allShare = cards.every((c) => {
      if (!c.merchant) return false;
      const merNorm = normalizeMerchant(c.merchant);
      const merToks = merNorm.split(" ").filter((t) => t.length >= 3);
      return merToks.some((t) => noteToks.has(t));
    });
    if (allShare) base += 10;
  }
  return Math.min(85, Math.max(0, base));
}

/**
 * Enumerate subsets of `rows` whose amounts sum to `target`. Sizes 2..max,
 * with a hard cap on the number of solutions returned so a pathological
 * day with many small rows doesn't blow up.
 */
function enumerateSubsetsByAmount(
  rows: CardRow[],
  target: number,
  max: number,
  cap = 32,
): CardRow[][] {
  if (target <= 0) return [];
  // Sort ascending to enable early pruning when remaining < smallest row.
  const sorted = [...rows].sort((a, b) => a.amount - b.amount);
  const results: CardRow[][] = [];
  const stack: CardRow[] = [];

  function recurse(start: number, remaining: number) {
    if (results.length >= cap) return;
    if (remaining === 0 && stack.length >= 2) {
      results.push([...stack]);
      return;
    }
    if (stack.length >= max) return;
    for (let i = start; i < sorted.length; i++) {
      const r = sorted[i];
      if (r.amount > remaining) break; // sorted asc → all later are bigger
      stack.push(r);
      recurse(i + 1, remaining - r.amount);
      stack.pop();
    }
  }
  recurse(0, target);
  return results;
}

function daysAbs(a: string, b: string): number {
  const d1 = Date.parse(a + "T00:00:00Z");
  const d2 = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(d1) || Number.isNaN(d2)) return 9999;
  return Math.abs(Math.round((d1 - d2) / 86_400_000));
}

/**
 * Find group matches for unmatched transactions in the date window.
 *
 * Strategy:
 *   1. For each unmatched transaction T, gather card rows within
 *      ±GROUP_DATE_WINDOW_DAYS of T.date.
 *   2. Enumerate subsets summing to T.amount (size 2..MAX_GROUP_SIZE).
 *   3. Score each subset; keep the best for this T.
 *   4. Greedy assignment: sort proposals by confidence desc; lock in
 *      proposals that don't reuse any card row or transaction.
 *
 * The caller is expected to have run the 1:1 matcher first and removed
 * its winners from `cards` and `txns`.
 */
export function findGroupMatches(
  cards: CardRow[],
  txns: CandidateTxn[],
): GroupMatchProposal[] {
  if (cards.length === 0 || txns.length === 0) return [];

  // Pre-bucket card rows by date for window lookups.
  const proposals: GroupMatchProposal[] = [];
  for (const t of txns) {
    const window = cards.filter((c) => daysAbs(c.date, t.date) <= GROUP_DATE_WINDOW_DAYS);
    if (window.length < 2) continue;
    const subsets = enumerateSubsetsByAmount(window, t.amount, MAX_GROUP_SIZE);
    if (subsets.length === 0) continue;

    let best: { rows: CardRow[]; conf: number } | null = null;
    for (const sub of subsets) {
      const maxDateDiff = sub.reduce(
        (acc, r) => Math.max(acc, daysAbs(r.date, t.date)),
        0,
      );
      const conf = scoreGroup(sub, t, maxDateDiff);
      if (conf <= 0) continue;
      // Prefer higher confidence, then smaller subsets.
      if (
        !best ||
        conf > best.conf ||
        (conf === best.conf && sub.length < best.rows.length)
      ) {
        best = { rows: sub, conf };
      }
    }
    if (best) {
      proposals.push({
        cardRowIds: best.rows.map((r) => r.id),
        matchedTxnId: t.id,
        confidence: best.conf,
      });
    }
  }

  // Greedy: highest confidence first, never reuse a row or txn.
  proposals.sort((a, b) => b.confidence - a.confidence);
  const usedCards = new Set<string>();
  const usedTxns = new Set<string>();
  const accepted: GroupMatchProposal[] = [];
  for (const p of proposals) {
    if (usedTxns.has(p.matchedTxnId)) continue;
    if (p.cardRowIds.some((id) => usedCards.has(id))) continue;
    usedTxns.add(p.matchedTxnId);
    for (const id of p.cardRowIds) usedCards.add(id);
    accepted.push(p);
  }
  return accepted;
}
