import { Pool } from 'pg';
import { Settings } from '../config/settings.js';
export function createPool(settings: Settings): Pool {
  return new Pool({connectionString: settings.databaseUrl, max: settings.dbPoolMax,
    connectionTimeoutMillis: settings.dbConnectTimeoutMs, idleTimeoutMillis: 30000,
    statement_timeout: settings.dbQueryTimeoutMs, query_timeout: settings.dbQueryTimeoutMs,
    ssl: settings.dbSsl ? {rejectUnauthorized: true} : false,
    application_name: 'review-audit-bot'});
}
