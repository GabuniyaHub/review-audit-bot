import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSettings } from '../src/config/settings.js';
const valid = {DATABASE_URL: 'postgresql://user:secret@localhost/test'};
test('valid configuration preserves defaults and explicitly configured limits', () => {
  const settings = readSettings({...valid, PORT:'3010', DB_SSL:'true', DB_POOL_MAX:'2'});
  assert.equal(settings.host,'127.0.0.1'); assert.equal(settings.port,3010);
  assert.equal(settings.dbSsl,true); assert.equal(settings.dbPoolMax,2);
});
test('invalid configuration reports variable names without secret values', () => {
  assert.throws(() => readSettings({...valid, DATABASE_URL:'secret-token', PORT:'12abc', DB_SSL:'off'}), e => {
    assert.ok(e instanceof Error); assert.match(e.message,/DATABASE_URL/); assert.match(e.message,/PORT/);
    assert.match(e.message,/DB_SSL/); assert.doesNotMatch(e.message,/secret-token/); return true;
  });
});
test('TLS URL parameters cannot override explicit certificate verification', () => {
  assert.throws(() => readSettings({...valid,DATABASE_URL:valid.DATABASE_URL+'?sslmode=no-verify'}),/DATABASE_URL/);
});
