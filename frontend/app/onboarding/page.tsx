'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { createPortfolio, setCashBalance } from '@/lib/queries';
import { formatCurrency } from '@/lib/formatters';
import { ASSET_TYPE_MAP } from '@shared/lib/constants';
import type { RiskProfile, VolatilityTolerance } from '@shared/types/portfolio';
import type { AssetType } from '@shared/types/assets';
import {
  X, Check, ChevronRight, Wallet, Clock, Target, Shield,
  BarChart3, Factory, Layers, Sparkles, AlertTriangle,
  TrendingUp, PieChart,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = ['Welcome', 'Investment Capital', 'Time Horizon', 'Return Goal', 'Risk Tolerance', 'Asset Types', 'Industries', 'Portfolio Size'];

const INDUSTRIES = [
  { id: 'technology', label: 'Technology', tickers: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'ADBE', 'CRM', 'NFLX', 'AMD', 'QCOM', 'TXN', 'INTC', 'IBM', 'NOW', 'SNOW', 'PLTR', 'SHOP', 'XLK'] },
  { id: 'finance', label: 'Finance', tickers: ['JPM', 'V', 'MA', 'GS', 'MS', 'BAC', 'PYPL', 'SQ', 'COIN', 'HOOD', 'SOFI', 'XLF'] },
  { id: 'healthcare', label: 'Healthcare', tickers: ['JNJ', 'UNH', 'LLY', 'ABBV', 'MRK', 'XLV'] },
  { id: 'consumer', label: 'Consumer & Entertainment', tickers: ['PG', 'HD', 'PEP', 'KO', 'COST', 'WMT', 'TGT', 'DIS', 'PINS', 'SNAP', 'RBLX'] },
  { id: 'energy_industrial', label: 'Energy & Industrial', tickers: ['XOM', 'XLE', 'USO', 'HON', 'BA', 'CAT', 'GE', 'XLI'] },
  { id: 'automotive', label: 'Automotive & Mobility', tickers: ['TSLA', 'F', 'GM', 'RIVN', 'LCID', 'NIO', 'UBER', 'LYFT'] },
  { id: 'crypto', label: 'Cryptocurrency', tickers: ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'MATIC', 'LTC', 'BCH', 'ATOM', 'UNI', 'AAVE', 'FIL', 'ICP', 'ALGO', 'XLM', 'VET'] },
  { id: 'global_diversified', label: 'Global & Diversified Markets', tickers: ['BABA', 'JD', 'PDD', 'VEA', 'EEM', 'TLT', 'HYG', 'LQD', 'GLD', 'SLV', 'SPY', 'QQQ', 'IWM', 'VTI', 'VOO', 'ARKK', 'SCHD'] },
] as const;

function formatHorizon(months: number): string {
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const yLabel = `${years} year${years === 1 ? '' : 's'}`;
  if (rem === 0) return yLabel;
  return `${yLabel}, ${rem} mo`;
}

function getMaxReturnPct(months: number): number {
  if (months <= 1) return 3;
  if (months <= 2) return 5;
  if (months <= 3) return 8;
  if (months <= 6) return 12;
  if (months <= 9) return 16;
  if (months <= 12) return 20;
  if (months <= 24) return 35;
  if (months <= 36) return 50;
  if (months <= 48) return 65;
  return 80;
}

interface ReturnSegment {
  label: string;
  description: string;
  min: number;
  max: number;
}

function getReturnSegments(maxPct: number): ReturnSegment[] {
  const range = maxPct - 1;
  const segSize = range / 6;
  const boundaries = Array.from({ length: 7 }, (_, i) => Math.round(1 + segSize * i));
  boundaries[6] = maxPct;
  return [
    { label: 'Capital Preservation', description: 'Prioritize keeping your capital safe with minimal risk.', min: boundaries[0]!, max: boundaries[1]! },
    { label: 'Conservative Growth', description: 'Seek modest, steady returns with low exposure to volatility.', min: boundaries[1]!, max: boundaries[2]! },
    { label: 'Moderate Growth', description: 'Balance between growth and stability for reliable compounding.', min: boundaries[2]!, max: boundaries[3]! },
    { label: 'Growth', description: 'Target above-average returns, accepting moderate market swings.', min: boundaries[3]!, max: boundaries[4]! },
    { label: 'Aggressive Growth', description: 'Pursue high returns with willingness to endure significant drawdowns.', min: boundaries[4]!, max: boundaries[5]! },
    { label: 'Maximum Growth', description: 'Maximize returns at all costs, comfortable with high risk and large swings.', min: boundaries[5]!, max: boundaries[6]! },
  ];
}

function getSegmentForReturn(pct: number, segments: ReturnSegment[]): ReturnSegment {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (pct >= segments[i]!.min) return segments[i]!;
  }
  return segments[0]!;
}

function annualizedReturn(totalPct: number, months: number): number {
  if (months <= 0) return 0;
  const r = totalPct / 100;
  return (Math.pow(1 + r, 12 / months) - 1) * 100;
}

function deriveRiskProfile(returnPct: number, maxPct: number): RiskProfile {
  const ratio = returnPct / maxPct;
  if (ratio < 0.25) return 'conservative';
  if (ratio < 0.55) return 'balanced';
  return 'aggressive';
}

// ---------------------------------------------------------------------------
// Types for optimizer response
// ---------------------------------------------------------------------------

interface OptimizerWeight {
  ticker: string;
  weightPct: number;
  name: string;
  assetType: string;
  score: number;
  confidence: number;
  price: number;
}

interface OptimizerBuildResult {
  targetWeights: OptimizerWeight[];
  cashWeightPct: number;
  riskSummary: {
    expectedReturn: number;
    portfolioVolatility: number;
    concentrationRisk: number;
    diversificationScore: number;
    cryptoAllocationPct: number;
  };
  metadata: {
    candidatesConsidered: number;
    constraintsActive: string[];
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const { user, supabase, isGuest } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Step 1: Capital
  const [capital, setCapital] = useState(10000);

  // Step 2: Horizon
  const [horizonMonths, setHorizonMonths] = useState(12);

  // Step 3: Return Goal
  const maxReturnPct = getMaxReturnPct(horizonMonths);
  const [returnGoalPct, setReturnGoalPct] = useState(Math.round((maxReturnPct / 3) * 10) / 10);
  const segments = getReturnSegments(maxReturnPct);
  const activeSegment = getSegmentForReturn(returnGoalPct, segments);
  const annualized = annualizedReturn(returnGoalPct, horizonMonths);

  const prevHorizonRef = useRef(horizonMonths);
  useEffect(() => {
    if (horizonMonths !== prevHorizonRef.current) {
      prevHorizonRef.current = horizonMonths;
      const minT = Math.round((Math.pow(1.01, horizonMonths / 12) - 1) * 1000) / 10;
      const maxT = Math.round((Math.pow(1.15, horizonMonths / 12) - 1) * 1000) / 10;
      setReturnGoalPct((prev) => Math.min(Math.max(prev, minT), maxT));
    }
  }, [horizonMonths]);

  // Step 4: Risk
  const [volatility, setVolatility] = useState<VolatilityTolerance>('balanced');
  const [maxDrawdown, setMaxDrawdown] = useState(0.15);

  // Step 5: Asset Types
  const [assetTypes, setAssetTypes] = useState<AssetType[]>(['stock', 'etf', 'crypto']);

  // Step 6: Industries
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>(
    INDUSTRIES.map((i) => i.id)
  );

  // Step 7: Portfolio Size
  const [maxPositions, setMaxPositions] = useState(8);

  // Optimizer flow state
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [draft, setDraft] = useState<OptimizerBuildResult | null>(null);
  const [showDraft, setShowDraft] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const riskProfile = deriveRiskProfile(returnGoalPct, maxReturnPct);

  // Build allowed tickers from selected industries
  function getAllowedTickers(): string[] {
    const tickers = new Set<string>();
    for (const ind of INDUSTRIES) {
      if (selectedIndustries.includes(ind.id)) {
        for (const t of ind.tickers) tickers.add(t);
      }
    }
    return [...tickers];
  }

  async function handleBuildPortfolio() {
    if (!user) return;
    setBuilding(true);
    setBuildError(null);

    try {
      const allowedTickers = getAllowedTickers();

      const res = await fetch('/api/optimizer/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          capital,
          timeHorizonMonths: horizonMonths,
          goalReturnPct: returnGoalPct / 100,
          maxDrawdownLimitPct: maxDrawdown,
          riskProfile,
          volatilityTolerance: volatility,
          assetTypes,
          maxPositions,
          allowedTickers: allowedTickers.length > 0 ? allowedTickers : undefined,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errBody.error || `Server error (${res.status})`);
      }

      const result: OptimizerBuildResult = await res.json();
      setDraft(result);
      setShowDraft(true);
    } catch (err) {
      console.error('Build error:', err);
      setBuildError(err instanceof Error ? err.message : 'Failed to generate portfolio');
    } finally {
      setBuilding(false);
    }
  }

  async function handleRemoveAndRebuild(tickerToRemove: string) {
    if (!user || !draft) return;
    setBuilding(true);
    setBuildError(null);

    try {
      const allowedTickers = getAllowedTickers();
      const excludeTickers = [tickerToRemove];

      const res = await fetch('/api/optimizer/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          capital,
          timeHorizonMonths: horizonMonths,
          goalReturnPct: returnGoalPct / 100,
          maxDrawdownLimitPct: maxDrawdown,
          riskProfile,
          volatilityTolerance: volatility,
          assetTypes,
          maxPositions,
          allowedTickers: allowedTickers.length > 0 ? allowedTickers : undefined,
          excludeTickers,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errBody.error || 'Rebuild failed');
      }

      const result: OptimizerBuildResult = await res.json();
      setDraft(result);
    } catch (err) {
      console.error('Rebuild error:', err);
      setBuildError(err instanceof Error ? err.message : 'Failed to rebuild portfolio');
    } finally {
      setBuilding(false);
    }
  }

  async function handleFinalize() {
    if (!user || !draft) return;
    setFinalizing(true);

    try {
      if (isGuest) {
        // Guest mode: save to sessionStorage
        sessionStorage.setItem('guest_profile', JSON.stringify({
          userId: 'guest-local',
          investmentCapital: capital,
          timeHorizonMonths: horizonMonths,
          riskProfile,
          goalReturnPct: returnGoalPct / 100,
          maxDrawdownLimitPct: maxDrawdown,
          volatilityTolerance: volatility,
          assetTypes,
          maxPositions,
          rebalancingPreference: 'daily',
          onboardingCompletedAt: new Date().toISOString(),
        }));
        const positions = draft.targetWeights.map((tw) => ({
          id: crypto.randomUUID(),
          portfolioId: 'guest-portfolio',
          ticker: tw.ticker,
          quantity: tw.price > 0 ? (capital * tw.weightPct / 100) / tw.price : 0,
          avgPurchasePrice: tw.price,
          openedAt: new Date().toISOString(),
        }));
        sessionStorage.setItem('guest_positions', JSON.stringify(positions));
        router.push('/dashboard');
        return;
      }

      const res = await fetch('/api/optimizer/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          capital,
          positions: draft.targetWeights.map((tw) => ({
            ticker: tw.ticker,
            weightPct: tw.weightPct,
            price: tw.price,
          })),
          cashWeightPct: draft.cashWeightPct,
          profile: {
            investmentCapital: capital,
            timeHorizonMonths: horizonMonths,
            riskProfile,
            goalReturnPct: returnGoalPct / 100,
            maxDrawdownLimitPct: maxDrawdown,
            volatilityTolerance: volatility,
            assetTypes,
            maxPositions,
          },
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errBody.error || 'Finalize failed');
      }

      router.push('/dashboard');
    } catch (err) {
      console.error('Finalize error:', err);
      setBuildError(err instanceof Error ? err.message : 'Failed to finalize portfolio');
    } finally {
      setFinalizing(false);
    }
  }

  // Skip onboarding
  async function handleSkip() {
    if (!isGuest && user) {
      try {
        await supabase.from('user_profiles').upsert({
          user_id: user.id,
          onboarding_completed_at: new Date().toISOString(),
          investment_capital: 10000,
          time_horizon_months: 12,
          risk_profile: 'balanced',
          goal_return_pct: 0.07,
          max_drawdown_limit_pct: 15,
          volatility_tolerance: 'balanced',
          max_positions: 8,
        }, { onConflict: 'user_id' });
        const portfolioId = await createPortfolio(supabase, user.id, 'My Portfolio');
        await setCashBalance(supabase, portfolioId, 10000);
      } catch (err) {
        console.error('Skip setup error:', err);
      }
    }
    router.push('/dashboard');
  }

  return (
    <div className="min-h-screen w-full bg-[#0F2036] relative">
      <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, #152a45 1px, transparent 1px),
            linear-gradient(to bottom, #152a45 1px, transparent 1px)
          `,
          backgroundSize: '38px 15px',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)',
        }}
      />
    <main className="flex items-center justify-center min-h-screen px-4 py-8 relative z-10">
      <div className="w-full max-w-lg">
        {!showDraft ? (
          <>
            {/* Progress */}
            {step > 0 && (
              <div className="mb-8">
                <div className="flex justify-between text-sm text-gray-400 mb-2">
                  <span>Step {step} of {STEPS.length - 1}</span>
                  <span>{STEPS[step]}</span>
                </div>
                <div className="w-full h-1.5 bg-navy-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-blue rounded-full transition-all duration-300"
                    style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Step 0: Welcome */}
            {step === 0 && (
              <Card padding="lg">
                <div className="space-y-6 text-center py-4">
                  <Sparkles className="h-10 w-10 text-accent-blue mx-auto" strokeWidth={1.5} />
                  <div>
                    <h1 className="text-2xl font-bold text-white">
                      Welcome {user?.user_metadata?.full_name ? user.user_metadata.full_name.split(' ')[0] : ''}
                    </h1>
                    <p className="text-gray-400 mt-3 leading-relaxed max-w-md mx-auto">
                      aiMAIA (prototype) is your AI-powered portfolio advisor. Answer a few questions and our optimizer will build you a personalized portfolio based on your goals and risk tolerance.
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-3 pt-2">
                    <Button size="lg" onClick={() => setStep(1)}>
                      Build Portfolio
                    </Button>
                    <button
                      onClick={handleSkip}
                      className="text-sm text-gray-400 hover:text-gray-300 transition-colors underline underline-offset-2"
                    >
                      Skip for now
                    </button>
                  </div>
                </div>
              </Card>
            )}

            {step > 0 && (
            <Card padding="lg">
              {/* Step 1: Investment Capital */}
              {step === 1 && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-3">
                    <Wallet className="h-8 w-8 text-accent-blue" strokeWidth={1.5} />
                    <h2 className="text-xl font-semibold text-white">How much are you investing?</h2>
                  </div>
                  <div className="text-center">
                    <span className="text-4xl font-bold text-white">{formatCurrency(capital)}</span>
                  </div>
                  <div>
                    <input
                      type="range"
                      min={100}
                      max={100000}
                      step={100}
                      value={capital}
                      onChange={(e) => setCapital(Number(e.target.value))}
                      className="w-full accent-accent-blue"
                    />
                  </div>
                </div>
              )}

              {/* Step 2: Time Horizon */}
              {step === 2 && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-3">
                    <Clock className="h-8 w-8 text-accent-blue" strokeWidth={1.5} />
                    <div className="text-center">
                      <h2 className="text-xl font-semibold text-white">What&apos;s your investment horizon?</h2>
                      <p className="text-sm text-gray-400 mt-1">How long do you plan to keep this portfolio active?</p>
                    </div>
                  </div>
                  <div className="text-center">
                    <span className="text-3xl font-bold text-white">{formatHorizon(horizonMonths)}</span>
                  </div>
                  <div className="space-y-2">
                    <input type="range" min={1} max={60} step={1} value={horizonMonths}
                      onChange={(e) => setHorizonMonths(Number(e.target.value))}
                      className="w-full accent-accent-blue"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>1 month</span><span>5 years</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Return Goal */}
              {step === 3 && (() => {
                const minTotal = Math.round((Math.pow(1 + 0.01, horizonMonths / 12) - 1) * 1000) / 10;
                const maxTotal = Math.round((Math.pow(1 + 0.15, horizonMonths / 12) - 1) * 1000) / 10;
                return (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-3">
                    <Target className="h-8 w-8 text-accent-blue" strokeWidth={1.5} />
                    <div className="text-center">
                      <h2 className="text-xl font-semibold text-white">What&apos;s your return goal?</h2>
                      <p className="text-sm text-gray-400 mt-1">
                        Total return on invested capital over your {formatHorizon(horizonMonths)} horizon.
                      </p>
                    </div>
                  </div>
                  <div className="text-center">
                    <span className="text-4xl font-bold text-white">{returnGoalPct.toFixed(1)}%</span>
                    <span className="text-sm text-gray-400 ml-2">({annualized.toFixed(1)}% annualized)</span>
                  </div>
                  <div className="space-y-2">
                    <input type="range" min={minTotal} max={maxTotal} step={0.1}
                      value={Math.min(Math.max(returnGoalPct, minTotal), maxTotal)}
                      onChange={(e) => setReturnGoalPct(Number(e.target.value))}
                      className="w-full accent-accent-blue"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{minTotal.toFixed(1)}%</span><span>{maxTotal.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="bg-navy-700/50 rounded-lg px-4 py-3 border border-navy-600">
                    <p className="text-sm font-medium text-accent-blue">{activeSegment.label}</p>
                    <p className="text-sm text-gray-300 mt-1">{activeSegment.description}</p>
                  </div>
                  <div className="flex gap-1">
                    {segments.map((seg, i) => (
                      <div key={i} className={`flex-1 h-1.5 rounded-full transition-colors ${seg.label === activeSegment.label ? 'bg-accent-blue' : 'bg-navy-600'}`} />
                    ))}
                  </div>
                </div>
                );
              })()}

              {/* Step 4: Risk Tolerance */}
              {step === 4 && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-3">
                    <Shield className="h-8 w-8 text-accent-blue" strokeWidth={1.5} />
                    <div className="text-center">
                      <h2 className="text-xl font-semibold text-white">How much risk can you handle?</h2>
                      <p className="text-sm text-gray-400 mt-1">This helps us calibrate position sizing and asset selection.</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Volatility Tolerance</label>
                    <p className="text-xs text-gray-500 mb-3">How much daily price fluctuation you&apos;re comfortable seeing.</p>
                    <div className="space-y-2">
                      {([
                        { value: 'moderate' as const, label: 'Moderate', desc: 'I prefer stability over returns' },
                        { value: 'balanced' as const, label: 'Balanced', desc: 'I can handle normal market swings' },
                        { value: 'tolerant' as const, label: 'Tolerant', desc: 'Large swings are fine for bigger upside' },
                      ]).map((opt) => (
                        <button key={opt.value} onClick={() => setVolatility(opt.value)}
                          className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors ${volatility === opt.value ? 'border-accent-blue bg-accent-blue/10 text-white' : 'border-navy-500 bg-navy-700 text-gray-300 hover:border-navy-400'}`}>
                          <span className="font-medium">{opt.label}</span>
                          <span className="text-gray-400 ml-2">— {opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Maximum Drawdown Limit</label>
                    <p className="text-xs text-gray-500 mb-3">The largest decline you&apos;d accept before the system protects your capital.</p>
                    <div className="flex gap-2">
                      {[
                        { label: '5%', value: 0.05 }, { label: '10%', value: 0.10 },
                        { label: '15%', value: 0.15 }, { label: '20%', value: 0.20 },
                        { label: '30%', value: 0.30 },
                      ].map((opt) => (
                        <button key={opt.value} onClick={() => setMaxDrawdown(opt.value)}
                          className={`flex-1 px-2 py-2 rounded-lg border text-sm font-medium transition-colors ${maxDrawdown === opt.value ? 'border-accent-blue bg-accent-blue/10 text-white' : 'border-navy-500 bg-navy-700 text-gray-300 hover:border-navy-400'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 5: Asset Types */}
              {step === 5 && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-3">
                    <BarChart3 className="h-8 w-8 text-accent-blue" strokeWidth={1.5} />
                    <div className="text-center">
                      <h2 className="text-xl font-semibold text-white">What do you want to invest in?</h2>
                      <p className="text-sm text-gray-400 mt-1">Select which asset types to include.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {([
                      { value: 'stock' as const, label: 'Stocks', desc: 'Individual company shares (AAPL, MSFT, etc.)' },
                      { value: 'etf' as const, label: 'ETFs', desc: 'Diversified funds tracking indices & sectors' },
                      { value: 'crypto' as const, label: 'Crypto', desc: 'Cryptocurrencies (BTC, ETH, SOL, etc.)' },
                    ]).map((opt) => {
                      const selected = assetTypes.includes(opt.value);
                      return (
                        <button key={opt.value}
                          onClick={() => setAssetTypes((prev) => selected ? prev.filter((t) => t !== opt.value) : [...prev, opt.value])}
                          className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors ${selected ? 'border-accent-blue bg-accent-blue/10 text-white' : 'border-navy-500 bg-navy-700 text-gray-300 hover:border-navy-400'}`}>
                          <div className="flex items-center justify-between">
                            <div><span className="font-medium">{opt.label}</span><span className="text-gray-400 ml-2">— {opt.desc}</span></div>
                            {selected && <Check className="h-4 w-4 text-accent-blue shrink-0" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {assetTypes.length === 0 && <p className="text-sm text-amber-400 text-center">Select at least one asset type.</p>}
                </div>
              )}

              {/* Step 6: Industries */}
              {step === 6 && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-3">
                    <Factory className="h-8 w-8 text-accent-blue" strokeWidth={1.5} />
                    <div className="text-center">
                      <h2 className="text-xl font-semibold text-white">Which industries interest you?</h2>
                      <p className="text-sm text-gray-400 mt-1">Pick the sectors you want the optimizer to consider.</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <button onClick={() => setSelectedIndustries(INDUSTRIES.map((i) => i.id))} className="text-xs text-accent-blue hover:text-accent-blue/80 transition-colors">Select All</button>
                    <span className="text-gray-600">|</span>
                    <button onClick={() => setSelectedIndustries([])} className="text-xs text-gray-400 hover:text-gray-300 transition-colors">Clear All</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto">
                    {INDUSTRIES.map((ind) => {
                      const selected = selectedIndustries.includes(ind.id);
                      const hasMatchingAsset = ind.tickers.some((t) => {
                        const type = ASSET_TYPE_MAP[t] ?? 'stock';
                        return assetTypes.includes(type as AssetType);
                      });
                      if (!hasMatchingAsset) return null;
                      return (
                        <button key={ind.id}
                          onClick={() => setSelectedIndustries((prev) => selected ? prev.filter((id) => id !== ind.id) : [...prev, ind.id])}
                          className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${selected ? 'border-accent-blue bg-accent-blue/10 text-white' : 'border-navy-500 bg-navy-700 text-gray-300 hover:border-navy-400'}`}>
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium truncate">{ind.label}</span>
                            {selected && <Check className="h-3.5 w-3.5 text-accent-blue shrink-0" />}
                          </div>
                          <span className="text-xs text-gray-500">{ind.tickers.length} assets</span>
                        </button>
                      );
                    })}
                  </div>
                  {selectedIndustries.length === 0 && <p className="text-sm text-amber-400 text-center">Select at least one industry.</p>}
                </div>
              )}

              {/* Step 7: Portfolio Size */}
              {step === 7 && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-3">
                    <Layers className="h-8 w-8 text-accent-blue" strokeWidth={1.5} />
                    <div className="text-center">
                      <h2 className="text-xl font-semibold text-white">How many positions?</h2>
                      <p className="text-sm text-gray-400 mt-1">More positions means broader diversification.</p>
                    </div>
                  </div>
                  <div className="text-center">
                    <span className="text-4xl font-bold text-white">{maxPositions}</span>
                    <span className="text-sm text-gray-400 ml-2">
                      {maxPositions <= 4 ? 'Focused' : maxPositions <= 8 ? 'Balanced' : 'Broad'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <input type="range" min={3} max={15} step={1} value={maxPositions}
                      onChange={(e) => setMaxPositions(Number(e.target.value))}
                      className="w-full accent-accent-blue"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>3 (focused)</span><span>15 (broad)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="flex justify-between mt-8">
                <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                  Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button onClick={() => setStep((s) => s + 1)}
                    disabled={(step === 5 && assetTypes.length === 0) || (step === 6 && selectedIndustries.length === 0)}>
                    Next <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                ) : (
                  <Button onClick={handleBuildPortfolio} disabled={building}>
                    {building ? <><Spinner size="sm" /> Optimizing...</> : 'Generate Portfolio'}
                  </Button>
                )}
              </div>

              {buildError && (
                <div className="mt-4 flex items-start gap-2 text-sm text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2 border border-amber-400/20">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{buildError}</span>
                </div>
              )}
            </Card>
            )}
          </>
        ) : draft && (
          /* ============================================================
           * PORTFOLIO DRAFT — optimizer-generated allocation table
           * ============================================================ */
          <div className="space-y-4">
            <Card padding="lg">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <PieChart className="h-6 w-6 text-accent-blue" strokeWidth={1.5} />
                  <div>
                    <h2 className="text-lg font-semibold text-white">Your Proposed Portfolio</h2>
                    <p className="text-sm text-gray-400">
                      {draft.targetWeights.length} positions, {draft.cashWeightPct.toFixed(1)}% cash reserve
                    </p>
                  </div>
                </div>

                {/* Summary metrics */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-navy-700/50 rounded-lg px-3 py-2 border border-navy-600">
                    <p className="text-xs text-gray-400">Capital</p>
                    <p className="text-sm font-medium text-white">{formatCurrency(capital)}</p>
                  </div>
                  <div className="bg-navy-700/50 rounded-lg px-3 py-2 border border-navy-600">
                    <p className="text-xs text-gray-400">Diversification</p>
                    <p className="text-sm font-medium text-white">{(draft.riskSummary.diversificationScore * 100).toFixed(0)}%</p>
                  </div>
                  <div className="bg-navy-700/50 rounded-lg px-3 py-2 border border-navy-600">
                    <p className="text-xs text-gray-400">Positions</p>
                    <p className="text-sm font-medium text-white">{draft.targetWeights.length}</p>
                  </div>
                </div>

                {draft.riskSummary.cryptoAllocationPct > 0 && (
                  <div className="text-xs text-gray-400">
                    Crypto allocation: {draft.riskSummary.cryptoAllocationPct.toFixed(1)}%
                  </div>
                )}
              </div>
            </Card>

            {/* Allocation table */}
            <Card padding="lg">
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Target Allocations</h3>
                {draft.targetWeights.map((tw) => {
                  const amount = capital * (tw.weightPct / 100);
                  const typeLabel = tw.assetType === 'crypto' ? 'Crypto' : tw.assetType === 'etf' ? 'ETF' : 'Stock';
                  const signalColor = tw.score >= 0.6 ? 'text-green-400' : tw.score >= 0.2 ? 'text-emerald-400' : tw.score >= -0.19 ? 'text-gray-400' : 'text-red-400';
                  const signalLabel = tw.score >= 0.6 ? 'Strong' : tw.score >= 0.2 ? 'Positive' : tw.score >= -0.19 ? 'Neutral' : 'Weak';

                  return (
                    <div key={tw.ticker} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-navy-700/30 border border-navy-600/50 group">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white text-sm">{tw.ticker}</span>
                          <span className="text-xs text-gray-500">{typeLabel}</span>
                          <span className={`text-xs ${signalColor}`}>{signalLabel}</span>
                        </div>
                        <p className="text-xs text-gray-400 truncate">{tw.name}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium text-white">{tw.weightPct.toFixed(1)}%</p>
                        <p className="text-xs text-gray-400">{formatCurrency(amount)}</p>
                      </div>
                      <button
                        onClick={() => handleRemoveAndRebuild(tw.ticker)}
                        disabled={building}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/20"
                        title={`Remove ${tw.ticker} and rebuild`}
                      >
                        <X className="h-3.5 w-3.5 text-red-400" />
                      </button>
                    </div>
                  );
                })}

                {/* Cash row */}
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-navy-700/30 border border-navy-600/50">
                  <div className="flex-1">
                    <span className="font-medium text-gray-300 text-sm">Cash Reserve</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-300">{draft.cashWeightPct.toFixed(1)}%</p>
                    <p className="text-xs text-gray-400">{formatCurrency(capital * draft.cashWeightPct / 100)}</p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="ghost"
                onClick={() => { setShowDraft(false); setDraft(null); }}
                className="flex-1"
              >
                Back to Settings
              </Button>
              <Button
                onClick={handleFinalize}
                disabled={finalizing || draft.targetWeights.length === 0}
                className="flex-1"
              >
                {finalizing ? <><Spinner size="sm" /> Creating...</> : 'Approve & Create Portfolio'}
              </Button>
            </div>

            {building && (
              <div className="text-center text-sm text-gray-400">
                <Spinner size="sm" />
                Rebuilding portfolio...
              </div>
            )}

            {buildError && (
              <div className="flex items-start gap-2 text-sm text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2 border border-amber-400/20">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{buildError}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
    </div>
  );
}
