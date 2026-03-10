import { NextResponse } from 'next/server';
import { getConfigNumberBatch } from '@/lib/config';

const DEFAULTS: Record<string, number> = {
  subweight_technical_macd: 0.3,
  subweight_technical_ema: 0.25,
  subweight_technical_rsi: 0.2,
  subweight_technical_bollinger: 0.15,
  subweight_technical_volume: 0.1,
};

export async function GET() {
  const weights = await getConfigNumberBatch(DEFAULTS);
  return NextResponse.json({ weights });
}
