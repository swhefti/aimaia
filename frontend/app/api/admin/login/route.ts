import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAdminToken, isValidAdminEmail } from '@/app/admin/auth';

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    if (!isValidAdminEmail(email)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Verify credentials via Supabase Auth
    const supabase = getServiceSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Create signed admin session token
    const token = createAdminToken(email);

    const response = NextResponse.json({ success: true });
    response.cookies.set('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60, // 8 hours
    });

    return response;
  } catch (err) {
    console.error('[Admin/Login] Error:', err);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
