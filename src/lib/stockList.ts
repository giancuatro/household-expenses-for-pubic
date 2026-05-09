export type StockItem = {
  ticker: string;
  /**
   * Display name. For stocks/ETFs: company name (e.g. "Microsoft").
   * For mutual funds: 愛称/nickname (e.g. "雪だるま全世界株式").
   */
  name: string;
  /** Official long name for funds (正式名称). Unused for stocks. */
  officialName?: string;
  type: "US" | "JP" | "fund";
  /** Yahoo Finance ticker (JP stocks get ".T" suffix, funds use their code) */
  yahooTicker?: string;
  /**
   * Price denomination unit.
   * JP mutual funds quote NAV per 10,000 units (一万口), so priceUnit = 10000.
   * All other assets quote per 1 share/unit.
   */
  priceUnit?: number;
};

export const STOCK_LIST: StockItem[] = [
  // ---- US mega-cap / tech ----
  { ticker: "AAPL", name: "Apple", type: "US" },
  { ticker: "MSFT", name: "Microsoft", type: "US" },
  { ticker: "NVDA", name: "NVIDIA", type: "US" },
  { ticker: "AMZN", name: "Amazon", type: "US" },
  { ticker: "GOOGL", name: "Alphabet (Google)", type: "US" },
  { ticker: "META", name: "Meta Platforms", type: "US" },
  { ticker: "TSLA", name: "Tesla", type: "US" },
  { ticker: "AVGO", name: "Broadcom", type: "US" },
  { ticker: "TSM", name: "Taiwan Semiconductor", type: "US" },
  { ticker: "NFLX", name: "Netflix", type: "US" },
  { ticker: "ORCL", name: "Oracle", type: "US" },
  { ticker: "ADBE", name: "Adobe", type: "US" },
  { ticker: "CRM", name: "Salesforce", type: "US" },
  { ticker: "AMD", name: "AMD", type: "US" },
  { ticker: "INTC", name: "Intel", type: "US" },
  { ticker: "QCOM", name: "Qualcomm", type: "US" },
  { ticker: "TXN", name: "Texas Instruments", type: "US" },
  { ticker: "CSCO", name: "Cisco", type: "US" },
  { ticker: "NOW", name: "ServiceNow", type: "US" },
  { ticker: "UBER", name: "Uber", type: "US" },
  { ticker: "SPOT", name: "Spotify", type: "US" },
  { ticker: "SHOP", name: "Shopify", type: "US" },
  { ticker: "PLTR", name: "Palantir", type: "US" },
  { ticker: "ARM", name: "ARM Holdings", type: "US" },
  { ticker: "ASML", name: "ASML Holding", type: "US" },
  { ticker: "MU", name: "Micron Technology", type: "US" },
  { ticker: "AMAT", name: "Applied Materials", type: "US" },
  { ticker: "LRCX", name: "Lam Research", type: "US" },
  { ticker: "COIN", name: "Coinbase", type: "US" },
  { ticker: "LEU", name: "Centrus Energy", type: "US" },
  { ticker: "SMR", name: "NuScale Power", type: "US" },
  // ---- US financials / industrials / healthcare ----
  { ticker: "JPM", name: "JPMorgan Chase", type: "US" },
  { ticker: "V", name: "Visa", type: "US" },
  { ticker: "MA", name: "Mastercard", type: "US" },
  { ticker: "BAC", name: "Bank of America", type: "US" },
  { ticker: "GS", name: "Goldman Sachs", type: "US" },
  { ticker: "MS", name: "Morgan Stanley", type: "US" },
  { ticker: "WFC", name: "Wells Fargo", type: "US" },
  { ticker: "AXP", name: "American Express", type: "US" },
  { ticker: "C", name: "Citigroup", type: "US" },
  { ticker: "PYPL", name: "PayPal", type: "US" },
  { ticker: "SQ", name: "Block (Square)", type: "US" },
  { ticker: "BRK.B", name: "Berkshire Hathaway B", type: "US" },
  { ticker: "UNH", name: "UnitedHealth", type: "US" },
  { ticker: "JNJ", name: "Johnson & Johnson", type: "US" },
  { ticker: "LLY", name: "Eli Lilly", type: "US" },
  { ticker: "PFE", name: "Pfizer", type: "US" },
  { ticker: "ABBV", name: "AbbVie", type: "US" },
  { ticker: "MRK", name: "Merck", type: "US" },
  { ticker: "TMO", name: "Thermo Fisher", type: "US" },
  { ticker: "ABT", name: "Abbott Laboratories", type: "US" },
  { ticker: "ISRG", name: "Intuitive Surgical", type: "US" },
  // ---- US consumer / retail / energy ----
  { ticker: "WMT", name: "Walmart", type: "US" },
  { ticker: "COST", name: "Costco", type: "US" },
  { ticker: "HD", name: "Home Depot", type: "US" },
  { ticker: "PG", name: "Procter & Gamble", type: "US" },
  { ticker: "KO", name: "Coca-Cola", type: "US" },
  { ticker: "PEP", name: "PepsiCo", type: "US" },
  { ticker: "MCD", name: "McDonald's", type: "US" },
  { ticker: "SBUX", name: "Starbucks", type: "US" },
  { ticker: "NKE", name: "Nike", type: "US" },
  { ticker: "DIS", name: "Walt Disney", type: "US" },
  { ticker: "XOM", name: "ExxonMobil", type: "US" },
  { ticker: "CVX", name: "Chevron", type: "US" },
  { ticker: "COP", name: "ConocoPhillips", type: "US" },
  // ---- US industrials / aerospace ----
  { ticker: "BA", name: "Boeing", type: "US" },
  { ticker: "LMT", name: "Lockheed Martin", type: "US" },
  { ticker: "RTX", name: "RTX (Raytheon)", type: "US" },
  { ticker: "GE", name: "GE Aerospace", type: "US" },
  { ticker: "CAT", name: "Caterpillar", type: "US" },
  { ticker: "DE", name: "Deere & Company", type: "US" },
  { ticker: "HON", name: "Honeywell", type: "US" },
  { ticker: "UNP", name: "Union Pacific", type: "US" },
  { ticker: "UPS", name: "UPS", type: "US" },
  { ticker: "FDX", name: "FedEx", type: "US" },
  // ---- US telecom / media ----
  { ticker: "T", name: "AT&T", type: "US" },
  { ticker: "VZ", name: "Verizon", type: "US" },
  { ticker: "TMUS", name: "T-Mobile US", type: "US" },
  { ticker: "CMCSA", name: "Comcast", type: "US" },
  // ---- US more tech / software / cyber ----
  { ticker: "SNOW", name: "Snowflake", type: "US" },
  { ticker: "DDOG", name: "Datadog", type: "US" },
  { ticker: "ZS", name: "Zscaler", type: "US" },
  { ticker: "NET", name: "Cloudflare", type: "US" },
  { ticker: "CRWD", name: "CrowdStrike", type: "US" },
  { ticker: "PANW", name: "Palo Alto Networks", type: "US" },
  { ticker: "MRVL", name: "Marvell Technology", type: "US" },
  { ticker: "SNPS", name: "Synopsys", type: "US" },
  { ticker: "CDNS", name: "Cadence Design", type: "US" },
  { ticker: "KLAC", name: "KLA Corporation", type: "US" },
  { ticker: "MSTR", name: "MicroStrategy", type: "US" },
  { ticker: "RIVN", name: "Rivian", type: "US" },
  { ticker: "LCID", name: "Lucid Group", type: "US" },
  { ticker: "SOFI", name: "SoFi Technologies", type: "US" },
  { ticker: "ROKU", name: "Roku", type: "US" },
  { ticker: "ABNB", name: "Airbnb", type: "US" },
  { ticker: "DASH", name: "DoorDash", type: "US" },
  { ticker: "RBLX", name: "Roblox", type: "US" },
  { ticker: "U", name: "Unity Software", type: "US" },
  { ticker: "AI", name: "C3.ai", type: "US" },
  { ticker: "PATH", name: "UiPath", type: "US" },
  { ticker: "IONQ", name: "IonQ", type: "US" },
  { ticker: "RGTI", name: "Rigetti Computing", type: "US" },
  // ---- Popular ETFs ----
  { ticker: "SPY", name: "SPDR S&P 500 ETF", type: "US" },
  { ticker: "QQQ", name: "Invesco QQQ (Nasdaq 100)", type: "US" },
  { ticker: "VTI", name: "Vanguard Total Stock Market", type: "US" },
  { ticker: "VOO", name: "Vanguard S&P 500", type: "US" },
  { ticker: "ARKK", name: "ARK Innovation ETF", type: "US" },
  { ticker: "SOXL", name: "Direxion Semiconductor Bull 3X", type: "US" },
  { ticker: "TQQQ", name: "ProShares UltraPro QQQ 3X", type: "US" },
  // ---- JP stocks ----
  { ticker: "6758", name: "ソニーグループ", type: "JP", yahooTicker: "6758.T" },
  { ticker: "8729", name: "ソニーフィナンシャルグループ", type: "JP", yahooTicker: "8729.T" },
  { ticker: "7203", name: "トヨタ自動車", type: "JP", yahooTicker: "7203.T" },
  { ticker: "6861", name: "キーエンス", type: "JP", yahooTicker: "6861.T" },
  { ticker: "9984", name: "ソフトバンクグループ", type: "JP", yahooTicker: "9984.T" },
  { ticker: "8306", name: "三菱UFJフィナンシャル", type: "JP", yahooTicker: "8306.T" },
  { ticker: "6501", name: "日立製作所", type: "JP", yahooTicker: "6501.T" },
  { ticker: "9432", name: "NTT", type: "JP", yahooTicker: "9432.T" },
  { ticker: "6902", name: "デンソー", type: "JP", yahooTicker: "6902.T" },
  { ticker: "7741", name: "HOYA", type: "JP", yahooTicker: "7741.T" },
  // ---- Funds (yahooTicker = Yahoo Japan finance fund code) ----
  // For funds, `name` is the 愛称 (nickname); `officialName` is the 正式名称.
  {
    ticker: "SBI_WORLD",
    name: "雪だるま全世界株式",
    officialName: "SBI・全世界株式インデックス・ファンド",
    type: "fund",
    yahooTicker: "8931217C",
    priceUnit: 10000,
  },
  {
    ticker: "DAIWA_NDX",
    name: "iFreeNEXT NASDAQ100",
    officialName: "iFreeNEXT NASDAQ100インデックス",
    type: "fund",
    yahooTicker: "04317188",
    priceUnit: 10000,
  },
  {
    ticker: "ORUKAN",
    name: "オルカン",
    officialName: "eMAXIS Slim 全世界株式（オール・カントリー）",
    type: "fund",
    yahooTicker: "03311187",
    priceUnit: 10000,
  },
];

/** Return price unit (10000 for JP mutual funds, 1 for all others). */
export function getPriceUnit(ticker: string): number {
  const item = STOCK_LIST.find((s) => s.ticker.toLowerCase() === ticker.toLowerCase());
  return item?.priceUnit ?? 1;
}

/** Return currency for a ticker ("JPY" for JP/fund, "USD" for US). */
export function getTickerCurrency(ticker: string): "JPY" | "USD" {
  const item = STOCK_LIST.find((s) => s.ticker.toLowerCase() === ticker.toLowerCase());
  return item?.type === "US" ? "USD" : "JPY";
}

/** Look up the ticker type, or undefined if not in the list. */
export function getTickerType(ticker: string): "US" | "JP" | "fund" | undefined {
  const item = STOCK_LIST.find((s) => s.ticker.toLowerCase() === ticker.toLowerCase());
  return item?.type;
}

/**
 * Resolve the labels to show in tables for a given ticker.
 *
 * - Stocks/ETFs: primary = company name (e.g. "Microsoft"), secondary = ticker (e.g. "MSFT")
 * - Mutual funds: primary = 愛称 (e.g. "雪だるま全世界株式"), secondary = 正式名称
 *
 * `fallbackName` is used when the ticker isn't in STOCK_LIST (custom tickers).
 */
export function getTickerLabels(
  ticker: string,
  fallbackName?: string | null,
): { primary: string; secondary: string } {
  const item = STOCK_LIST.find((s) => s.ticker.toLowerCase() === ticker.toLowerCase());
  if (!item) {
    return { primary: fallbackName ?? ticker, secondary: ticker };
  }
  if (item.type === "fund") {
    return {
      primary: item.name,
      secondary: item.officialName ?? "",
    };
  }
  return { primary: item.name, secondary: ticker };
}

/** Search stock list by ticker or name (case-insensitive, max 8 results). */
export function searchStocks(q: string): StockItem[] {
  if (!q) return [];
  const lower = q.toLowerCase();
  return STOCK_LIST.filter(
    (s) =>
      s.ticker.toLowerCase().includes(lower) ||
      s.name.toLowerCase().includes(lower)
  ).slice(0, 8);
}
