import { createClient } from '@supabase/supabase-js';

/**
 * Runtime configuration loader for batch jobs.
 * Reads from system_config table. Caches in memory for the process lifetime.
 * Standalone version — no Next.js dependencies.
 */

const cache = new Map<string, string>();

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function getConfig(key: string, fallback: string): Promise<string> {
  if (cache.has(key)) return cache.get(key)!;
  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from('system_config').select('value').eq('key', key).single();
    if (error || !data) { cache.set(key, fallback); return fallback; }
    cache.set(key, data.value as string);
    return data.value as string;
  } catch {
    cache.set(key, fallback);
    return fallback;
  }
}

export async function getConfigNumber(key: string, fallback: number): Promise<number> {
  const val = await getConfig(key, String(fallback));
  const parsed = Number(val);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export async function getConfigBatch(defaults: Record<string, string>): Promise<Record<string, string>> {
  const keys = Object.keys(defaults);
  const uncached = keys.filter((k) => !cache.has(k));
  if (uncached.length > 0) {
    try {
      const supabase = getServiceSupabase();
      const { data } = await supabase.from('system_config').select('key, value').in('key', uncached);
      for (const row of data ?? []) cache.set(row.key as string, row.value as string);
    } catch { /* use defaults */ }
    for (const k of uncached) { if (!cache.has(k)) cache.set(k, defaults[k]!); }
  }
  const result: Record<string, string> = {};
  for (const k of keys) result[k] = cache.get(k) ?? defaults[k]!;
  return result;
}

export async function getConfigNumberBatch(defaults: Record<string, number>): Promise<Record<string, number>> {
  const stringDefaults: Record<string, string> = {};
  for (const [k, v] of Object.entries(defaults)) stringDefaults[k] = String(v);
  const raw = await getConfigBatch(stringDefaults);
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const parsed = Number(v);
    result[k] = Number.isNaN(parsed) ? defaults[k]! : parsed;
  }
  return result;
}
