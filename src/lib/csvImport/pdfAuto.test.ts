import { describe, it, expect } from "vitest";
import { runPdfStrategy, extractStatementSummary } from "./pdfAuto";

/**
 * Regression tests for AMEX Marriott Bonvoy PDF import.
 *
 * pdf2json renders AMEX's Type3 font as garbled Latin-1: "2026年5月20日"
 * comes out as "202615<20À" (年→a digit, 月→"<", 日→"À"), and each USD amount
 * on a foreign-currency statement prints on its own line ("56.69"). Both broke
 * the compact strategy: the garbled year defeated findReferenceYear so every
 * row was dropped (→ 0 rows → the import action threw), and stray "MM.DD"
 * decimal lines leaked in as junk "(不明)" rows.
 */

// "月" garbles to "<", "日" to U+00C0. Year-less transaction dates only carry
// month+day, so the reference year must be recovered from the (also garbled)
// header lines where "2026年" renders as "20261".
const G = "À"; // 日
function garbledBody(): string {
  return [
    "インボイス T8700150009366",
    "****-******-72000       202616<19" + G, // 明細作成日 2026年6月19日 (garbled)
    "202617<10" + G, //                         決済日 2026年7月10日 (garbled)
    "      202615<20" + G + "から    202616<19" + G + "まで", // 対象期間
    "6<12" + G + "    MAZDA                                                  220",
    "5<15" + G + "    ETC TOLL ROAD                                        1,910",
    "6<7" + G + "     CRUISEAMERICA - LAS                                - 73,909",
    "56.69", //  standalone USD amount — must NOT become a row
    "10.30", //  looks like month=10/day=30 but is a USD amount — must NOT leak
    "16.45",
  ].join("\n");
}

describe("extractCompact — AMEX Type3 garbled statement", () => {
  const result = runPdfStrategy(garbledBody(), "compact");

  it("recovers the year from garbled headers instead of dropping every row", () => {
    expect(result.rows.length).toBeGreaterThan(0);
    for (const r of result.rows) {
      expect(r.date.startsWith("2026-")).toBe(true);
    }
  });

  it("parses the real transaction rows with correct date/amount", () => {
    const mazda = result.rows.find((r) => r.merchant.includes("MAZDA"));
    expect(mazda).toBeDefined();
    expect(mazda!.date).toBe("2026-06-12");
    expect(mazda!.amount).toBe(220);

    const refund = result.rows.find((r) => r.merchant.includes("CRUISE"));
    expect(refund!.amount).toBe(-73909); // refund keeps its negative sign
  });

  it("does not turn standalone foreign-currency amounts into junk rows", () => {
    // "10.30" / "56.69" / "16.45" are USD amounts, not dates.
    expect(result.rows.some((r) => r.merchant === "(不明)")).toBe(false);
    expect(result.rows.some((r) => r.date === "2026-10-30")).toBe(false);
  });
});

describe("extractStatementSummary", () => {
  it("lifts the billed total from the AMEX reconciliation identity", () => {
    // prev − payments + newCharges = closing  [billed]
    const body = "…前回 837,024    -    914,833    +    1,315,065    =    1,237,256    1,237,256 …";
    const s = extractStatementSummary(body);
    expect(s).toBeDefined();
    expect(s!.billedTotal).toBe(1237256);
    expect(s!.newCharges).toBe(1315065);
    expect(s!.prevBalance).toBe(837024);
    expect(s!.paymentsAdjustments).toBe(914833);
  });

  it("falls back to the closing balance when the trailing 請求額 is absent", () => {
    const body = "100,000 - 30,000 + 50,000 = 120,000";
    const s = extractStatementSummary(body);
    expect(s!.billedTotal).toBe(120000);
  });

  it("rejects a coincidental number run that doesn't satisfy the identity", () => {
    // 100 - 20 + 50 = 200 is false → not a summary.
    const body = "some 100,000 - 20,000 + 50,000 = 200,000 numbers";
    expect(extractStatementSummary(body)).toBeUndefined();
  });

  it("returns undefined when no formula is present (non-AMEX statement)", () => {
    expect(extractStatementSummary("楽天カード 2026/06/12 スーパー 1,200")).toBeUndefined();
  });
});

describe("extractCompact — clean (non-garbled) statement still works", () => {
  it("uses the precise anchored year on well-formed dates", () => {
    const body = [
      "ご利用明細  2026年5月20日から2026年6月19日まで",
      "2026/06/12    スーパー マーケット                    1,200",
      "2026/06/13    カフェ                                    680",
    ].join("\n");
    const result = runPdfStrategy(body, "compact");
    expect(result.rows.length).toBe(2);
    expect(result.rows[0].date).toBe("2026-06-12");
    expect(result.rows[0].amount).toBe(1200);
  });
});
