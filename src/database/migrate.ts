import { pathToFileURL } from 'node:url';
import 'dotenv/config';
import { Pool } from 'pg';
import { readSettings } from '../config/settings.js';
import { createPool } from './pool.js';
import { migrations } from './migrations.js';
export async function migrate(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(427319802)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const existing = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
    for (const row of existing.rows) {
      const known = migrations.find(m => m.version === row.version);
      if (!known || known.checksum !== row.checksum) throw new Error('Migration history mismatch');
    }
    for (const migration of migrations) {
      if (existing.rows.some(row => row.version === migration.version)) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1,$2)', [migration.version, migration.checksum]);
      applied.push(migration.version);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function main() {
  const pool = createPool(readSettings());
  pool.on('error', () => console.error('Database connection failed'));
  try { console.log(JSON.stringify({applied: await migrate(pool)})); }
  finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch(() => {console.error('Migration failed. Check database availability, permissions and migration history.'); process.exitCode = 1;});
