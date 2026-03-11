'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { useSimulation } from '@/components/simulation-provider';
import { SimulationBanner } from '@/components/simulation-banner';
import { Spinner } from '@/components/ui/spinner';
import { DailyBriefing } from '@/components/dashboard/daily-briefing';
import { GoalTracker } from '@/components/dashboard/goal-tracker';
import { PortfolioOverview } from '@/components/dashboard/portfolio-overview';
import { PortfolioDonut } from '@/components/dashboard/portfolio-donut';
import { PositionsTable } from '@/components/dashboard/positions-table';
import { SettingsPanel } from '@/components/dashboard/settings-panel';
import { AddPositionModal } from '@/components/dashboard/add-position-modal';
import { Logo } from '@/components/ui/logo';
import { SellPositionModal } from '@/components/dashboard/sell-position-modal';
import { TickerDetailModal } from '@/components/market/ticker-detail-modal';
import { RecommendationCard } from '@/components/portfolio/recommendation-card';
import { ReasoningModal } from '@/components/portfolio/reasoning-modal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  getUserProfile,
  getPortfolio,
  getPortfolioPositions,
  getPortfolioValuations,
  getLatestRecommendationRun,
  getRecommendationItems,
  getAgentScoresForTicker,
  submitUserDecision,
  addPortfolioPosition,
  updatePortfolioPosition,
  removePortfolioPosition,
  getCashBalance,
  setCashBalance,
  getAllLatestPrices,
  getAllLatestScores,
  getAllQuotes,
  getLatestPrices,
  upsertPortfolioValuation,
  createPortfolio,
  getDecidedRecommendationIds,
} from '@/lib/queries';
import type { UserProfile, Portfolio, PortfolioValuation } from '@shared/types/portfolio';
import type { RecommendationRun, RecommendationItem } from '@shared/types/recommendations';
import type { PortfolioPositionWithScore, TickerQuote } from '@/lib/queries';
import type { AgentScore } from '@shared/types/scores';
import { formatCurrency, computeGoalProbability, probabilityToGoalStatus } from '@/lib/formatters';
import { getWeightsForTicker, ASSET_TYPE_MAP } from '@shared/lib/constants';
import { DataFreshnessBar } from '@/components/data-freshness-bar';
import { RiskReportModal } from '@/components/dashboard/risk-report-modal';
import { LogOut, Plus, Minus, BarChart3, Settings, ShieldAlert } from 'lucide-react';

type AgentWeights = { technical: number; sentiment: number; fundamental: number; regime: number };
type WeightsConfig = { stock: AgentWeights; crypto: AgentWeights; cryptoSentimentMissing: AgentWeights } | null;

function computeWeightedComposite(scores: AgentScore[], dynamicWeights?: WeightsConfig): number {
  if (scores.length === 0) return 0;
  const ticker = scores[0]!.ticker;
  const sentEntry = scores.find((s) => s.agentType === 'sentiment');
  const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';
  const sentimentMissing = isCrypto && (!sentEntry || sentEntry.confidence === 0 || sentEntry.dataFreshness === 'missing');

  let w: AgentWeights;
  if (dynamicWeights) {
    if (sentimentMissing) w = dynamicWeights.cryptoSentimentMissing;
    else if (isCrypto) w = dynamicWeights.crypto;
    else w = dynamicWeights.stock;
  } else {
    w = getWeightsForTicker(ticker, sentimentMissing);
  }

  const tech = scores.find((s) => s.agentType === 'technical')?.score ?? 0;
  const sent = sentEntry?.score ?? 0;
  const fund = scores.find((s) => s.agentType === 'fundamental')?.score ?? 0;
  const regime = scores.find((s) => s.agentType === 'market_regime')?.score ?? 0;
  return tech * w.technical + sent * w.sentiment + fund * w.fundamental + regime * w.regime;
}
import Link from 'next/link';

export default function DashboardPage() {
  const { user, supabase, loading: authLoading, isGuest, exitGuestMode } = useAuth();
  const { isSimulation, simulationDate, isAdvancing, setAdvancing } = useSimulation();
  const router = useRouter();

  // asOfDate for all queries — null means "real today" (no filter)
  const asOfDate = isSimulation ? simulationDate ?? undefined : undefined;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [positions, setPositions] = useState<PortfolioPositionWithScore[]>([]);
  const [valuations, setValuations] = useState<PortfolioValuation[]>([]);
  const [run, setRun] = useState<RecommendationRun | null>(null);
  const [items, setItems] = useState<RecommendationItem[]>([]);
  const [agentScores, setAgentScores] = useState<Record<string, AgentScore[]>>({});
  const [latestScores, setLatestScores] = useState<Record<string, number>>({});
  const [allScores, setAllScores] = useState<Record<string, number>>({});
  const [allPrices, setAllPrices] = useState<Record<string, number>>({});
  const [allQuotes, setAllQuotes] = useState<Record<string, TickerQuote>>({});
  const [reasoningId, setReasoningId] = useState<string | null>(null);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [showSellPosition, setShowSellPosition] = useState(false);
  const [detailTicker, setDetailTicker] = useState<{ ticker: string; name?: string } | null>(null);
  const [cashBalance, setCashBalanceState] = useState<number | null>(null);
  const [showRiskReport, setShowRiskReport] = useState(false);
  const [aiOpusPct, setAiOpusPct] = useState<number | null>(null);
  const [aiSonnetPct, setAiSonnetPct] = useState<number | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [weightsConfig, setWeightsConfig] = useState<WeightsConfig>(null);

  // Fetch dynamic weights once
  useEffect(() => {
    fetch('/api/config/weights')
      .then((r) => r.json())
      .then((d: { stock: AgentWeights; crypto: AgentWeights; cryptoSentimentMissing: AgentWeights }) =>
        setWeightsConfig(d),
      )
      .catch(() => {});
  }, []);

  // Fees preference
  const feesEnabled = typeof window !== 'undefined' && localStorage.getItem('maipa_include_fees') === 'true';
  const feeMultiplier = feesEnabled ? 0.99 : 1; // 1% fee on buys

  // --- AI probability fetcher ---
  const fetchAiProbability = useCallback(async (
    prof: UserProfile,
    pos: PortfolioPositionWithScore[],
    prices: Record<string, number>,
    tValue: number,
    cValue: number,
  ) => {
    if (isGuest) return;
    setAiLoading(true);

    const investmentCapital = prof.investmentCapital;
    const cumulativeReturnPct = investmentCapital > 0
      ? (tValue - investmentCapital) / investmentCapital
      : 0;

    const positionsPayload = pos.map((p) => {
      const currentPrice = prices[p.ticker] ?? p.avgPurchasePrice;
      const currentValue = p.quantity * currentPrice;
      return {
        ticker: p.ticker,
        quantity: p.quantity,
        avgPurchasePrice: p.avgPurchasePrice,
        currentPrice,
        currentValue,
        allocationPct: tValue > 0 ? (currentValue / tValue) * 100 : 0,
        unrealizedPnlPct: p.avgPurchasePrice > 0 ? (currentPrice - p.avgPurchasePrice) / p.avgPurchasePrice : 0,
      };
    });

    const payload = JSON.stringify({
      goalReturnPct: prof.goalReturnPct,
      timeHorizonMonths: prof.timeHorizonMonths,
      riskProfile: prof.riskProfile,
      investmentCapital,
      totalValue: tValue,
      cashValue: cValue,
      cumulativeReturnPct,
      positions: positionsPayload,
    });

    // Call each model separately so each gets its own Vercel timeout window
    const fetchModel = async (model: string): Promise<number | null> => {
      try {
        const resp = await fetch(`/api/portfolio/ai-probability?model=${model}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        if (resp.ok) {
          const result = await resp.json() as { probability: number | null };
          return result.probability;
        }
      } catch { /* non-blocking */ }
      return null;
    };

    // Fire both in parallel, update each as it arrives
    const opusPromise = fetchModel('opus').then((p) => { setAiOpusPct(p); });
    const sonnetPromise = fetchModel('sonnet').then((p) => { setAiSonnetPct(p); });

    await Promise.allSettled([opusPromise, sonnetPromise]);
    setAiLoading(false);
  }, [isGuest]);

  // --- Guest/Simulation mode loader ---
  const loadGuestDashboard = useCallback(async () => {
    const stored = sessionStorage.getItem('guest_profile');
    if (!stored) {
      router.push('/onboarding');
      return;
    }

    const guestProfile = JSON.parse(stored) as UserProfile;
    setProfile(guestProfile);

    // Fake portfolio
    setPortfolio({
      id: 'guest-portfolio',
      userId: 'guest-local',
      name: 'Guest Portfolio',
      createdAt: new Date().toISOString(),
      status: 'active',
    });

    // Load guest positions from sessionStorage
    const storedPositions = sessionStorage.getItem('guest_positions');
    const guestPositions: PortfolioPositionWithScore[] = storedPositions
      ? JSON.parse(storedPositions)
      : [];
    setPositions(guestPositions);

    const dateStr = asOfDate ?? new Date().toISOString().split('T')[0]!;

    try {
      // Load real market data (prices + scores + quotes) from DB — read-only, date-filtered
      const [prices, scores, quotes] = await Promise.all([
        getAllLatestPrices(supabase, asOfDate),
        getAllLatestScores(supabase, asOfDate),
        getAllQuotes(supabase, asOfDate),
      ]);

      setAllPrices(prices);
      setAllScores(scores);
      setAllQuotes(quotes);

      // Compute valuation using real market prices
      let positionsMarketValue = 0;
      let positionsCostBasis = 0;
      for (const p of guestPositions) {
        const price = prices[p.ticker] ?? p.avgPurchasePrice;
        positionsMarketValue += p.quantity * price;
        positionsCostBasis += p.quantity * p.avgPurchasePrice;
      }
      const guestCash = Math.max(0, guestProfile.investmentCapital - positionsCostBasis);
      const totalVal = positionsMarketValue + guestCash;
      const guestCumReturn = guestProfile.investmentCapital > 0
        ? (totalVal - guestProfile.investmentCapital) / guestProfile.investmentCapital
        : 0;

      // Compute average composite score for positions
      let avgPosScore: number | undefined;
      const posScoreVals = guestPositions
        .map((p) => scores[p.ticker])
        .filter((s): s is number => s !== undefined);
      if (posScoreVals.length > 0) {
        avgPosScore = posScoreVals.reduce((a, b) => a + b, 0) / posScoreVals.length;
      }

      const guestGoalProb = computeGoalProbability({
        cumulativeReturn: guestCumReturn,
        goalReturn: guestProfile.goalReturnPct,
        monthsRemaining: guestProfile.timeHorizonMonths,
        avgCompositeScore: avgPosScore,
        positionCount: guestPositions.length,
        maxPositions: guestProfile.maxPositions,
        riskProfile: guestProfile.riskProfile,
      });

      // Load existing valuation history from sessionStorage (simulation accumulates)
      const storedVals: PortfolioValuation[] = isSimulation
        ? JSON.parse(sessionStorage.getItem('simulation_valuations') || '[]')
        : [];

      // Previous day's value for daily P&L
      const prevVal = storedVals.length > 0 ? storedVals[storedVals.length - 1]! : undefined;
      const dailyPnl = prevVal ? totalVal - prevVal.totalValue : 0;

      const todayVal: PortfolioValuation = {
        portfolioId: 'guest-portfolio',
        date: dateStr,
        totalValue: totalVal,
        cashValue: guestCash,
        dailyPnl,
        cumulativeReturnPct: guestCumReturn,
        goalProbabilityPct: guestGoalProb,
      };

      // Accumulate: replace if same date, else append
      const history = storedVals.filter((v) => v.date !== dateStr);
      history.push(todayVal);
      // Sort by date
      history.sort((a, b) => a.date.localeCompare(b.date));

      if (isSimulation) {
        sessionStorage.setItem('simulation_valuations', JSON.stringify(history));
      }

      setValuations(history);

      // Set composite scores for positions
      const compositeMap: Record<string, number> = {};
      for (const p of guestPositions) {
        if (scores[p.ticker] !== undefined) {
          compositeMap[p.ticker] = scores[p.ticker]!;
        }
      }
      setLatestScores(compositeMap);

      // Fetch per-position agent scores (for expanded view)
      const scoresMap: Record<string, AgentScore[]> = {};
      await Promise.all(
        guestPositions.map(async (p) => {
          try {
            const posScores = await getAgentScoresForTicker(supabase, p.ticker, undefined, asOfDate);
            scoresMap[p.ticker] = posScores;
            if (posScores.length > 0) {
              compositeMap[p.ticker] = computeWeightedComposite(posScores, weightsConfig);
            }
          } catch { /* Non-blocking */ }
        })
      );
      setAgentScores(scoresMap);
      setLatestScores({ ...compositeMap });
    } catch {
      // Fallback: compute from cost basis only
      let positionsValue = 0;
      for (const p of guestPositions) {
        positionsValue += p.quantity * p.avgPurchasePrice;
      }
      const guestCash = Math.max(0, guestProfile.investmentCapital - positionsValue);
      const totalVal = positionsValue + guestCash;
      const guestCumReturn = guestProfile.investmentCapital > 0
        ? (totalVal - guestProfile.investmentCapital) / guestProfile.investmentCapital
        : 0;
      const guestGoalProb = computeGoalProbability({
        cumulativeReturn: guestCumReturn,
        goalReturn: guestProfile.goalReturnPct,
        monthsRemaining: guestProfile.timeHorizonMonths,
        positionCount: guestPositions.length,
        maxPositions: guestProfile.maxPositions,
        riskProfile: guestProfile.riskProfile,
      });
      setValuations([{
        portfolioId: 'guest-portfolio',
        date: dateStr,
        totalValue: totalVal,
        cashValue: guestCash,
        dailyPnl: 0,
        cumulativeReturnPct: guestCumReturn,
        goalProbabilityPct: guestGoalProb,
      }]);
    }

    setLoading(false);
  }, [supabase, router, asOfDate, isSimulation]);

  // --- Regular mode loader ---
  const loadDashboard = useCallback(async () => {
    if (!user) return;
    try {
      const [userProfile, userPortfolio] = await Promise.all([
        getUserProfile(supabase, user.id),
        getPortfolio(supabase, user.id),
      ]);
      setProfile(userProfile);
      setPortfolio(userPortfolio);

      if (!userProfile || !userProfile.investmentCapital) {
        router.push('/onboarding');
        return;
      }

      const [prices, scores, quotes] = await Promise.all([
        getAllLatestPrices(supabase),
        getAllLatestScores(supabase),
        getAllQuotes(supabase),
      ]);
      setAllPrices(prices);
      setAllScores(scores);
      setAllQuotes(quotes);

      if (!userPortfolio) {
        try {
          const newId = await createPortfolio(supabase, user.id, 'My Portfolio');
          // Initialize cash_balance to investment capital
          await setCashBalance(supabase, newId, userProfile.investmentCapital);
          setCashBalanceState(userProfile.investmentCapital);

          const newPortfolio: Portfolio = {
            id: newId,
            userId: user.id,
            name: 'My Portfolio',
            createdAt: new Date().toISOString(),
            status: 'active',
          };
          setPortfolio(newPortfolio);

          const newPortfolioProb = computeGoalProbability({
            cumulativeReturn: 0,
            goalReturn: userProfile.goalReturnPct,
            monthsRemaining: userProfile.timeHorizonMonths,
            positionCount: 0,
            maxPositions: userProfile.maxPositions,
            riskProfile: userProfile.riskProfile,
          });
          await upsertPortfolioValuation(
            supabase, newId,
            userProfile.investmentCapital, userProfile.investmentCapital,
            0, 0, newPortfolioProb
          );
          setValuations([{
            portfolioId: newId,
            date: new Date().toISOString().split('T')[0]!,
            totalValue: userProfile.investmentCapital,
            cashValue: userProfile.investmentCapital,
            dailyPnl: 0,
            cumulativeReturnPct: 0,
            goalProbabilityPct: newPortfolioProb,
          }]);
        } catch {
          // Portfolio may already exist
        }
        setLoading(false);
        return;
      }

      const [pos, vals, recRun, dbCash] = await Promise.all([
        getPortfolioPositions(supabase, userPortfolio.id),
        getPortfolioValuations(supabase, userPortfolio.id, 30),
        getLatestRecommendationRun(supabase, userPortfolio.id),
        getCashBalance(supabase, userPortfolio.id),
      ]);
      setPositions(pos);
      setRun(recRun);
      setCashBalanceState(dbCash);

      // Always compute a valuation from positions (source of truth)
      if (pos.length > 0 && userProfile) {
        let posMarketValue = 0;
        let posCostBasis = 0;
        for (const p of pos) {
          const price = prices[p.ticker] ?? p.avgPurchasePrice;
          posMarketValue += p.quantity * price;
          posCostBasis += p.quantity * p.avgPurchasePrice;
        }
        const computedCash = dbCash ?? Math.max(0, userProfile.investmentCapital - posCostBasis);
        const computedTotal = posMarketValue + computedCash;
        const cumulReturn = userProfile.investmentCapital > 0
          ? (computedTotal - userProfile.investmentCapital) / userProfile.investmentCapital
          : 0;

        // Compute average composite score for positions
        let avgPosScore: number | undefined;
        const posScoreVals = pos
          .map((p) => scores[p.ticker])
          .filter((s): s is number => s !== undefined);
        if (posScoreVals.length > 0) {
          avgPosScore = posScoreVals.reduce((a, b) => a + b, 0) / posScoreVals.length;
        }

        const goalProb = computeGoalProbability({
          cumulativeReturn: cumulReturn,
          goalReturn: userProfile.goalReturnPct,
          monthsRemaining: userProfile.timeHorizonMonths,
          avgCompositeScore: avgPosScore,
          positionCount: pos.length,
          maxPositions: userProfile.maxPositions,
          riskProfile: userProfile.riskProfile,
        });

        const todayVal: PortfolioValuation = {
          portfolioId: userPortfolio.id,
          date: new Date().toISOString().split('T')[0]!,
          totalValue: computedTotal,
          cashValue: computedCash,
          dailyPnl: 0,
          cumulativeReturnPct: cumulReturn,
          goalProbabilityPct: goalProb,
        };

        // Keep historical valuations but ensure today is correct
        const today = new Date().toISOString().split('T')[0];
        const historical = vals.filter((v) => v.date !== today);
        setValuations([...historical, todayVal]);

        // Persist
        upsertPortfolioValuation(
          supabase, userPortfolio.id, computedTotal, computedCash, 0, cumulReturn, todayVal.goalProbabilityPct
        ).catch(() => {});
      } else if (userProfile) {
        // No positions — total is just cash
        const emptyTotal = dbCash ?? userProfile.investmentCapital;
        const emptyCumReturn = userProfile.investmentCapital > 0
          ? (emptyTotal - userProfile.investmentCapital) / userProfile.investmentCapital
          : 0;
        const emptyGoalProb = computeGoalProbability({
          cumulativeReturn: emptyCumReturn,
          goalReturn: userProfile.goalReturnPct,
          monthsRemaining: userProfile.timeHorizonMonths,
          positionCount: 0,
          maxPositions: userProfile.maxPositions,
          riskProfile: userProfile.riskProfile,
        });
        const today = new Date().toISOString().split('T')[0]!;
        const emptyVal: PortfolioValuation = {
          portfolioId: userPortfolio.id,
          date: today,
          totalValue: emptyTotal,
          cashValue: emptyTotal,
          dailyPnl: 0,
          cumulativeReturnPct: emptyCumReturn,
          goalProbabilityPct: emptyGoalProb,
        };
        const historical = vals.filter((v) => v.date !== today);
        setValuations([...historical, emptyVal]);

        // Persist valuation so chart history starts accumulating from day one
        upsertPortfolioValuation(
          supabase, userPortfolio.id, emptyTotal, emptyTotal, 0, emptyCumReturn, emptyGoalProb
        ).catch(() => {});
      } else {
        setValuations(vals);
      }

      if (recRun) {
        const [recItems, decidedIds] = await Promise.all([
          getRecommendationItems(supabase, recRun.id),
          getDecidedRecommendationIds(supabase, user.id),
        ]);
        setItems(recItems.filter((i) => !decidedIds.has(i.id)));
      }

      const scoresMap: Record<string, AgentScore[]> = {};
      const compositeMap: Record<string, number> = {};
      await Promise.all(
        pos.map(async (p) => {
          try {
            const posScores = await getAgentScoresForTicker(supabase, p.ticker);
            scoresMap[p.ticker] = posScores;
            if (posScores.length > 0) {
              compositeMap[p.ticker] = computeWeightedComposite(posScores, weightsConfig);
            }
          } catch { /* Non-blocking */ }
        })
      );
      setAgentScores(scoresMap);
      setLatestScores(compositeMap);

      // Fire AI probability request (non-blocking)
      if (userProfile) {
        const computedCashVal = pos.length > 0
          ? Math.max(0, userProfile.investmentCapital - pos.reduce((s, p) => s + p.quantity * p.avgPurchasePrice, 0))
          : userProfile.investmentCapital;
        const computedTotalVal = pos.length > 0
          ? pos.reduce((s, p) => s + p.quantity * (prices[p.ticker] ?? p.avgPurchasePrice), 0) + computedCashVal
          : userProfile.investmentCapital;
        fetchAiProbability(userProfile, pos, prices, computedTotalVal, computedCashVal);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }, [user, supabase, router]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (isGuest) {
      loadGuestDashboard();
    } else {
      loadDashboard();
    }
  }, [user, authLoading, router, isGuest, loadDashboard, loadGuestDashboard]);

  // Reload when simulation date advances
  useEffect(() => {
    if (!isSimulation || !simulationDate || authLoading || !user) return;
    if (!isAdvancing) return; // Only run when triggered by advanceDay
    loadGuestDashboard().finally(() => setAdvancing(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationDate, isAdvancing]);

  // Real-time subscription (regular users only)
  useEffect(() => {
    if (!portfolio || isGuest) return;
    const channel = supabase
      .channel('recommendation_updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'recommendation_runs', filter: `portfolio_id=eq.${portfolio.id}` },
        () => { loadDashboard(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [portfolio, supabase, loadDashboard, isGuest]);

  // --- Recalculate portfolio valuation ---
  const recalculate = useCallback(async (
    currentPositions: PortfolioPositionWithScore[],
    currentProfile: UserProfile,
    portfolioId: string,
    cashBal?: number | null,
  ) => {
    const tickers = currentPositions.map((p) => p.ticker);
    let prices: Record<string, number> = {};
    if (!isGuest && tickers.length > 0) {
      prices = await getLatestPrices(supabase, tickers, asOfDate);
    }

    let positionsMarketVal = 0;
    let positionsCostBasis = 0;
    for (const pos of currentPositions) {
      const price = prices[pos.ticker] ?? allPrices[pos.ticker] ?? pos.avgPurchasePrice;
      positionsMarketVal += pos.quantity * price;
      positionsCostBasis += pos.quantity * pos.avgPurchasePrice;
    }

    const initialCapital = currentProfile.investmentCapital;
    // Use tracked cash balance for real users; fall back to cost-basis formula for legacy/guest
    const cashValue = (cashBal != null) ? cashBal : Math.max(0, initialCapital - positionsCostBasis);
    const totalValue = positionsMarketVal + cashValue;
    const cumulativeReturnPct = initialCapital > 0
      ? (totalValue - initialCapital) / initialCapital
      : 0;

    // Compute average composite score for held positions
    let avgScore: number | undefined;
    const scoreValues = currentPositions
      .map((p) => allScores[p.ticker])
      .filter((s): s is number => s !== undefined);
    if (scoreValues.length > 0) {
      avgScore = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;
    }

    const goalProbability = computeGoalProbability({
      cumulativeReturn: cumulativeReturnPct,
      goalReturn: currentProfile.goalReturnPct,
      monthsRemaining: currentProfile.timeHorizonMonths,
      avgCompositeScore: avgScore,
      positionCount: currentPositions.length,
      maxPositions: currentProfile.maxPositions,
      riskProfile: currentProfile.riskProfile,
    });

    const dateStr = asOfDate ?? new Date().toISOString().split('T')[0]!;

    setValuations((prev) => {
      const prevDayVal = prev.length > 0 ? prev[prev.length - 1]! : undefined;
      const dailyPnl = prevDayVal && prevDayVal.date !== dateStr
        ? totalValue - prevDayVal.totalValue
        : 0;

      const newVal: PortfolioValuation = {
        portfolioId,
        date: dateStr,
        totalValue,
        cashValue,
        dailyPnl,
        cumulativeReturnPct,
        goalProbabilityPct: goalProbability,
      };

      const filtered = prev.filter((v) => v.date !== dateStr);
      const updated = [...filtered, newVal].sort((a, b) => a.date.localeCompare(b.date));

      if (isSimulation) {
        sessionStorage.setItem('simulation_valuations', JSON.stringify(updated));
      }

      return updated;
    });

    // Never write to DB in simulation or guest mode
    if (!isGuest) {
      await upsertPortfolioValuation(
        supabase, portfolioId, totalValue, cashValue, 0, cumulativeReturnPct, goalProbability
      );
    }

    // Refresh AI probability (non-blocking)
    const mergedPrices = { ...allPrices, ...prices };
    fetchAiProbability(currentProfile, currentPositions, mergedPrices, totalValue, cashValue);
  }, [supabase, isGuest, isSimulation, allPrices, allScores, asOfDate, fetchAiProbability]);

  // --- Handlers ---

  async function handleApprove(id: string) {
    if (!user || isGuest || !portfolio || !profile) return;

    const item = items.find((i) => i.id === id);
    if (!item) return;

    try {
    // Record the decision
    await submitUserDecision(supabase, id, 'approved', user.id);

    const currentPrice = allPrices[item.ticker];
    if (!currentPrice || currentPrice <= 0) {
      // Can't execute without a price — just record decision
      setItems((prev) => prev.filter((i) => i.id !== id));
      return;
    }

    let updatedPositions = [...positions];
    const existingIdx = updatedPositions.findIndex((p) => p.ticker === item.ticker);

    if (item.action === 'BUY' || item.action === 'ADD') {
      // Calculate how much to invest based on target allocation (less fees)
      const targetValue = (item.targetAllocationPct / 100) * totalValue;
      const existingValue = existingIdx >= 0
        ? updatedPositions[existingIdx]!.quantity * currentPrice
        : 0;
      const investAmount = Math.max(0, targetValue - existingValue) * feeMultiplier;
      const quantity = investAmount / currentPrice;

      if (quantity > 0) {
        if (existingIdx >= 0) {
          // ADD to existing position — update average price and quantity
          const existing = updatedPositions[existingIdx]!;
          const totalQty = existing.quantity + quantity;
          const totalCost = existing.quantity * existing.avgPurchasePrice + quantity * currentPrice;
          const newAvg = totalCost / totalQty;
          updatedPositions[existingIdx] = {
            ...existing,
            quantity: totalQty,
            avgPurchasePrice: newAvg,
          };

          // Update in DB (preserves ID)
          await updatePortfolioPosition(supabase, existing.id, totalQty, newAvg);
        } else {
          // New BUY position
          const newPos: PortfolioPositionWithScore = {
            id: crypto.randomUUID(),
            portfolioId: portfolio.id,
            ticker: item.ticker,
            quantity,
            avgPurchasePrice: currentPrice,
            openedAt: new Date().toISOString(),
          };
          updatedPositions.push(newPos);
          await addPortfolioPosition(supabase, portfolio.id, item.ticker, quantity, currentPrice);
        }

        // Load scores for the ticker
        try {
          const posScores = await getAgentScoresForTicker(supabase, item.ticker);
          setAgentScores((prev) => ({ ...prev, [item.ticker]: posScores }));
          if (posScores.length > 0) {
            setLatestScores((prev) => ({ ...prev, [item.ticker]: computeWeightedComposite(posScores, weightsConfig) }));
          }
        } catch { /* Non-blocking */ }
      }
    } else if (item.action === 'SELL') {
      // Remove the entire position
      if (existingIdx >= 0) {
        const existing = updatedPositions[existingIdx]!;
        await removePortfolioPosition(supabase, existing.id);
        updatedPositions = updatedPositions.filter((_, i) => i !== existingIdx);
      }
    } else if (item.action === 'REDUCE') {
      // Reduce position to target allocation
      if (existingIdx >= 0) {
        const existing = updatedPositions[existingIdx]!;
        const targetValue = (item.targetAllocationPct / 100) * totalValue;
        const newQuantity = Math.max(0, targetValue / currentPrice);

        if (newQuantity <= 0) {
          // Fully sell
          await removePortfolioPosition(supabase, existing.id);
          updatedPositions = updatedPositions.filter((_, i) => i !== existingIdx);
        } else {
          updatedPositions[existingIdx] = { ...existing, quantity: newQuantity };
          // Update in DB (preserves ID)
          await updatePortfolioPosition(supabase, existing.id, newQuantity, existing.avgPurchasePrice);
        }
      }
    }

    setPositions(updatedPositions);
    setItems((prev) => prev.filter((i) => i.id !== id));
    await recalculate(updatedPositions, profile, portfolio.id);
    } catch (err) {
      console.error('Approve error:', err);
    }
  }

  async function handleDismiss(id: string) {
    if (!user || isGuest) return;
    try {
      await submitUserDecision(supabase, id, 'dismissed', user.id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error('Dismiss error:', err);
    }
  }

  async function handleAddPosition(ticker: string, quantity: number, pricePerUnit: number) {
    if (!portfolio || !profile) return;

    // Apply fee: reduce quantity by 1% (fee taken from the invested amount)
    const effectiveQty = quantity * feeMultiplier;
    const cost = effectiveQty * pricePerUnit;

    const newPos: PortfolioPositionWithScore = {
      id: crypto.randomUUID(),
      portfolioId: portfolio.id,
      ticker,
      quantity: effectiveQty,
      avgPurchasePrice: pricePerUnit,
      openedAt: new Date().toISOString(),
    };
    const updatedPositions = [...positions, newPos];
    setPositions(updatedPositions);

    // Update cash balance for real users
    let newCash = cashBalance;
    if (!isGuest && cashBalance != null) {
      newCash = Math.max(0, cashBalance - cost);
      setCashBalanceState(newCash);
      setCashBalance(supabase, portfolio.id, newCash).catch(() => {});
    }

    if (isGuest) {
      sessionStorage.setItem('guest_positions', JSON.stringify(updatedPositions));
    } else {
      await addPortfolioPosition(supabase, portfolio.id, ticker, effectiveQty, pricePerUnit);
    }

    // Load scores for the new position
    if (allScores[ticker] !== undefined) {
      setLatestScores((prev) => ({ ...prev, [ticker]: allScores[ticker]! }));
    }
    try {
      const posScores = await getAgentScoresForTicker(supabase, ticker, undefined, asOfDate);
      setAgentScores((prev) => ({ ...prev, [ticker]: posScores }));
      if (posScores.length > 0) {
        setLatestScores((prev) => ({ ...prev, [ticker]: computeWeightedComposite(posScores, weightsConfig) }));
      }
    } catch { /* Non-blocking */ }

    await recalculate(updatedPositions, profile, portfolio.id, newCash);
  }

  async function handleRemovePosition(positionId: string) {
    if (!portfolio || !profile) return;
    const pos = positions.find((p) => p.id === positionId);
    const updatedPositions = positions.filter((p) => p.id !== positionId);
    setPositions(updatedPositions);

    // Update cash balance for real users — add back proceeds at current market price
    let newCash = cashBalance;
    if (!isGuest && cashBalance != null && pos) {
      const sellPrice = allPrices[pos.ticker] ?? pos.avgPurchasePrice;
      const proceeds = pos.quantity * sellPrice;
      newCash = cashBalance + proceeds;
      setCashBalanceState(newCash);
      setCashBalance(supabase, portfolio.id, newCash).catch(() => {});
    }

    if (isGuest) {
      sessionStorage.setItem('guest_positions', JSON.stringify(updatedPositions));
    } else {
      await removePortfolioPosition(supabase, positionId);
    }

    await recalculate(updatedPositions, profile, portfolio.id, newCash);
  }

  async function handleReducePosition(positionId: string, reduceQty: number, sellPrice: number) {
    if (!portfolio || !profile) return;
    const pos = positions.find((p) => p.id === positionId);
    if (!pos) return;

    const remaining = pos.quantity - reduceQty;

    if (remaining <= 0.000001) {
      // Sell all — remove position entirely
      await handleRemovePosition(positionId);
      return;
    }

    // Partial sell — update position with reduced quantity, keep avg price
    const updatedPositions = positions.map((p) =>
      p.id === positionId ? { ...p, quantity: remaining } : p,
    );
    setPositions(updatedPositions);

    // Update cash balance for real users — add proceeds
    let newCash = cashBalance;
    if (!isGuest && cashBalance != null) {
      const proceeds = reduceQty * sellPrice;
      newCash = cashBalance + proceeds;
      setCashBalanceState(newCash);
      setCashBalance(supabase, portfolio.id, newCash).catch(() => {});
    }

    if (isGuest) {
      sessionStorage.setItem('guest_positions', JSON.stringify(updatedPositions));
    } else {
      await updatePortfolioPosition(supabase, positionId, remaining, pos.avgPurchasePrice);
    }

    await recalculate(updatedPositions, profile, portfolio.id, newCash);
  }

  async function handleProfileUpdated(updated: UserProfile) {
    setProfile(updated);
    if (isGuest) {
      sessionStorage.setItem('guest_profile', JSON.stringify(updated));
    }
    if (portfolio) {
      await recalculate(positions, updated, portfolio.id);
    }
  }

  function handleSignOut() {
    if (isGuest) {
      sessionStorage.removeItem('guest_profile');
      sessionStorage.removeItem('guest_positions');
      sessionStorage.removeItem('simulation_valuations');
      exitGuestMode();
      router.push('/login');
    } else {
      supabase.auth.signOut().then(() => router.push('/login'));
    }
  }

  if (authLoading || loading) {
    return (
      <main className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" message="Loading your portfolio..." />
      </main>
    );
  }

  const displayName = user?.user_metadata?.display_name as string | undefined;
  const firstName = displayName?.split(' ')[0];

  const latest = valuations[valuations.length - 1];
  const previous = valuations.length > 1 ? valuations[valuations.length - 2] : undefined;
  const actionItems = items.filter((i) => i.action !== 'HOLD');
  const opportunities = items.filter(
    (i) => (i.action === 'BUY') && !positions.some((p) => p.ticker === i.ticker)
  );
  const recommendations = actionItems.filter(
    (i) => positions.some((p) => p.ticker === i.ticker)
  );

  // Compute invested value from actual positions (source of truth)
  let positionsMarketValue = 0;
  for (const p of positions) {
    const price = allPrices[p.ticker] ?? p.avgPurchasePrice;
    positionsMarketValue += p.quantity * price;
  }

  const investmentCapital = profile?.investmentCapital ?? 0;
  // Use tracked cash balance for real users; fall back to cost-basis formula for legacy/guest
  let costBasis = 0;
  for (const p of positions) {
    costBasis += p.quantity * p.avgPurchasePrice;
  }
  const cashValue = (cashBalance != null && !isGuest) ? cashBalance : Math.max(0, investmentCapital - costBasis);
  const investedValue = positionsMarketValue;
  const totalValue = investedValue + cashValue;

  // Compute a live probability if no valuation exists yet
  const renderCumReturn = investmentCapital > 0
    ? (totalValue - investmentCapital) / investmentCapital
    : 0;
  const renderScoreVals = positions
    .map((p) => allScores[p.ticker])
    .filter((s): s is number => s !== undefined);
  const renderAvgScore = renderScoreVals.length > 0
    ? renderScoreVals.reduce((a, b) => a + b, 0) / renderScoreVals.length
    : undefined;
  const liveGoalProbability = profile
    ? computeGoalProbability({
        cumulativeReturn: renderCumReturn,
        goalReturn: profile.goalReturnPct,
        monthsRemaining: profile.timeHorizonMonths,
        avgCompositeScore: renderAvgScore,
        positionCount: positions.length,
        maxPositions: profile.maxPositions,
        riskProfile: profile.riskProfile,
      })
    : 50;

  return (
    <>
      <SimulationBanner />
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Logo size="sm" variant="dark" />
            {firstName && !isGuest && (
              <span className="text-sm text-gray-300">{firstName}</span>
            )}
            {isGuest && !isSimulation && (
              <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                Guest Mode
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <DataFreshnessBar />
            <Link
              href="/market"
              className="text-gray-400 hover:text-white transition-colors flex items-center gap-1 text-sm"
            >
              <BarChart3 className="h-4 w-4" /> Market
            </Link>
            <button onClick={handleSignOut} className="text-gray-400 hover:text-white transition-colors flex items-center gap-1 text-sm">
              <LogOut className="h-4 w-4" />
              {isGuest ? 'Exit' : 'Sign Out'}
            </button>
            <Link
              href="/settings"
              className="text-gray-400 hover:text-white transition-colors"
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </div>

        {/* Portfolio Chart — Hero Section (full width) */}
        <div className="mb-6">
          <PortfolioOverview
            valuations={valuations}
            cashValue={cashValue}
            totalValue={totalValue}
            investedValue={investedValue}
          />
        </div>

        {/* 2-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Left Column */}
          <div className="lg:col-span-3 space-y-5">
            {/* Daily Briefing */}
            {run && !isGuest ? (
              <div className="space-y-2">
                <DailyBriefing
                  narrative={run.portfolioNarrative}
                  goalProbabilityPct={latest?.goalProbabilityPct ?? liveGoalProbability}
                  goalStatus={run.goalStatus}
                  overallConfidence={run.overallConfidence}
                  actionCount={actionItems.length}
                  runDate={run.runDate}
                />
                {portfolio && positions.length > 0 && (
                  <button
                    onClick={() => setShowRiskReport(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Risk Analysis
                  </button>
                )}
              </div>
            ) : (
              <Card className="border-accent-blue/30 bg-gradient-to-br from-navy-800 to-navy-900">
                <div className="space-y-3">
                  <h2 className="text-lg font-semibold text-white">
                    {firstName ? `${firstName}'s Portfolio` : 'Portfolio Summary'}
                  </h2>
                  {positions.length > 0 ? (
                    <>
                      <p className="text-sm text-gray-300 leading-relaxed">
                        {firstName ? `${firstName}, your` : 'Your'} portfolio has <span className="text-white font-medium">{positions.length} position{positions.length !== 1 ? 's' : ''}</span> with{' '}
                        <span className="text-white font-medium">{formatCurrency(investedValue)}</span> in market value
                        and <span className="text-white font-medium">{formatCurrency(cashValue)}</span> in cash.
                        {!isGuest && ' The AI analysis pipeline runs daily — your first briefing will appear after the next analysis cycle.'}
                      </p>
                      {profile && (
                        <div className="flex items-center justify-between flex-wrap gap-3">
                          <div className="flex items-center gap-6 text-sm flex-wrap">
                            <div>
                              <span className="text-gray-400">Goal: </span>
                              <span className="text-white font-medium">{(profile.goalReturnPct * 100).toFixed(0)}% return</span>
                            </div>
                            <div>
                              <span className="text-gray-400">Horizon: </span>
                              <span className="text-white font-medium">{profile.timeHorizonMonths}mo</span>
                            </div>
                            <div>
                              <span className="text-gray-400">Risk: </span>
                              <span className="text-white font-medium capitalize">{profile.riskProfile}</span>
                            </div>
                          </div>
                          {portfolio && (
                            <button
                              onClick={() => setShowRiskReport(true)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-colors shrink-0"
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                              Risk Analysis
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">
                      {isSimulation
                        ? 'Simulation mode active. Add positions and advance days to test the product.'
                        : isGuest
                        ? 'Welcome, Guest! Add positions to build your portfolio. Data is not saved.'
                        : firstName
                        ? `Welcome, ${firstName}! Add positions to start building your portfolio. The AI analysis will run daily.`
                        : 'Add positions to start building your portfolio. The AI analysis will run daily.'}
                    </p>
                  )}
                </div>
              </Card>
            )}

            {/* Recommendations (regular users only) */}
            {!isGuest && recommendations.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-gray-400 mb-3">Recommendations</h2>
                <div className="space-y-3">
                  {recommendations.map((item) => (
                    <RecommendationCard
                      key={item.id}
                      item={item}
                      onApprove={handleApprove}
                      onDismiss={handleDismiss}
                      onShowReasoning={(id) => setReasoningId(id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {!isGuest && opportunities.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-gray-400 mb-3">Opportunities</h2>
                <div className="space-y-3">
                  {opportunities.map((item) => (
                    <RecommendationCard
                      key={item.id}
                      item={item}
                      onApprove={handleApprove}
                      onDismiss={handleDismiss}
                      onShowReasoning={(id) => setReasoningId(id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Positions */}
            <div>
              {positions.length > 0 ? (
                <>
                  <PositionsTable
                    positions={positions}
                    totalValue={totalValue}
                    agentScores={agentScores}
                    latestScores={latestScores}
                    marketPrices={allPrices}
                    marketQuotes={allQuotes}
                    cashAvailable={cashValue}
                    onOpenDetail={(ticker, name) => setDetailTicker({ ticker, ...(name ? { name } : {}) })}
                    onAddToPosition={handleAddPosition}
                    onReducePosition={handleReducePosition}
                  />
                  <div className="flex gap-3 mt-3">
                    <Button
                      size="sm"
                      onClick={() => setShowAddPosition(true)}
                      disabled={cashValue <= 0}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Position
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowSellPosition(true)}
                    >
                      <Minus className="h-3.5 w-3.5 mr-1" /> Sell Position
                    </Button>
                  </div>
                </>
              ) : (
                <Card>
                  <div className="text-center py-8">
                    <p className="text-gray-400 mb-3">No positions yet. Start building your portfolio.</p>
                    <Button onClick={() => setShowAddPosition(true)}>
                      <Plus className="h-4 w-4 mr-1" /> Add Your First Position
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="lg:col-span-2 space-y-5">
            {/* Goal Tracker */}
            {profile && (
              <GoalTracker
                goalReturnPct={profile.goalReturnPct}
                timeHorizonMonths={profile.timeHorizonMonths}
                probabilityPct={latest?.goalProbabilityPct ?? liveGoalProbability}
                previousPct={previous?.goalProbabilityPct}
                goalStatus={run?.goalStatus ?? probabilityToGoalStatus(latest?.goalProbabilityPct ?? liveGoalProbability)}
                aiOpusPct={aiOpusPct}
                aiSonnetPct={aiSonnetPct}
                aiLoading={aiLoading}
              />
            )}

            {/* Donut Chart */}
            <PortfolioDonut
              positions={positions}
              cashValue={cashValue}
              totalValue={totalValue}
              marketPrices={allPrices}
            />

            {/* Settings */}
            {profile && (
              <SettingsPanel
                profile={profile}
                onProfileUpdated={handleProfileUpdated}
              />
            )}
          </div>
        </div>

        {/* Modals */}
        <AddPositionModal
          open={showAddPosition}
          onClose={() => setShowAddPosition(false)}
          onAdd={handleAddPosition}
          existingTickers={positions.map((p) => p.ticker)}
          cashAvailable={cashValue}
          latestScores={allScores}
          latestPrices={allPrices}
        />

        <SellPositionModal
          open={showSellPosition}
          onClose={() => setShowSellPosition(false)}
          positions={positions}
          marketPrices={allPrices}
          onSell={handleRemovePosition}
        />

        <TickerDetailModal
          open={!!detailTicker}
          onClose={() => setDetailTicker(null)}
          ticker={detailTicker?.ticker ?? null}
          tickerName={detailTicker?.name}
          preloadedPrice={detailTicker ? allPrices[detailTicker.ticker] : undefined}
          asOfDate={asOfDate}
        />

        {!isGuest && (
          <ReasoningModal
            open={!!reasoningId}
            onClose={() => setReasoningId(null)}
            recommendationId={reasoningId}
            synthesisRunId={run?.synthesisRunId}
          />
        )}

        {portfolio && (
          <RiskReportModal
            open={showRiskReport}
            onClose={() => setShowRiskReport(false)}
            portfolioId={portfolio.id}
            positions={positions.map((p) => {
              const price = allPrices[p.ticker] ?? p.avgPurchasePrice;
              const mv = p.quantity * price;
              return {
                ticker: p.ticker,
                quantity: p.quantity,
                avgPurchasePrice: p.avgPurchasePrice,
                marketValue: mv,
                allocationPct: totalValue > 0 ? (mv / totalValue) * 100 : 0,
              };
            })}
          />
        )}
      </main>
    </>
  );
}
