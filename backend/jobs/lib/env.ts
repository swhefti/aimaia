import { resolve } from 'path';
import { existsSync } from 'fs';
import { config } from 'dotenv';

/**
 * Load environment variables from .env.local (preferred) or .env
 * Call this at the top of every job entrypoint.
 */
export function loadEnv(): void {
  const root = resolve(import.meta.dirname, '..', '..', '..');
  const envLocal = resolve(root, '.env.local');
  const envFile = resolve(root, '.env');

  if (existsSync(envLocal)) {
    config({ path: envLocal });
  } else if (existsSync(envFile)) {
    config({ path: envFile });
  }
  // In GitHub Actions, env vars come from secrets — no file needed
}
