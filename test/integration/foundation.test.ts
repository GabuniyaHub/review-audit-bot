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
import { BotService } from '../../src/telegram/bot.service.js';
import { PollingService } from '../../src/telegram/polling.service.js';
import { TelegramApi, TelegramApiError } from '../../src/telegram/api.js';
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
      assert.deepEqual(await migrate(pool),['001_initial','002_telegram']);
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
      for(const migration of migrations) await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2',[migration.checksum,migration.version]);
    });
    await t.test('error responses do not expose query secrets or stack traces',async()=>{
      const response=await fetch(base+'/missing?token=hidden'); const body=await response.json() as any;
      assert.equal(response.status,404); assert.equal(body.path,'/missing');
      assert.doesNotMatch(JSON.stringify(body),/hidden|stack/);
    });
    await t.test('Telegram setup is persistent, isolated and idempotent with transactional replies',async()=>{
      const database=app!.get(DatabaseService);let bot=new BotService(database);let updateId=100;
      const send=async(user:number,text:string,type='private')=>{
        const id=++updateId;
        await bot.processUpdate(900,{update_id:id,message:{message_id:id,from:{id:user},chat:{id:user,type},text}});
        return (await pool.query('SELECT text FROM telegram_outbox WHERE bot_id=900 AND update_id=$1',[id])).rows[0]?.text as string|undefined;
      };
      await send(20001,'/setup');await send(20001,'Garden');
      bot=new BotService(database);assert.equal(await send(20001,'/resume'),'Введите город.');
      for(const answer of ['Тюмень','Малыгина, 90','https://2gis.ru/tyumen/firm/123/','https://yandex.ru/maps/org/456/','/done']) await send(20001,answer);
      assert.match((await send(20001,'/settings'))!,/настроек нет/);
      const saveId=updateId+1;assert.match((await send(20001,'/save'))!,/сохранены/);
      await bot.processUpdate(900,{update_id:saveId,message:{message_id:1,from:{id:20001},chat:{id:20001,type:'private'},text:'/save'}});
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM telegram_outbox WHERE bot_id=900 AND update_id=$1',[saveId])).rows[0].n,1);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit_projects p JOIN users u ON p.user_id=u.id WHERE u.telegram_user_id=20001')).rows[0].n,1);
      assert.match((await send(20001,'/settings'))!,/Garden/);
      assert.doesNotMatch((await send(20002,'/settings'))!,/Garden/);
      assert.equal(await send(20001,'/settings','group'),undefined);
      await send(20001,'/setup');await send(20001,'Replacement');await send(20001,'/cancel');
      assert.match((await send(20001,'/settings'))!,/Garden/);
      assert.match((await send(20001,'/report'))!,/будут подключены/);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit_runs a JOIN audit_projects p ON a.project_id=p.id JOIN users u ON p.user_id=u.id WHERE u.telegram_user_id=20001')).rows[0].n,0);
      const project=(await pool.query('SELECT tp.project_id FROM telegram_profiles tp JOIN users u ON tp.user_id=u.id WHERE u.telegram_user_id=20001')).rows[0].project_id;
      const run=(await pool.query("INSERT INTO audit_runs(project_id,status) VALUES($1,'completed') RETURNING id",[project])).rows[0].id;
      await pool.query("INSERT INTO reports(project_id,audit_run_id,summary,markdown,metrics) VALUES($1,$2,'Private summary','Details','{}')",[project,run]);
      assert.match((await send(20001,'/report'))!,/Private summary/);
      assert.doesNotMatch((await send(20002,'/report'))!,/Private summary/);
      assert.match((await send(20001,'/status'))!,/завершён/);
      await send(20003,'/setup');
      for(let i=0;i<4;i++) {
        for(const answer of ['Company'+i,'Tyumen','Address'+i,`https://2gis.ru/firm/${80000+i}/`,'-']) await send(20003,answer);
        if(i<3) await send(20003,'/add');
      }
      await send(20003,'/add');await send(20003,'/save');
      const configured=await pool.query('SELECT o.role FROM organizations o JOIN telegram_profiles tp ON o.project_id=tp.project_id JOIN users u ON tp.user_id=u.id WHERE u.telegram_user_id=20003');
      assert.equal(configured.rows.length,4);assert.equal(configured.rows.filter(o=>o.role==='competitor').length,3);
      assert.doesNotMatch((await send(20003,'/settings'))!,/Garden/);

    });
    await t.test('Telegram worker delivers queued replies and prevents duplicate pollers',async()=>{
      const database=app!.get(DatabaseService);const bot=new BotService(database);let sent=0;let failDelivery=true;
      const api:TelegramApi={async call<T>(method:string,_payload:Record<string,unknown>,signal?:AbortSignal):Promise<T>{
        if(method==='getMe') return {id:900,is_bot:true} as T;
        if(method==='getWebhookInfo') return {url:''} as T;
        if(method==='getUpdates') {await new Promise<void>(resolve=>{if(signal?.aborted) resolve();else signal?.addEventListener('abort',()=>resolve(),{once:true});});return [] as T;}
        if(method==='sendMessage') {if(failDelivery) {failDelivery=false;throw new TelegramApiError(429,1);} sent++;return {} as T;}
        throw new Error('Unexpected method');
      }};
      const config={...settings,telegramEnabled:true,telegramBotToken:'test-only'};
      const worker=new PollingService(config,database,bot,api);
      try {
        await worker.onApplicationBootstrap();assert.equal(worker.isReady(),true);
        const duplicate=new PollingService(config,database,bot,api);
        await assert.rejects(duplicate.onApplicationBootstrap(),/active poller/);
        // Wait until the first delivery attempt has been persisted, then stop polling.
        for(let n=0;n<30;n++) {if((await pool.query("SELECT count(*)::int AS n FROM telegram_outbox WHERE bot_id=900 AND attempts=1")).rows[0].n>0)break;await delay(10);}
      } finally {await worker.beforeApplicationShutdown();}
      assert.equal(sent,0);assert.equal(worker.isReady(),false);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM telegram_outbox WHERE bot_id=900 AND attempts=1 AND status='pending'")).rows[0].n,1);
      await pool.query("UPDATE telegram_outbox SET next_attempt_at=now() WHERE bot_id=900");
      const resumed=new PollingService(config,database,bot,api);
      try {await resumed.onApplicationBootstrap();for(let n=0;n<50;n++){if(sent>0)break;await delay(10);}}
      finally {await resumed.beforeApplicationShutdown();}
      assert.ok(sent>0);
      assert.ok((await pool.query("SELECT count(*)::int AS n FROM telegram_outbox WHERE bot_id=900 AND status='sent'")).rows[0].n>0);
      const webhookApi:TelegramApi={async call<T>(method:string):Promise<T>{return (method==='getMe'?{id:901,is_bot:true}:{url:'https://example.test/webhook'}) as T;}};
      await assert.rejects(new PollingService(config,database,bot,webhookApi).onApplicationBootstrap(),/webhook/);
    });
    await t.test('production entry point starts and shuts down cleanly',async()=>{
      const httpPort=await freePort();
      const child=spawn(process.execPath,['dist/src/main.js'],{env:{...process.env,NODE_ENV:'test',TELEGRAM_ENABLED:'false',DATABASE_URL:settings.databaseUrl,HOST:'127.0.0.1',PORT:String(httpPort),DB_SSL:'false'},stdio:'ignore'});
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
