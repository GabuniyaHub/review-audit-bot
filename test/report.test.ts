import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, parsePeriod, Snapshot } from '../src/report/report.js';
import { HttpTelegramApi } from '../src/telegram/api.js';
function snapshot():Snapshot {return {projectId:'1',model:'test',promptVersion:'p',schemaVersion:'s',period:{from:null,to:null},organizations:[{id:'1',name:'Своя | <script>',role:'own',city:'Тюмень',address:'Адрес'},{id:'2',name:'Конкурент',role:'competitor',city:'Тюмень',address:'Адрес'}],cards:[{id:'1',organization_id:'1',source:'yandex',url:'https://yandex.ru/maps/org/1/reviews/',match_status:'verified',status:'partial',error_code:null,stop_reason:'limit'}],reviews:[{id:'1',organization_id:'1',source:'yandex',source_url:'https://evil.example/',card_url:'https://yandex.ru/maps/org/1/reviews/',content_hash:'a'.repeat(64),text:'кофе вкусный, но долго ждали',rating:5,published_at:'2026-10-01T00:00:00.000Z',collected_at:'2026-10-16T00:00:00.000Z',result:{reviewId:'1',sentiment:'mixed',topics:[{topic:'product',sentiment:'positive',evidence:'кофе вкусный'},{topic:'waiting',sentiment:'negative',evidence:'долго ждали'}]}},{id:'2',organization_id:'1',source:'yandex',source_url:null,card_url:'https://yandex.ru/maps/org/1/reviews/',content_hash:'b'.repeat(64),text:'нет анализа',rating:1,published_at:null,collected_at:'2026-10-16T00:00:00.000Z',result:null}]};}
test('report counts only valid analyses in topic denominator and keeps sample ratings separate',()=>{
 const r=buildReport(snapshot(),'2026-10-16T00:00:00Z');const own=r.metrics.organizations[0];assert.equal(own.total,2);assert.equal(own.analyzed,1);assert.equal(own.coverage,50);assert.equal(own.sampleAverage,3);assert.equal(own.topics.find(t=>t.topic==='waiting')!.share,100);assert.equal(r.metrics.recommendations[0].evidence[0].reviewId,'1');assert.ok(!r.markdown.includes('evil.example'));assert.ok(r.markdown.includes('https://yandex.ru/maps/org/1/reviews/'));assert.ok(r.partial);assert.equal(r.metrics.comparisons[0].negativeDifferencePp,null);assert.ok(r.markdown.includes('меньше трёх'));
});
test('period is inclusive by calendar day, excludes unknown dates and rejects impossible dates',()=>{
 const s=snapshot();s.period=parsePeriod('/report 2026-10-01 2026-10-01');assert.equal(s.period.to,'2026-10-02T00:00:00.000Z');assert.equal(buildReport(s).metrics.organizations[0].total,1);
 s.period=parsePeriod('/report 2026-10-02 2026-10-03');assert.equal(buildReport(s).eligible,false);
 for(const c of ['/report 2026-02-30 2026-03-01','/report 2026-10-02 2026-10-01','/report x y'])assert.throws(()=>parsePeriod(c));
});
test('fabricated evidence or duplicate themes cannot enter recommendation metrics',()=>{
 const s=snapshot();(s.reviews[0].result as any).topics.push({topic:'waiting',sentiment:'negative',evidence:'долго ждали'});const r=buildReport(s);assert.equal(r.metrics.invalidAnalyses,1);assert.equal(r.metrics.analyzedTotal,0);assert.equal(r.metrics.recommendations.length,0);
});
test('Telegram report attachment uses multipart upload and preserves Markdown content',async()=>{
 const api=new HttpTelegramApi('secret',async(_url,options)=>{assert.ok(options?.body instanceof FormData);assert.equal(options.headers,undefined);const form=options.body as FormData;assert.equal(form.get('chat_id'),'123');assert.equal(await (form.get('document') as Blob).text(),'# Отчёт\nТест');return new Response(JSON.stringify({ok:true,result:{message_id:1}}));});
 await api.call('sendDocument',{chat_id:123,caption:'Сводка',filename:'audit-1.md',document:'# Отчёт\nТест'});
 await assert.rejects(api.call('sendDocument',{chat_id:123,filename:'../secret',document:'x'}));
});
test('competitor differences use the same analyzed-text denominator in percentage points',()=>{
 const s=snapshot();const base=s.reviews[0];s.reviews=[];
 for(let company=1;company<=2;company++)for(let i=0;i<30;i++){
  const id=String(company*100+i);const negative=company===1&&i<15;
  s.reviews.push({...base,id,organization_id:String(company),result:{reviewId:id,sentiment:negative?'negative':'positive',topics:[{topic:negative?'waiting':'product',sentiment:negative?'negative':'positive',evidence:negative?'долго ждали':'кофе вкусный'}]}});
 }
 const r=buildReport(s);assert.equal(r.metrics.comparisons.find(c=>c.topic==='waiting')!.negativeDifferencePp,50);assert.equal(r.metrics.organizations[0].analyzed,30);assert.equal(r.metrics.organizations[0].topics.find(t=>t.topic==='waiting')!.share,50);
 s.reviews[0].published_at=null;assert.equal(buildReport(s).metrics.comparisons.find(c=>c.topic==='waiting')!.negativeDifferencePp,null);
});
