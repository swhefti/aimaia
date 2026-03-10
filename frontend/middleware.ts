import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const { pathname } = req.nextUrl

  // All /admin routes bypass Supabase auth entirely.
  // /admin/dashboard and /api/admin/config require an admin_session cookie.
  // /admin (login page) and /api/admin/login are fully public.
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (pathname.startsWith('/admin/dashboard') || pathname === '/api/admin/config') {
      const adminSession = req.cookies.get('admin_session')?.value
      if (!adminSession) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        return NextResponse.redirect(new URL('/admin', req.url))
      }
    }
    return res
  }

  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()

  const publicRoutes = ['/', '/login', '/signup', '/auth/callback', '/auth/reset-password']
  const isPublic = publicRoutes.some(route => pathname === route || pathname.startsWith('/auth/'))
    || pathname.startsWith('/api/')

  // Allow guest mode through
  const isGuest = req.cookies.get('guest_mode')?.value === '1'

  if (!session && !isPublic && !isGuest) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (session && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
