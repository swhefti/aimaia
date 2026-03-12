'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  getUserProfile,
  getPortfolio,
  archivePortfolio,
} from '@/lib/queries';
import { formatCurrency, formatPct } from '@/lib/formatters';
import type { UserProfile, Portfolio } from '@shared/types/portfolio';
import { useAgentLabels } from '@/components/agent-label-provider';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export default function SettingsPage() {
  const { user, supabase, loading: authLoading, isGuest, exitGuestMode } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const { showLabels, toggleLabels } = useAgentLabels();
  const [includeFees, setIncludeFees] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load fees preference from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('maipa_include_fees');
    if (stored === 'true') setIncludeFees(true);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (isGuest) {
      const stored = sessionStorage.getItem('guest_profile');
      if (stored) setProfile(JSON.parse(stored) as UserProfile);
      setPortfolio({ id: 'guest-portfolio', userId: 'guest-local', name: 'Guest Portfolio', createdAt: '', status: 'active' });
      setLoading(false);
      return;
    }
    Promise.all([
      getUserProfile(supabase, user.id),
      getPortfolio(supabase, user.id),
    ]).then(([p, port]) => {
      setProfile(p);
      setPortfolio(port);
    }).finally(() => setLoading(false));
  }, [user, supabase, authLoading, router, isGuest]);

  function handleToggleFees(checked: boolean) {
    setIncludeFees(checked);
    localStorage.setItem('maipa_include_fees', checked ? 'true' : 'false');
  }

  async function handleReset() {
    if (!user) return;
    setResetting(true);

    try {
      if (isGuest) {
        sessionStorage.removeItem('guest_profile');
        sessionStorage.removeItem('guest_positions');
      } else {
        // Archive the portfolio (old records stay in DB)
        // Profile is NOT deleted — onboarding upsert will overwrite it
        if (portfolio) {
          await archivePortfolio(supabase, portfolio.id);
        }
      }

      router.push('/onboarding');
    } catch (err) {
      console.error('Reset error:', err);
      setResetting(false);
    }
  }

  async function handleDeleteAccount() {
    if (!user || isGuest) return;
    setDeleting(true);

    try {
      const resp = await fetch('/api/account/delete', { method: 'POST' });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || 'Delete failed');
      }

      await supabase.auth.signOut();
      router.push('/login');
    } catch (err) {
      console.error('Delete account error:', err);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  if (authLoading || loading) {
    return (
      <main className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" message="Loading settings..." />
      </main>
    );
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
          backgroundSize: '20px 30px',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)',
        }}
      />
    <main className="max-w-lg mx-auto px-4 py-6 relative z-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/dashboard"
          className="text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold text-white">Settings</h1>
      </div>

      <div className="space-y-6">
        {/* Profile Summary */}
        {profile && (
          <Card>
            <h3 className="text-sm font-medium text-gray-400 mb-3">Investment Profile</h3>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
              <div>
                <span className="text-gray-500">Capital</span>
                <p className="text-white font-medium">{formatCurrency(profile.investmentCapital)}</p>
              </div>
              <div>
                <span className="text-gray-500">Horizon</span>
                <p className="text-white font-medium">{profile.timeHorizonMonths}mo</p>
              </div>
              <div>
                <span className="text-gray-500">Goal</span>
                <p className="text-white font-medium">{formatPct(profile.goalReturnPct)}</p>
              </div>
              <div>
                <span className="text-gray-500">Risk</span>
                <p className="text-white font-medium capitalize">{profile.riskProfile}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Transaction Fees */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-white">Include Transaction Fees</h3>
              <p className="text-xs text-gray-500 mt-1">
                When enabled, a 1% fee is deducted from every buy transaction.
              </p>
            </div>
            <button
              onClick={() => handleToggleFees(!includeFees)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                includeFees ? 'bg-accent-blue' : 'bg-navy-600'
              }`}
              role="switch"
              aria-checked={includeFees}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  includeFees ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </Card>

        {/* Label Agent Work */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-white">Label Agent Work</h3>
              <p className="text-xs text-gray-500 mt-1">
                Show a small badge on every piece of data produced by an AI agent, indicating which agent generated it.
              </p>
            </div>
            <button
              onClick={toggleLabels}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                showLabels ? 'bg-accent-blue' : 'bg-navy-600'
              }`}
              role="switch"
              aria-checked={showLabels}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  showLabels ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </Card>

        {/* Reset Portfolio */}
        <Card>
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-white">Reset Portfolio</h3>
              <p className="text-xs text-gray-500 mt-1">
                This will archive your current portfolio and restart the onboarding process from scratch.
                Your old data will remain in the database but won&apos;t be visible. This is the same as signing up fresh.
              </p>
            </div>
            {!showResetConfirm ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowResetConfirm(true)}
              >
                Reset Portfolio
              </Button>
            ) : (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-red-300 font-medium">Are you sure?</p>
                    <p className="text-xs text-red-400/80 mt-1">
                      Your portfolio, positions, and investment profile will be reset.
                      The onboarding wizard will start from the beginning.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleReset}
                    disabled={resetting}
                  >
                    {resetting ? 'Resetting...' : 'Yes, reset everything'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowResetConfirm(false)}
                    disabled={resetting}
                  >
                    No, keep my portfolio
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Delete Account */}
        {!isGuest && (
          <Card>
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-medium text-white">Delete Account</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Permanently delete your account and all associated data. This action cannot be undone.
                </p>
              </div>
              {!showDeleteConfirm ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete Account
                </Button>
              ) : (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-red-300 font-medium">This is permanent</p>
                      <p className="text-xs text-red-400/80 mt-1">
                        Your account, portfolio, positions, and all associated data will be permanently deleted.
                        You will not be able to recover any of this data.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={handleDeleteAccount}
                      disabled={deleting}
                    >
                      {deleting ? 'Deleting...' : 'Yes, delete my account'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deleting}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </main>
    </div>
  );
}
