export interface Settings {
  nodeEnv: 'development' | 'test' | 'production'; host: string; port: number;
  databaseUrl: string; dbPoolMax: number; dbConnectTimeoutMs: number;
  dbQueryTimeoutMs: number; dbSsl: boolean;
}
export const SETTINGS = Symbol('SETTINGS');
export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const errors: string[] = [];
  const integer = (key: string, fallback: number, min: number, max: number): number => {
    const raw = env[key] ?? String(fallback);
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) { errors.push(key); return fallback; }
    return Number(raw);
  };
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) errors.push('NODE_ENV');
  const databaseUrl = env.DATABASE_URL ?? '';
  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error();
    // pg URL ssl parameters can override explicit TLS settings. Keep one configuration path.
    if (['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'].some(k => url.searchParams.has(k))) throw new Error();
  } catch { errors.push('DATABASE_URL'); }
  const host = env.HOST ?? '127.0.0.1';
  if (!host.trim() || /\s/.test(host)) errors.push('HOST');
  const ssl = env.DB_SSL ?? 'false';
  if (!['true', 'false'].includes(ssl)) errors.push('DB_SSL');
  const settings: Settings = {nodeEnv: nodeEnv as Settings['nodeEnv'], host,
    port: integer('PORT',3000,1,65535), databaseUrl,
    dbPoolMax: integer('DB_POOL_MAX',5,1,50),
    dbConnectTimeoutMs: integer('DB_CONNECT_TIMEOUT_MS',5000,100,60000),
    dbQueryTimeoutMs: integer('DB_QUERY_TIMEOUT_MS',10000,100,300000), dbSsl: ssl === 'true'};
  if (errors.length) throw new Error(`Invalid configuration: ${[...new Set(errors)].join(', ')}`);
  return settings;
}
