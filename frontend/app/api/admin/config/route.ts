import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminSession } from '@/app/admin/auth';
import { getManifestEntry } from '@shared/lib/admin-config-manifest';

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET() {
  const session = verifyAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.from('system_config').select('*').order('group_name').order('key');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}

export async function POST(req: NextRequest) {
  const session = verifyAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await req.json()) as { updates: { key: string; value: string }[] };
    const { updates } = body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    // Validate each update against the manifest
    const validationErrors: string[] = [];
    const validatedUpdates: { key: string; value: string }[] = [];

    for (const item of updates) {
      const manifest = getManifestEntry(item.key);

      // Allow unknown keys (may be newly seeded) but skip validation
      if (!manifest) {
        validatedUpdates.push(item);
        continue;
      }

      // Numeric validation
      if (manifest.type === 'number') {
        const num = Number(item.value);
        if (Number.isNaN(num)) {
          validationErrors.push(`${item.key}: value "${item.value}" is not a valid number`);
          continue;
        }
        if (manifest.min !== undefined && num < manifest.min) {
          validationErrors.push(`${item.key}: value ${num} is below minimum ${manifest.min}`);
          continue;
        }
        if (manifest.max !== undefined && num > manifest.max) {
          validationErrors.push(`${item.key}: value ${num} exceeds maximum ${manifest.max}`);
          continue;
        }
      }

      // String type: must not be empty for model keys
      if (manifest.type === 'string' && item.value.trim() === '') {
        validationErrors.push(`${item.key}: value cannot be empty`);
        continue;
      }

      validatedUpdates.push(item);
    }

    if (validationErrors.length > 0) {
      return NextResponse.json({ error: 'Validation failed', details: validationErrors }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    const dbErrors: string[] = [];

    for (const item of validatedUpdates) {
      const { error } = await supabase
        .from('system_config')
        .update({ value: item.value, updated_at: new Date().toISOString() })
        .eq('key', item.key);
      if (error) dbErrors.push(`${item.key}: ${error.message}`);
    }

    if (dbErrors.length > 0) {
      return NextResponse.json({ error: 'Some updates failed', details: dbErrors }, { status: 500 });
    }

    return NextResponse.json({ success: true, updated: validatedUpdates.length });
  } catch (err) {
    console.error('[Admin/Config] Error:', err);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}
