'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signUp, getAuthErrorMessage } from '@/lib/auth'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSignup() {
    if (!email || !password) {
      setError('Email and password are required.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { session } = await signUp(email, password, displayName || undefined)

      if (session) {
        router.push('/onboarding')
        router.refresh()
      } else {
        setSuccess(true)
      }
    } catch (err) {
      setError(getAuthErrorMessage(err as Error))
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            <div className="text-4xl mb-4">✉️</div>
            <h2 className="text-lg font-semibold text-[#1E3A5F] mb-2">Check your email</h2>
            <p className="text-slate-500 text-sm">
              We sent a confirmation link to <strong>{email}</strong>.
              Click it to activate your account and start building your portfolio.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#1E3A5F]">Portfolio Advisor</h1>
          <p className="text-slate-500 text-sm mt-1">Create your account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-5">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Name <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-[#2E6BE6] focus:border-transparent"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-[#2E6BE6] focus:border-transparent"
              autoComplete="email"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSignup()}
              placeholder="Min. 8 characters"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-[#2E6BE6] focus:border-transparent"
              autoComplete="new-password"
            />
          </div>

          <button
            onClick={handleSignup}
            disabled={loading}
            className="w-full bg-[#1E3A5F] text-white rounded-lg py-2.5 text-sm font-medium
                       hover:bg-[#2E6BE6] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>

          <p className="text-center text-sm text-slate-500 mt-5">
            Already have an account?{' '}
            <Link href="/login" className="text-[#2E6BE6] hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
