// ============================================================
// frontend/lib/auth.ts
// Client-side authentication helpers
// Uses Supabase Auth via @supabase/auth-helpers-nextjs
// ============================================================

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

// ─── Browser client (use in Client Components) ──────────────
export function createBrowserClient() {
  return createClientComponentClient()
}

// ─── Sign Up ────────────────────────────────────────────────
export async function signUp(
  email: string,
  password: string,
  displayName?: string
) {
  const supabase = createBrowserClient()

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName ?? '',
      },
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  })

  if (error) throw error
  return data
}

// ─── Sign In ────────────────────────────────────────────────
export async function signIn(email: string, password: string) {
  const supabase = createBrowserClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) throw error
  return data
}

// ─── Sign Out ───────────────────────────────────────────────
export async function signOut() {
  const supabase = createBrowserClient()
  const { error } = await supabase.auth.signOut()
  if (error) throw error
  window.location.href = '/login'
}

// ─── Reset Password ─────────────────────────────────────────
export async function resetPassword(email: string) {
  const supabase = createBrowserClient()

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  })

  if (error) throw error
}

// ─── Update Password (after reset link) ─────────────────────
export async function updatePassword(newPassword: string) {
  const supabase = createBrowserClient()
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

// ─── Auth Error Messages ─────────────────────────────────────
export function getAuthErrorMessage(error: Error): string {
  const message = error.message.toLowerCase()

  if (message.includes('invalid login credentials'))
    return 'Email or password is incorrect.'
  if (message.includes('email not confirmed'))
    return 'Please check your email and confirm your account first.'
  if (message.includes('user already registered'))
    return 'An account with this email already exists. Try logging in.'
  if (message.includes('password should be at least'))
    return 'Password must be at least 8 characters.'
  if (message.includes('rate limit'))
    return 'Too many attempts. Please wait a moment and try again.'

  return 'Something went wrong. Please try again.'
}
