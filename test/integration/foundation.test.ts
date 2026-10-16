import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { readSettings, SETTINGS } from '../../src/config/settings.js';
import { createPool } from '../../src/database/pool.js';
import { migrate } from '../../src/database/migrate.js';
import { migrations } from '../../src/database/migrations.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { HealthController } from '../../src/health/health.controller.js';
import { HttpErrorFilter } from '../../src/common/http-exception.filter.js';
async function freePort(): Promise<number> {
  const server=createServer(); await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as AddressInfo).port; await new Promise<void>(resolve=>server.close(()=>resolve())); return port;
}
test('foundation against isolated real PostgreSQL', {timeout:90000}, async t => {
  const {default: EmbeddedPostgres} = await import('embedded-postgres');
  const directory=await mkdtemp(join(tmpdir(),'review-audit-test-'));
  const port=await freePort(); const password=randomBytes(16).toString('hex');
  const postgres=new EmbeddedPostgres({databaseDir:join(directory,'pg'),port,user:'postgres',password,
    persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  let app: INestApplication | undefined; let started=false;
  const settings=readSettings({NODE_ENV:'test',DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,DB_CONNECT_TIMEOUT_MS:'500',DB_QUERY_TIMEOUT_MS:'2000'});
  const pool=createPool(settings); pool.on('error',()=>{});
  try {
    await postgres.initialise(); await postgres.start(); started=true;
    const module=await Test.createTestingModule({controllers:[HealthController],providers:[{provide:SETTINGS,useValue:settings},DatabaseService]}).compile();
    app=module.createNestApplication(); app.useLogger(false); app.useGlobalFilters(new HttpErrorFilter());
    await app.listen(0,'127.0.0.1'); const base=await app.getUrl();
    await t.test('liveness works; unmigrated database is not ready',async()=>{
      assert.equal((await fetch(base+'/health/live')).status,200);
      assert.equal((await fetch(base+'/health/ready')).status,503);
    });
    await t.test('migration is applied once, concurrent repetitions are idempotent',async()=>{
      assert.deepEqual(await migrate(pool),['001_initial']);
      assert.deepEqual(await Promise.all([migrate(pool),migrate(pool)]),[[],[]]);
      assert.equal((await fetch(base+'/health/ready')).status,200);
    });
    await t.test('schema prevents duplicate reviews and cross-project associations',async()=>{
      const user=(await pool.query('INSERT INTO users(telegram_user_id) VALUES (10001) RETURNING id')).rows[0].id;
      const p=(await pool.query("INSERT INTO audit_projects(user_id,name) VALUES ($1,'A'),($1,'B') RETURNING id",[user])).rows;
      const org=(await pool.query("INSERT INTO organizations(project_id,role,name,city,address) VALUES ($1,'own','Pilot','Tyumen','Address') RETURNING id",[p[0].id])).rows[0].id;
      await assert.rejects(pool.query("INSERT INTO source_cards(project_id,organization_id,source,external_id,url) VALUES ($1,$2,'yandex','1','https://yandex.ru/maps/')",[p[1].id,org]),(e:any)=>e.code==='23503');
      const card=(await pool.query("INSERT INTO source_cards(project_id,organization_id,source,external_id,url) VALUES ($1,$2,'yandex','1','https://yandex.ru/maps/') RETURNING id",[p[0].id,org])).rows[0].id;
      const sql="INSERT INTO reviews(project_id,source_card_id,external_id,dedup_key,text,rating,content_hash) VALUES ($1,$2,'review-1','id:review-1','Test',5,$3)";
      await pool.query(sql,[p[0].id,card,'a'.repeat(64)]);
      await assert.rejects(pool.query(sql,[p[0].id,card,'a'.repeat(64)]),(e:any)=>e.code==='23505');
      await pool.query('INSERT INTO audit_runs(project_id) VALUES ($1)',[p[0].id]);
      await assert.rejects(pool.query('INSERT INTO audit_runs(project_id) VALUES ($1)',[p[0].id]),(e:any)=>e.code==='23505');
    });
    await t.test('migration checksum mismatch is rejected and readiness fails',async()=>{
      await pool.query("UPDATE schema_migrations SET checksum='tampered'");
      await assert.rejects(migrate(pool),/Migration history mismatch/);
      assert.equal((await fetch(base+'/health/ready')).status,503);
      await pool.query('UPDATE schema_migrations SET checksum=$1',[migrations[0].checksum]);
    });
    await t.test('error responses do not expose query secrets or stack traces',async()=>{
      const response=await fetch(base+'/missing?token=hidden'); const body=await response.json() as any;
      assert.equal(response.status,404); assert.equal(body.path,'/missing');
      assert.doesNotMatch(JSON.stringify(body),/hidden|stack/);
    });
    await t.test('production entry point starts and shuts down cleanly',async()=>{
      const httpPort=await freePort();
      const child=spawn(process.execPath,['dist/src/main.js'],{env:{...process.env,NODE_ENV:'test',DATABASE_URL:settings.databaseUrl,HOST:'127.0.0.1',PORT:String(httpPort),DB_SSL:'false'},stdio:'ignore'});
      const exit=once(child,'exit');
      try {
        let ready=false;
        for(let attempt=0;attempt<50;attempt++) {
          if(child.exitCode!==null) throw new Error('Application exited during startup');
          try {ready=(await fetch(`http://127.0.0.1:${httpPort}/health/ready`)).status===200;} catch {}
          if(ready) break;
          await delay(100);
        }
        assert.equal(ready,true);
      } finally { child.kill('SIGTERM'); await exit; }
      assert.equal(child.signalCode,'SIGTERM');
    });
    await t.test('database loss changes readiness to 503 but keeps liveness',async()=>{
      await postgres.stop(); started=false;
      assert.equal((await fetch(base+'/health/ready')).status,503);
      assert.equal((await fetch(base+'/health/live')).status,200);
    });
  } finally {
    await app?.close(); await pool.end();
    if(started) await postgres.stop();
    await rm(directory,{recursive:true,force:true});
  }
});
