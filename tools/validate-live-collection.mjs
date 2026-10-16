// Explicit, opt-in live source validation against an isolated temporary PostgreSQL.
// Run after npm run build. Requires TWOGIS_REVIEWS_KEY; no Telegram/LLM calls.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp,rm,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readSettings } from '../dist/src/config/settings.js';
import { createPool } from '../dist/src/database/pool.js';
import { DatabaseService } from '../dist/src/database/database.service.js';
import { migrate } from '../dist/src/database/migrate.js';
import { SourceHttpClient } from '../dist/src/collection/http.js';
import { SourceCollector } from '../dist/src/collection/collector.js';
import { CollectionService } from '../dist/src/collection/collection.service.js';
const yandexOnly=process.argv.includes('--yandex-only');
const recordedIndex=process.argv.indexOf('--recorded-2gis');
const recordedDir=recordedIndex>=0?process.argv[recordedIndex+1]:null;
if(!yandexOnly&&!recordedDir&&!process.env.TWOGIS_REVIEWS_KEY)throw new Error('Set TWOGIS_REVIEWS_KEY privately before live validation');
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const directory=await mkdtemp(join(tmpdir(),'review-live-'));const password=randomBytes(16).toString('hex');
const postgres=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password,port,persistent:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
const settings=readSettings({DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,COLLECTION_ENABLED:'true',COLLECTION_MAX_REVIEWS:'125',TWOGIS_REVIEWS_KEY:recordedDir?'recorded-no-network':yandexOnly?'':process.env.TWOGIS_REVIEWS_KEY});
const pool=createPool(settings);pool.on('error',()=>{});const database=new DatabaseService(settings);let started=false;
try {
 await postgres.initialise();await postgres.start();started=true;await migrate(pool);
 const uid=(await pool.query('INSERT INTO users(telegram_user_id) VALUES(1) RETURNING id')).rows[0].id;
 const project=(await pool.query("INSERT INTO audit_projects(user_id,name) VALUES($1,'Live source validation') RETURNING id",[uid])).rows[0].id;
 const cards=[];
 const specs=yandexOnly?[['Garden',null,'35702680521'],['Optimist coffee',null,'130207180834']]:[['Garden','70000001031280266','35702680521'],['Кофе Брют','70000001054792107',null],['Optimist coffee','70000001076287128',null],['Максим','1830115629686843',null]];
 if(recordedDir)for(const spec of specs)spec[2]=null;
 for(const [index,[name,twoGis,yandex]] of specs.entries()) {
  const oid=(await pool.query('INSERT INTO organizations(project_id,role,name,city,address) VALUES($1,$2,$3,\'Тюмень\',\'pilot\') RETURNING id',[project,index===0?'own':'competitor',name])).rows[0].id;
  for(const [source,externalId] of [['2gis',twoGis],['yandex',yandex]]) {
   if(!externalId)continue;
   const url=source==='2gis'?`https://2gis.ru/firm/${externalId}/tab/reviews`:`https://yandex.ru/maps/org/${externalId}/reviews/`;
   const card=(await pool.query("INSERT INTO source_cards(project_id,organization_id,source,external_id,url,match_status,verified_at) VALUES($1,$2,$3,$4,$5,'verified',now()) RETURNING id",[project,oid,source,externalId,url])).rows[0].id;
   cards.push({id:card,name,source});await pool.query('INSERT INTO collection_runs(project_id,source_card_id,max_reviews) VALUES($1,$2,125)',[project,card]);
  }
 }
 const recordedHttp=recordedDir?new SourceHttpClient(async(input)=>{
  const url=new URL(String(input));const id=url.pathname.match(/branches\/(\d+)\/reviews/)?.[1];
  if(!specs.some(spec=>spec[1]===id))throw new Error('Unknown recorded fixture');
  const rows=JSON.parse(await readFile(join(recordedDir,id+'-sample.json'),'utf8'));
  const offset=Number(url.searchParams.get('offset'));return new Response(JSON.stringify({reviews:rows.slice(offset,offset+50)}));
 }):undefined;
 const service=new CollectionService(database,settings,new SourceCollector(settings,recordedHttp));
 for(let i=0;i<cards.length;i++)await service.processNext();
 const results=(await pool.query('SELECT o.name,sc.source,r.status,r.error_code,r.collected_count,r.pages_fetched,r.stop_reason FROM collection_runs r JOIN source_cards sc ON sc.id=r.source_card_id JOIN organizations o ON o.id=sc.organization_id ORDER BY r.id')).rows;
 const counts=(await pool.query('SELECT sc.source,count(*)::int AS reviews,count(*) FILTER(WHERE length(r.text)>0)::int AS with_text FROM reviews r JOIN source_cards sc ON sc.id=r.source_card_id GROUP BY sc.source ORDER BY sc.source')).rows;
 const before=Number((await pool.query('SELECT count(*) AS n FROM reviews')).rows[0].n);
 const repeatCard=cards[0];
 let repeat=null;
 if(results[0]?.collected_count>0) {
  const id=(await pool.query('INSERT INTO collection_runs(project_id,source_card_id,max_reviews) VALUES($1,$2,125) RETURNING id',[project,repeatCard.id])).rows[0].id;
  await service.processNext();
  repeat={...(await pool.query('SELECT status,error_code,collected_count FROM collection_runs WHERE id=$1',[id])).rows[0],total_before:before,total_after:Number((await pool.query('SELECT count(*) AS n FROM reviews')).rows[0].n)};
 }
 const output={provenance:recordedDir?'recorded-2gis-responses-no-network':'live-http',checked_at:new Date().toISOString(),results,counts,repeat,notes:recordedDir?'Previously captured source responses through injected HTTP transport, isolated PostgreSQL; no external requests. No texts or secrets exported.':'Real external responses, isolated PostgreSQL. No review texts, authors, keys or DB credentials exported.'};
 await writeFile(process.argv[2]??'live-collection-results.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output,null,2));
 if(results.some(r=>!['completed','partial'].includes(r.status)||r.error_code)||repeat?.total_after!==repeat?.total_before)process.exitCode=1;
}finally {await database.onApplicationShutdown();await pool.end();if(started)await postgres.stop();await rm(directory,{recursive:true,force:true});}
