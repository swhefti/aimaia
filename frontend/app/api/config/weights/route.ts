import { NextResponse } from 'next/server';
import { getConfigNumberBatch } from '@/lib/config';

export const revalidate = 300; // ISR: revalidate every 5 minutes

export async function GET() {
  const cfg = await getConfigNumberBatch({
    weight_stock_technical: 0.50,
    weight_stock_sentiment: 0.25,
    weight_stock_fundamental: 0.20,
    weight_stock_regime: 0.05,
    weight_crypto_technical: 0.50,
    weight_crypto_sentiment: 0.25,
    weight_crypto_fundamental: 0.00,
    weight_crypto_regime: 0.25,
    weight_crypto_sentiment_missing_technical: 0.65,
    weight_crypto_sentiment_missing_regime: 0.35,
  });

  const stock = {
    technical: cfg['weight_stock_technical']!,
    sentiment: cfg['weight_stock_sentiment']!,
    fundamental: cfg['weight_stock_fundamental']!,
    regime: cfg['weight_stock_regime']!,
  };

  const crypto = {
    technical: cfg['weight_crypto_technical']!,
    sentiment: cfg['weight_crypto_sentiment']!,
    fundamental: cfg['weight_crypto_fundamental']!,
    regime: cfg['weight_crypto_regime']!,
  };

  // Use configured values for crypto sentiment-missing redistribution
  const cryptoSentimentMissing = {
    technical: cfg['weight_crypto_sentiment_missing_technical']!,
    sentiment: 0,
    fundamental: cfg['weight_crypto_fundamental']!,
    regime: cfg['weight_crypto_sentiment_missing_regime']!,
  };

  return NextResponse.json(
    { stock, crypto, cryptoSentimentMissing },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    },
  );
}
