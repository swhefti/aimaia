import axios, { type AxiosInstance } from 'axios';
import { toFinnhub } from '../utils/ticker-map.js';

export interface NewsResponse {
  id: number;
  category: string;
  datetime: number; // unix timestamp
  headline: string;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export interface FundamentalsResponse {
  ticker: string;
  peRatio: number | null;
  psRatio: number | null;
  revenueGrowthYoy: number | null;
  profitMargin: number | null;
  roe: number | null;
  marketCap: number | null;
  debtToEquity: number | null;
}

export class FinnhubError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly ticker?: string,
  ) {
    super(message);
    this.name = 'FinnhubError';
  }
}

const REQUEST_DELAY_MS = 100; // 60 req/min = ~1 per second, 100ms is conservative

export class FinnhubClient {
  private readonly client: AxiosInstance;
  private readonly token: string;
  private lastRequestTime = 0;
  private requestCount = 0;

  constructor() {
    const token = process.env['FINNHUB_API_KEY'];
    if (!token) throw new Error('Missing env var: FINNHUB_API_KEY');
    this.token = token;

    this.client = axios.create({
      baseURL: 'https://finnhub.io/api/v1',
      timeout: 30_000,
    });
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < REQUEST_DELAY_MS) {
      await sleep(REQUEST_DELAY_MS - elapsed);
    }
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  private async requestWithRetry<T>(url: string, params: Record<string, string> = {}): Promise<T> {
    await this.throttle();

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.client.get<T>(url, {
          params: { ...params, token: this.token },
        });
        return response.data;
      } catch (err: unknown) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          if ((status === 429 || (status !== undefined && status >= 500)) && attempt === 0) {
            const delay = status === 429 ? 5_000 : 2_000;
            console.warn(`[Finnhub] ${status} on ${url}, retrying in ${delay}ms...`);
            await sleep(delay);
            continue;
          }
          throw new FinnhubError(
            `Finnhub API error: ${err.message}`,
            status,
            params['symbol'],
          );
        }
        throw err;
      }
    }

    throw new FinnhubError('Unreachable');
  }

  tickerToFinnhub(ticker: string): string {
    return toFinnhub(ticker);
  }

  async getCompanyNews(ticker: string, from: Date, to: Date): Promise<NewsResponse[]> {
    const finnhubTicker = toFinnhub(ticker);
    const fromStr = formatDate(from);
    const toStr = formatDate(to);

    const data = await this.requestWithRetry<NewsResponse[]>('/company-news', {
      symbol: finnhubTicker,
      from: fromStr,
      to: toStr,
    });

    if (!Array.isArray(data)) {
      return [];
    }

    return data;
  }

  async getMarketNews(): Promise<NewsResponse[]> {
    const data = await this.requestWithRetry<NewsResponse[]>('/news', {
      category: 'general',
    });

    if (!Array.isArray(data)) {
      return [];
    }

    return data;
  }

  async getCryptoNews(): Promise<NewsResponse[]> {
    const data = await this.requestWithRetry<NewsResponse[]>('/news', {
      category: 'crypto',
    });

    if (!Array.isArray(data)) {
      return [];
    }

    return data;
  }

  async getFundamentals(ticker: string): Promise<FundamentalsResponse> {
    const finnhubTicker = toFinnhub(ticker);

    interface MetricApiResponse {
      metric?: {
        peNormalizedAnnual?: number;
        psTTM?: number;
        revenueGrowthQuarterlyYoy?: number;
        netProfitMarginTTM?: number;
        roeTTM?: number;
        marketCapitalization?: number;
        totalDebt_totalEquityQuarterly?: number;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }

    const data = await this.requestWithRetry<MetricApiResponse>('/stock/metric', {
      symbol: finnhubTicker,
      metric: 'all',
    });

    const m = data.metric ?? {};

    return {
      ticker,
      peRatio: nullIfUndefined(m.peNormalizedAnnual),
      psRatio: nullIfUndefined(m.psTTM),
      revenueGrowthYoy: nullIfUndefined(m.revenueGrowthQuarterlyYoy) !== null
        ? (m.revenueGrowthQuarterlyYoy! / 100)
        : null,
      profitMargin: nullIfUndefined(m.netProfitMarginTTM) !== null
        ? (m.netProfitMarginTTM! / 100)
        : null,
      roe: nullIfUndefined(m.roeTTM) !== null
        ? (m.roeTTM! / 100)
        : null,
      marketCap: nullIfUndefined(m.marketCapitalization) !== null
        ? (m.marketCapitalization! * 1_000_000)
        : null,
      debtToEquity: nullIfUndefined(m.totalDebt_totalEquityQuarterly),
    };
  }

  getRequestCount(): number {
    return this.requestCount;
  }
}

function nullIfUndefined(val: number | undefined): number | null {
  return val !== undefined && val !== null && !isNaN(val) ? val : null;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
