import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { SETTINGS, Settings } from '../config/settings.js';
import { createPool } from './pool.js';
import { migrations } from './migrations.js';
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);
  constructor(@Inject(SETTINGS) settings: Settings) {
    this.pool = createPool(settings);
    this.pool.on('error', () => this.logger.error('Idle database connection failed'));
  }
  async ready(): Promise<boolean> {
    try {
      const result = await this.pool.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
      return result.rows.length === migrations.length && migrations.every((m,i) => result.rows[i].version === m.version && result.rows[i].checksum === m.checksum);
    } catch { return false; }
  }
  async onApplicationShutdown(): Promise<void> { await this.pool.end(); }
}
