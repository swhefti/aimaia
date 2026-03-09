import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';

/**
 * POST /api/account/delete
 * Deletes all user data and the auth user. Requires an authenticated session.
 */

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(req: NextRequest) {
  // Verify the user is authenticated via their session cookie
  const res = NextResponse.next();
  const userSupabase = createMiddlewareClient({ req, res });
  const { data: { session } } = await userSupabase.auth.getSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const admin = getServiceSupabase();

  try {
    // 1. Get all portfolio IDs for the user
    const { data: portfolios } = await admin
      .from('portfolios')
      .select('id')
      .eq('user_id', userId);

    const portfolioIds = (portfolios ?? []).map((p) => p.id as string);

    if (portfolioIds.length > 0) {
      // 2. Delete portfolio positions
      await admin
        .from('portfolio_positions')
        .delete()
        .in('portfolio_id', portfolioIds);

      // 3. Delete portfolio valuations
      await admin
        .from('portfolio_valuations')
        .delete()
        .in('portfolio_id', portfolioIds);

      // 4. Delete portfolio risk metrics
      await admin
        .from('portfolio_risk_metrics')
        .delete()
        .in('portfolio_id', portfolioIds);

      // 5. Delete recommendation items (via recommendation_runs)
      const { data: runs } = await admin
        .from('recommendation_runs')
        .select('id, synthesis_run_id')
        .in('portfolio_id', portfolioIds);

      const runIds = (runs ?? []).map((r) => r.id as string);
      if (runIds.length > 0) {
        // Delete user decisions referencing these recommendations
        const { data: recItems } = await admin
          .from('recommendation_items')
          .select('id')
          .in('run_id', runIds);

        const recItemIds = (recItems ?? []).map((r) => r.id as string);
        if (recItemIds.length > 0) {
          await admin
            .from('user_decisions')
            .delete()
            .in('recommendation_id', recItemIds);
        }

        await admin
          .from('recommendation_items')
          .delete()
          .in('run_id', runIds);

        // Delete synthesis raw outputs linked to synthesis runs
        const synthRunIds = (runs ?? [])
          .map((r) => r.synthesis_run_id as string)
          .filter(Boolean);
        if (synthRunIds.length > 0) {
          await admin
            .from('synthesis_raw_outputs')
            .delete()
            .in('synthesis_run_id', synthRunIds);
        }

        await admin
          .from('recommendation_runs')
          .delete()
          .in('portfolio_id', portfolioIds);
      }

      // 6. Delete synthesis runs and inputs
      await admin
        .from('synthesis_runs')
        .delete()
        .in('portfolio_id', portfolioIds);

      await admin
        .from('synthesis_inputs')
        .delete()
        .in('portfolio_id', portfolioIds);

      // 7. Delete portfolios
      await admin
        .from('portfolios')
        .delete()
        .eq('user_id', userId);
    }

    // 8. Delete user decisions (any remaining)
    await admin
      .from('user_decisions')
      .delete()
      .eq('user_id', userId);

    // 9. Delete user profile
    await admin
      .from('user_profiles')
      .delete()
      .eq('user_id', userId);

    // 10. Delete the auth user
    const { error: authError } = await admin.auth.admin.deleteUser(userId);
    if (authError) {
      console.error('[DeleteAccount] Auth delete error:', authError.message);
      return NextResponse.json({ error: 'Failed to delete auth user' }, { status: 500 });
    }

    console.log(`[DeleteAccount] Successfully deleted user ${userId}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DeleteAccount] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
