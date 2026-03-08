/**
 * Migration Runner
 * Reads all SQL files from /db/migrations/ in numeric order and executes them
 * against Supabase using the service role key.
 *
 * Usage:
 *   npx ts-node --esm db/run_migrations.ts
 *   node --loader ts-node/esm db/run_migrations.ts
 *
 * Idempotent: all migrations use CREATE ... IF NOT EXISTS, so re-running is safe.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'db', 'migrations');

interface MigrationResult {
  file: string;
  status: 'success' | 'error';
  error?: string;
  durationMs: number;
}

async function runMigration(filePath: string): Promise<MigrationResult> {
  const file = path.basename(filePath);
  const sql = fs.readFileSync(filePath, 'utf-8');
  const start = Date.now();

  try {
    const { error } = await supabase.rpc('exec_sql', { sql_text: sql });

    if (error) {
      // Fallback: try via the REST SQL endpoint for Supabase projects
      // that don't have the exec_sql function defined yet.
      throw new Error(error.message);
    }

    return { file, status: 'success', durationMs: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { file, status: 'error', error: message, durationMs: Date.now() - start };
  }
}

async function getMigrationFiles(): Promise<string[]> {
  const entries = fs.readdirSync(MIGRATIONS_DIR);
  return entries
    .filter((f) => f.endsWith('.sql'))
    .sort() // lexicographic sort — relies on zero-padded numeric prefix (001_, 002_, …)
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

async function main(): Promise<void> {
  console.log('Portfolio Advisor — Migration Runner');
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Migrations dir: ${MIGRATIONS_DIR}\n`);

  const files = await getMigrationFiles();

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  console.log(`Found ${files.length} migration file(s):\n`);
  files.forEach((f) => console.log(`  ${path.basename(f)}`));
  console.log();

  const results: MigrationResult[] = [];
  let hasErrors = false;

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    process.stdout.write(`Running ${fileName} ... `);
    const result = await runMigration(filePath);
    results.push(result);

    if (result.status === 'success') {
      console.log(`OK (${result.durationMs}ms)`);
    } else {
      console.log(`FAILED (${result.durationMs}ms)`);
      console.error(`  Error: ${result.error}`);
      hasErrors = true;
    }
  }

  // Summary
  console.log('\n--- Summary ---');
  const successCount = results.filter((r) => r.status === 'success').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  console.log(`  Success: ${successCount}`);
  console.log(`  Failed:  ${errorCount}`);

  if (hasErrors) {
    console.error('\nSome migrations failed. Fix the errors above and re-run.');
    process.exit(1);
  } else {
    console.log('\nAll migrations completed successfully.');
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
