import axios, { type AxiosInstance } from 'axios';

export interface CoinGeckoNewsItem {
  title: string;
  description: string;
  url: string;
  published_at: string; // ISO8601
  source: string;
}

const REQUEST_DELAY_MS = 1500; // CoinGecko free tier: ~30 req/min

// Map our canonical tickers to CoinGecko IDs
const TICKER_TO_COINGECKO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  LINK: 'chainlink',
  MATIC: 'matic-network',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  ATOM: 'cosmos',
  UNI: 'uniswap',
  AAVE: 'aave',
  FIL: 'filecoin',
  ICP: 'internet-computer',
  ALGO: 'algorand',
  XLM: 'stellar',
  VET: 'vechain',
};

export function getCoinGeckoId(ticker: string): string | undefined {
  return TICKER_TO_COINGECKO_ID[ticker];
}

export class CoinGeckoClient {
  private readonly client: AxiosInstance;
  private lastRequestTime = 0;
  private requestCount = 0;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.coingecko.com/api/v3',
      timeout: 30_000,
    });
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < REQUEST_DELAY_MS) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS - elapsed));
    }
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Fetch trending search data from CoinGecko. Contains trending coins
   * which we can use as "news-like" signals.
   */
  async getTrending(): Promise<Array<{ id: string; name: string; symbol: string; score: number }>> {
    await this.throttle();
    try {
      const { data } = await this.client.get('/search/trending');
      const coins = data?.coins ?? [];
      return coins.map((c: { item: { id: string; name: string; symbol: string; score: number } }) => ({
        id: c.item.id,
        name: c.item.name,
        symbol: c.item.symbol,
        score: c.item.score,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Fetch coin market data for multiple coins in one call.
   * We use the price_change_percentage fields as a proxy for market activity.
   */
  async getCoinMarketData(ids: string[]): Promise<
    Array<{
      id: string;
      symbol: string;
      name: string;
      current_price: number;
      price_change_percentage_24h: number;
      market_cap_change_percentage_24h: number;
      total_volume: number;
    }>
  > {
    if (ids.length === 0) return [];
    await this.throttle();
    try {
      const { data } = await this.client.get('/coins/markets', {
        params: {
          vs_currency: 'usd',
          ids: ids.join(','),
          order: 'market_cap_desc',
          per_page: ids.length,
          page: 1,
          sparkline: false,
          price_change_percentage: '24h,7d',
        },
      });
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  getRequestCount(): number {
    return this.requestCount;
  }
}
