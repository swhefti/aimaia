import { CRYPTO, ASSET_TYPE_MAP } from '../../../shared/lib/constants.js';

const CRYPTO_SET = new Set<string>(CRYPTO);

const CRYPTO_TWELVE_DATA_MAP: Record<string, string> = {
  BTC: 'BTC/USD',
  ETH: 'ETH/USD',
  BNB: 'BNB/USD',
  SOL: 'SOL/USD',
  XRP: 'XRP/USD',
  ADA: 'ADA/USD',
  AVAX: 'AVAX/USD',
  DOT: 'DOT/USD',
  LINK: 'LINK/USD',
  MATIC: 'MATIC/USD',
  LTC: 'LTC/USD',
  BCH: 'BCH/USD',
  ATOM: 'ATOM/USD',
  UNI: 'UNI/USD',
  AAVE: 'AAVE/USD',
  FIL: 'FIL/USD',
  ICP: 'ICP/USD',
  ALGO: 'ALGO/USD',
  XLM: 'XLM/USD',
  VET: 'VET/USD',
};

const CRYPTO_FINNHUB_MAP: Record<string, string> = {
  BTC: 'BINANCE:BTCUSDT',
  ETH: 'BINANCE:ETHUSDT',
  BNB: 'BINANCE:BNBUSDT',
  SOL: 'BINANCE:SOLUSDT',
  XRP: 'BINANCE:XRPUSDT',
  ADA: 'BINANCE:ADAUSDT',
  AVAX: 'BINANCE:AVAXUSDT',
  DOT: 'BINANCE:DOTUSDT',
  LINK: 'BINANCE:LINKUSDT',
  MATIC: 'BINANCE:MATICUSDT',
  LTC: 'BINANCE:LTCUSDT',
  BCH: 'BINANCE:BCHUSDT',
  ATOM: 'BINANCE:ATOMUSDT',
  UNI: 'BINANCE:UNIUSDT',
  AAVE: 'BINANCE:AAVEUSDT',
  FIL: 'BINANCE:FILUSDT',
  ICP: 'BINANCE:ICPUSDT',
  ALGO: 'BINANCE:ALGOUSDT',
  XLM: 'BINANCE:XLMUSDT',
  VET: 'BINANCE:VETUSDT',
};

export function isCrypto(ticker: string): boolean {
  return CRYPTO_SET.has(ticker);
}

export function toTwelveData(ticker: string): string {
  if (CRYPTO_SET.has(ticker)) {
    const mapped = CRYPTO_TWELVE_DATA_MAP[ticker];
    if (!mapped) throw new Error(`No Twelve Data mapping for crypto ticker: ${ticker}`);
    return mapped;
  }
  return ticker;
}

export function toFinnhub(ticker: string): string {
  if (CRYPTO_SET.has(ticker)) {
    const mapped = CRYPTO_FINNHUB_MAP[ticker];
    if (!mapped) throw new Error(`No Finnhub mapping for crypto ticker: ${ticker}`);
    return mapped;
  }
  return ticker;
}

export function getAssetType(ticker: string): 'stock' | 'etf' | 'crypto' {
  const type = ASSET_TYPE_MAP[ticker];
  if (!type) throw new Error(`Unknown ticker: ${ticker}`);
  return type;
}
