import { describe, it, expect } from "vitest";
import { reduceHoldingsFromTrades, type TradeLike } from "./stockMath";

const t = (o: Partial<TradeLike> & Pick<TradeLike, "action" | "quantity">): TradeLike => ({
  ticker: "6758",
  name: "ソニーグループ",
  price_usd: 3000,
  exchange_rate: 1,
  ...o,
});

describe("reduceHoldingsFromTrades", () => {
  it("nets a buy + equal sell to zero (position dropped)", () => {
    const { positions, warnings } = reduceHoldingsFromTrades([
      t({ action: "buy", quantity: 100, price_usd: 2938 }),
      t({ action: "sell", quantity: 100, price_usd: 3609 }),
    ]);
    expect(positions).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("keeps the residual after a partial sell with weighted-average cost", () => {
    const { positions } = reduceHoldingsFromTrades([
      t({ action: "buy", quantity: 100, price_usd: 3000 }),
      t({ action: "sell", quantity: 40, price_usd: 3500 }),
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0].qty).toBe(60);
    expect(positions[0].avgCostUsd).toBeCloseTo(3000); // avg cost unchanged by a sell
  });

  it("warns + clamps when a sell exceeds the account's holding (the SONY bug)", () => {
    // Account that only ever saw the sell (buy lived in another account).
    const { positions, warnings } = reduceHoldingsFromTrades([
      t({ action: "sell", quantity: 100, price_usd: 3609 }),
    ]);
    expect(positions).toHaveLength(0); // clamped to zero, not negative
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("保有");
  });

  it("does not warn for a normal buy-only position", () => {
    const { positions, warnings } = reduceHoldingsFromTrades([
      t({ action: "buy", quantity: 100, price_usd: 2938 }),
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0].qty).toBe(100);
    expect(warnings).toHaveLength(0);
  });

  it("tracks multiple tickers independently", () => {
    const { positions } = reduceHoldingsFromTrades([
      t({ ticker: "6758", action: "buy", quantity: 100 }),
      t({ ticker: "MSFT", name: "MSFT", action: "buy", quantity: 4, price_usd: 400 }),
      t({ ticker: "6758", action: "sell", quantity: 100 }),
    ]);
    expect(positions).toHaveLength(1);
    expect(positions[0].ticker).toBe("MSFT");
    expect(positions[0].qty).toBe(4);
  });
});
