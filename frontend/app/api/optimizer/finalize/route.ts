import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeGoalProbabilityHeuristic } from '@shared/lib/optimizer-core';

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * POST /api/optimizer/finalize
 * Creates the real portfolio after user approves the optimizer draft.
 *
 * Safety: old positions are NOT deleted until new positions are fully persisted.
 * If any write fails, existing portfolio state is preserved intact.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userId,
      capital,
      positions,
      cashWeightPct,
      riskSummary,
      profile,
    } = body as {
      userId: string;
      capital: number;
      positions: { ticker: string; weightPct: number; price: number }[];
      cashWeightPct: number;
      riskSummary?: {
        expectedReturn: number;
        portfolioVolatility: number;
        concentrationRisk: number;
        diversificationScore: number;
      };
      profile: {
        investmentCapital: number;
        timeHorizonMonths: number;
        riskProfile: string;
        goalReturnPct: number;
        maxDrawdownLimitPct: number;
        volatilityTolerance: string;
        assetTypes: string[];
        maxPositions: number;
      };
    };

    if (!userId || !capital || !positions || !profile) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    // 1. Upsert user profile
    const drawdownForDb = profile.maxDrawdownLimitPct <= 1
      ? profile.maxDrawdownLimitPct * 100
      : profile.maxDrawdownLimitPct;

    const { error: profileError } = await supabase.from('user_profiles').upsert(
      {
        user_id: userId,
        investment_capital: profile.investmentCapital,
        time_horizon_months: profile.timeHorizonMonths,
        risk_profile: profile.riskProfile,
        goal_return_pct: profile.goalReturnPct,
        max_drawdown_limit_pct: drawdownForDb,
        volatility_tolerance: profile.volatilityTolerance,
        asset_types: profile.assetTypes,
        max_positions: profile.maxPositions,
        rebalancing_preference: 'daily',
      },
      { onConflict: 'user_id' },
    );
    if (profileError) {
      console.error('Profile upsert error:', profileError);
      return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
    }

    // 2. Resolve or create portfolio
    let portfolioId: string;
    let hasExistingPositions = false;

    const { data: existing } = await supabase
      .from('portfolios')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      portfolioId = existing.id as string;
      hasExistingPositions = true;
    } else {
      const { data: newPortfolio, error: createError } = await supabase
        .from('portfolios')
        .insert({
          user_id: userId,
          name: 'My Portfolio',
          status: 'active',
          strategy_mode: 'pro',
          strategy_version: '1.0',
        })
        .select('id')
        .single();

      if (createError?.code === '23505') {
        const { data: fallback } = await supabase
          .from('portfolios')
          .select('id')
          .eq('user_id', userId)
          .eq('status', 'active')
          .limit(1)
          .single();
        if (!fallback) return NextResponse.json({ error: 'Failed to create portfolio' }, { status: 500 });
        portfolioId = fallback.id as string;
        hasExistingPositions = true;
      } else if (createError || !newPortfolio) {
        console.error('Portfolio create error:', createError);
        return NextResponse.json({ error: 'Failed to create portfolio' }, { status: 500 });
      } else {
        portfolioId = newPortfolio.id as string;
      }
    }

    // 3. Build new position rows (DO NOT delete old positions yet)
    let investedValue = 0;
    const positionRows = positions
      .filter((p) => p.weightPct > 0.5 && p.price > 0)
      .map((p) => {
        const amount = capital * (p.weightPct / 100);
        const quantity = amount / p.price;
        investedValue += amount;
        return {
          portfolio_id: portfolioId,
          ticker: p.ticker,
          quantity,
          avg_purchase_price: p.price,
        };
      });

    // 4. Insert new positions FIRST (old positions still exist — safe)
    if (positionRows.length > 0) {
      const { error: posError } = await supabase.from('portfolio_positions').insert(positionRows);
      if (posError) {
        // Insert failed — old positions are untouched, portfolio is safe
        console.error('Position insert error:', posError);
        return NextResponse.json({ error: 'Failed to insert positions' }, { status: 500 });
      }
    }

    // 5. Now that new positions are persisted, safely delete old ones
    if (hasExistingPositions) {
      // Get IDs of newly inserted positions so we can exclude them from deletion
      const { data: allPositions } = await supabase
        .from('portfolio_positions')
        .select('id, ticker, opened_at')
        .eq('portfolio_id', portfolioId)
        .order('opened_at', { ascending: false });

      if (allPositions && allPositions.length > positionRows.length) {
        // Keep the newest N positions (just inserted), delete the rest
        const newTickers = new Set(positionRows.map((p) => p.ticker));
        // The newly inserted rows are the most recent; identify old rows to delete
        const seen = new Map<string, number>(); // ticker -> count of new rows seen
        const idsToDelete: string[] = [];
        for (const pos of allPositions) {
          const t = pos.ticker as string;
          const seenCount = seen.get(t) ?? 0;
          const expectedNew = positionRows.filter((p) => p.ticker === t).length;
          if (newTickers.has(t) && seenCount < expectedNew) {
            // This is one of the new rows — keep it
            seen.set(t, seenCount + 1);
          } else {
            // Old row — mark for deletion
            idsToDelete.push(pos.id as string);
          }
        }
        if (idsToDelete.length > 0) {
          await supabase.from('portfolio_positions').delete().in('id', idsToDelete);
        }
      }
    }

    // 6. Set cash balance
    const cashValue = Math.max(0, capital - investedValue);
    const { error: cashError } = await supabase
      .from('portfolios')
      .update({ cash_balance: cashValue })
      .eq('id', portfolioId);
    if (cashError) console.error('Cash balance error:', cashError);

    // 7. Compute initial goal probability (v1 heuristic)
    const goalProbPct = computeGoalProbabilityHeuristic({
      expectedReturn: riskSummary?.expectedReturn ?? 0,
      goalReturnPct: profile.goalReturnPct,
      timeHorizonMonths: profile.timeHorizonMonths,
      positionCount: positionRows.length,
      maxPositions: profile.maxPositions,
      portfolioVolatility: riskSummary?.portfolioVolatility ?? 0.25,
      concentrationRisk: riskSummary?.concentrationRisk ?? 0.5,
    });

    // 8. Insert initial valuation
    const date = new Date().toISOString().split('T')[0]!;
    await supabase.from('portfolio_valuations').upsert(
      {
        portfolio_id: portfolioId,
        date,
        total_value: capital,
        cash_value: cashValue,
        daily_pnl: 0,
        cumulative_return_pct: 0,
        goal_probability_pct: goalProbPct,
      },
      { onConflict: 'portfolio_id,date' },
    ).then(({ error }) => {
      if (error) {
        supabase.from('portfolio_valuations').insert({
          portfolio_id: portfolioId,
          date,
          total_value: capital,
          cash_value: cashValue,
          daily_pnl: 0,
          cumulative_return_pct: 0,
          goal_probability_pct: goalProbPct,
        }).then(({ error: insertErr }) => {
          if (insertErr) console.error('Valuation insert error:', insertErr);
        });
      }
    });

    // 9. Mark onboarding complete
    await supabase.from('user_profiles')
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq('user_id', userId);

    return NextResponse.json({
      portfolioId,
      positionCount: positionRows.length,
      cashValue,
      investedValue,
    });
  } catch (err) {
    console.error('POST /api/optimizer/finalize error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
