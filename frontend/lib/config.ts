import { createClient } from '@supabase/supabase-js';

/**
 * Runtime configuration loader — reads from system_config table.
 * Uses a 5-minute TTL cache so admin changes propagate within minutes.
 */

const cache = new Map<string, { value: string; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isFresh(key: string): boolean {
  const entry = cache.get(key);
  return !!entry && (Date.now() - entry.ts) < CACHE_TTL_MS;
}

function getCached(key: string): string | undefined {
  if (!isFresh(key)) return undefined;
  return cache.get(key)!.value;
}

function setCached(key: string, value: string): void {
  cache.set(key, { value, ts: Date.now() });
}

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function getConfig(key: string, fallback: string): Promise<string> {
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('system_config')
      .select('value')
      .eq('key', key)
      .single();

    if (error || !data) {
      setCached(key, fallback);
      return fallback;
    }

    setCached(key, data.value as string);
    return data.value as string;
  } catch {
    setCached(key, fallback);
    return fallback;
  }
}

export async function getConfigNumber(key: string, fallback: number): Promise<number> {
  const val = await getConfig(key, String(fallback));
  const parsed = Number(val);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export async function getConfigBatch(
  defaults: Record<string, string>
): Promise<Record<string, string>> {
  const keys = Object.keys(defaults);
  const uncached = keys.filter((k) => !isFresh(k));

  if (uncached.length > 0) {
    try {
      const supabase = getServiceSupabase();
      const { data } = await supabase
        .from('system_config')
        .select('key, value')
        .in('key', uncached);

      for (const row of data ?? []) {
        setCached(row.key as string, row.value as string);
      }
    } catch {
      // Use defaults for any uncached keys
    }

    for (const k of uncached) {
      if (!isFresh(k)) setCached(k, defaults[k]!);
    }
  }

  const result: Record<string, string> = {};
  for (const k of keys) {
    result[k] = getCached(k) ?? defaults[k]!;
  }
  return result;
}

export async function getConfigNumberBatch(
  defaults: Record<string, number>
): Promise<Record<string, number>> {
  const stringDefaults: Record<string, string> = {};
  for (const [k, v] of Object.entries(defaults)) {
    stringDefaults[k] = String(v);
  }
  const raw = await getConfigBatch(stringDefaults);
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const parsed = Number(v);
    result[k] = Number.isNaN(parsed) ? defaults[k]! : parsed;
  }
  return result;
}
