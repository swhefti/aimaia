'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { signIn, getAuthErrorMessage } from '@/lib/auth'
import { useAuth } from '@/components/auth-provider'
import { useSimulation } from '@/components/simulation-provider'
import { Logo } from '@/components/ui/logo'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  )
}

function LoginPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectTo') ?? '/dashboard'
  const { enterGuestMode, enterSimulationMode } = useAuth()
  const { enterSimulation } = useSimulation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin() {
    if (!email || !password) {
      setError('Please enter your email and password.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Clear any stale guest/simulation flags
      sessionStorage.removeItem('guest_mode')
      sessionStorage.removeItem('simulation_mode')
      sessionStorage.removeItem('simulation_date')
      sessionStorage.removeItem('simulation_valuations')
      window.dispatchEvent(new Event('simulation-exit'))
      await signIn(email, password)
      router.push(redirectTo)
      router.refresh()
    } catch (err) {
      setError(getAuthErrorMessage(err as Error))
    } finally {
      setLoading(false)
    }
  }

  function handleGuestEntry() {
    enterGuestMode()
    router.push('/onboarding')
  }

  function handleSimulationEntry() {
    // Enter simulation mode (sets auth + simulation flags)
    enterSimulationMode()
    enterSimulation()

    // Pre-configure a test profile so we skip onboarding
    const simProfile = {
      userId: 'guest-local',
      investmentCapital: 50000,
      timeHorizonMonths: 12,
      riskProfile: 'balanced',
      goalReturnPct: 0.08,
      maxDrawdownLimitPct: 0.15,
      volatilityTolerance: 'balanced',
      assetTypes: ['stock', 'etf', 'crypto'],
      maxPositions: 10,
      rebalancingPreference: 'daily' as const,
      onboardingCompletedAt: new Date().toISOString(),
    }
    sessionStorage.setItem('guest_profile', JSON.stringify(simProfile))

    // Pre-configure some positions
    const simPositions = [
      { id: 'sim-1', portfolioId: 'guest-portfolio', ticker: 'AAPL', quantity: 20, avgPurchasePrice: 185, openedAt: new Date().toISOString() },
      { id: 'sim-2', portfolioId: 'guest-portfolio', ticker: 'MSFT', quantity: 15, avgPurchasePrice: 380, openedAt: new Date().toISOString() },
      { id: 'sim-3', portfolioId: 'guest-portfolio', ticker: 'NVDA', quantity: 8, avgPurchasePrice: 720, openedAt: new Date().toISOString() },
      { id: 'sim-4', portfolioId: 'guest-portfolio', ticker: 'VOO', quantity: 20, avgPurchasePrice: 450, openedAt: new Date().toISOString() },
      { id: 'sim-5', portfolioId: 'guest-portfolio', ticker: 'BTC-USD', quantity: 0.15, avgPurchasePrice: 62000, openedAt: new Date().toISOString() },
    ]
    sessionStorage.setItem('guest_positions', JSON.stringify(simPositions))

    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4 relative">
      <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, #f0f0f0 1px, transparent 1px),
            linear-gradient(to bottom, #f0f0f0 1px, transparent 1px)
          `,
          backgroundSize: '38px 15px',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)',
        }}
      />
      <div className="w-full max-w-sm relative z-10">

        <div className="text-center mb-8">
          <Logo size="lg" variant="light" showSubtitle />
          <p className="text-slate-500 text-sm mt-3">Sign in to your account</p>
          <span className="text-xs text-slate-400 mt-1 inline-block">Version 0.61</span>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-slate-900 text-sm
                         placeholder:text-slate-400
                         focus:outline-none focus:ring-2 focus:ring-[#D67C63] focus:border-transparent"
              autoComplete="email"
            />
          </div>

          <div className="mb-6">
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <Link href="/auth/forgot-password"
                className="text-xs text-[#D67C63] hover:underline">
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-slate-900 text-sm
                         placeholder:text-slate-400
                         focus:outline-none focus:ring-2 focus:ring-[#D67C63] focus:border-transparent"
              autoComplete="current-password"
            />
          </div>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-[#1E3A5F] text-white rounded-lg py-2.5 text-sm font-medium
                       hover:bg-[#D67C63] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-slate-400">or</span>
            </div>
          </div>

          <button
            onClick={handleGuestEntry}
            className="w-full bg-slate-100 text-slate-700 rounded-lg py-2.5 text-sm font-medium
                       hover:bg-slate-200 transition-colors border border-slate-200"
          >
            Enter as Guest
          </button>

          <button
            onClick={handleSimulationEntry}
            className="w-full mt-2.5 bg-slate-50 text-slate-500 rounded-lg py-2.5 text-sm font-medium
                       hover:bg-slate-100 transition-colors border border-dashed border-slate-300"
          >
            Enter Simulation Test-Mode <span className="text-xs text-slate-400">(30 days back)</span>
          </button>

          <p className="text-center text-sm text-slate-500 mt-5">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-[#D67C63] hover:underline font-medium">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
