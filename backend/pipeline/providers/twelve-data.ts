import axios, { type AxiosInstance } from 'axios';

export interface OHLCVResponse {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface QuoteResponse {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  previousClose: number;
  change: number;
  percentChange: number;
  timestamp: number;
}

export class TwelveDataError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly ticker?: string,
  ) {
    super(message);
    this.name = 'TwelveDataError';
  }
}

const RATE_LIMIT_DELAY_MS = 10_000; // 10s between batches (8 req/min limit)

export class TwelveDataClient {
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private lastRequestTime = 0;
  private requestCount = 0;

  constructor() {
    const apiKey = process.env['TWELVE_DATA_API_KEY'];
    if (!apiKey) throw new Error('Missing env var: TWELVE_DATA_API_KEY');
    this.apiKey = apiKey;

    this.client = axios.create({
      baseURL: 'https://api.twelvedata.com',
      timeout: 30_000,
    });
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    // Ensure minimum gap to stay under 8 req/min
    const minGap = 8_000; // ~7.5 req/min
    if (elapsed < minGap) {
      await sleep(minGap - elapsed);
    }
    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  private async requestWithRetry<T>(url: string, params: Record<string, string>): Promise<T> {
    await this.throttle();

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.client.get<T>(url, {
          params: { ...params, apikey: this.apiKey },
        });
        return response.data;
      } catch (err: unknown) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          if ((status === 429 || (status !== undefined && status >= 500)) && attempt === 0) {
            const delay = status === 429 ? RATE_LIMIT_DELAY_MS : 2_000;
            console.warn(`[TwelveData] ${status} on ${url}, retrying in ${delay}ms...`);
            await sleep(delay);
            continue;
          }
          throw new TwelveDataError(
            `TwelveData API error: ${err.message}`,
            status,
            params['symbol'],
          );
        }
        throw err;
      }
    }

    throw new TwelveDataError('Unreachable');
  }

  async getOHLCV(ticker: string, days: number): Promise<OHLCVResponse[]> {
    interface TimeSeriesApiResponse {
      values?: Array<{
        datetime: string;
        open: string;
        high: string;
        low: string;
        close: string;
        volume: string;
      }>;
      status?: string;
      message?: string;
      code?: number;
    }

    const data = await this.requestWithRetry<TimeSeriesApiResponse>('/time_series', {
      symbol: ticker,
      interval: '1day',
      outputsize: String(days),
    });

    if (data.status === 'error' || data.code !== undefined) {
      throw new TwelveDataError(
        `TwelveData error for ${ticker}: ${data.message ?? 'unknown error'}`,
        undefined,
        ticker,
      );
    }

    if (!data.values || !Array.isArray(data.values)) {
      throw new TwelveDataError(`No OHLCV data returned for ${ticker}`, undefined, ticker);
    }

    return data.values.map((v) => ({
      datetime: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseFloat(v.volume) || 0,
    }));
  }

  async getQuote(ticker: string): Promise<QuoteResponse> {
    interface QuoteApiResponse {
      symbol?: string;
      open?: string;
      high?: string;
      low?: string;
      close?: string;
      volume?: string;
      previous_close?: string;
      change?: string;
      percent_change?: string;
      timestamp?: number;
      status?: string;
      message?: string;
      code?: number;
    }

    const data = await this.requestWithRetry<QuoteApiResponse>('/price', {
      symbol: ticker,
    });

    if (data.status === 'error' || data.code !== undefined) {
      throw new TwelveDataError(
        `TwelveData error for ${ticker}: ${data.message ?? 'unknown error'}`,
        undefined,
        ticker,
      );
    }

    return {
      symbol: data.symbol ?? ticker,
      open: parseFloat(data.open ?? '0'),
      high: parseFloat(data.high ?? '0'),
      low: parseFloat(data.low ?? '0'),
      close: parseFloat(data.close ?? '0'),
      volume: parseFloat(data.volume ?? '0'),
      previousClose: parseFloat(data.previous_close ?? '0'),
      change: parseFloat(data.change ?? '0'),
      percentChange: parseFloat(data.percent_change ?? '0'),
      timestamp: data.timestamp ?? 0,
    };
  }

  getRequestCount(): number {
    return this.requestCount;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
