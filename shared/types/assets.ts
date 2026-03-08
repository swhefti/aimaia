export type AssetType = 'stock' | 'etf' | 'crypto';

export interface Asset {
  ticker: string;
  name: string;
  assetType: AssetType;
  sector: string;
  active: boolean;
}

export interface PriceHistory {
  ticker: string;
  date: string; // ISO 8601 date string, e.g. "2025-01-15"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsItem {
  id: string;
  ticker: string;
  headline: string;
  summary: string | null;
  source: string;
  publishedAt: string; // ISO 8601 datetime string
  url: string;
}

export interface FundamentalData {
  ticker: string;
  date: string; // ISO 8601 date string
  peRatio: number | null;
  psRatio: number | null;
  revenueGrowthYoy: number | null; // decimal, e.g. 0.15 for 15%
  profitMargin: number | null;     // decimal, e.g. 0.22 for 22%
  roe: number | null;              // return on equity, decimal
  marketCap: number | null;        // USD
  debtToEquity: number | null;
}

export interface MacroEvent {
  id: string;
  date: string; // ISO 8601 date string
  eventDescription: string;
  eventType: string; // e.g. 'fed_decision', 'cpi_release', 'earnings', 'geopolitical'
  relevantAssetTypes: AssetType[];
  relevantTickers: string[]; // empty array if affects all
  sentiment: number; // normalized -1.0 to +1.0
  sourceUrl: string | null;
}
