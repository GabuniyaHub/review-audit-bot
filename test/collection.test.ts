import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReview, isoDate } from '../src/collection/normalize.js';
import { parseYandex,parseTwoGis,SourceCollector } from '../src/collection/collector.js';
import { SourceHttpClient } from '../src/collection/http.js';
import { CollectionError } from '../src/collection/types.js';
import { readSettings } from '../src/config/settings.js';
const settings=readSettings({DATABASE_URL:'postgresql://u:p@localhost/test',COLLECTION_ENABLED:'true',COLLECTION_MAX_REVIEWS:'100',COLLECTION_PAGE_DELAY_MS:'0',TWOGIS_REVIEWS_KEY:'test-key'});
function html(id:string,reviews:any[]) {return `<script class="state-view" type="application/json">${JSON.stringify({stack:[{id,reviewResults:{reviews}}]})}</script>`;}
test('normalization retains stable source identity while edited content changes hash',()=>{
  const review={externalId:'id1',text:'  Отлично\u0000  \r\n кофе ',rating:5,publishedAt:'2026-10-16T10:00:00+03:00'};
  const first=normalizeReview(review,'2gis'),changed=normalizeReview({...review,text:'Изменённый отзыв'},'2gis');
  assert.equal(first.text,'Отлично\nкофе');assert.equal(first.dedupKey,changed.dedupKey);assert.notEqual(first.contentHash,changed.contentHash);
  assert.equal(first.publishedAt,'2026-10-16T07:00:00.000Z');
  assert.equal(isoDate('2026-10-16T00:00:00+03:00'),'2026-10-15T21:00:00.000Z');
  assert.equal(isoDate('2026-02-31T00:00:00Z'),null);assert.equal(isoDate('вчера'),null);
  assert.throws(()=>normalizeReview({text:'hi',rating:0},'2gis'));
  assert.equal(normalizeReview({text:'hi',rating:null},'2gis').dedupKey,normalizeReview({text:'hi',rating:null},'2gis').dedupKey);
});
test('Yandex parser binds exact organization and keeps update separate from publication',()=>{
  const raw=parseYandex(html('123',[{reviewId:'r1',businessId:'123',text:'Хорошо',rating:5,updatedTime:'2026-10-16T10:00:00Z'}]),'123');
  const normalized=normalizeReview(raw[0],'yandex');assert.equal(normalized.publishedAt,null);assert.ok(normalized.updatedAtSource);
  assert.throws(()=>parseYandex(html('456',[]),'123'),e=>e instanceof CollectionError&&e.code==='layout_changed');
  assert.throws(()=>parseYandex(html('123',[{businessId:'456'}]),'123'),e=>e instanceof CollectionError&&e.code==='invalid_data');
  assert.throws(()=>parseTwoGis('{"notReviews":[]}'),e=>e instanceof CollectionError&&e.code==='layout_changed');
});
test('collector paginates, excludes hidden reviews and stops at configured cap',async()=>{
  let calls=0;
  const fake=new SourceHttpClient(async()=>{const offset=calls++*50;return new Response(JSON.stringify({reviews:Array.from({length:50},(_,i)=>({id:String(offset+i),text:'Text '+i,rating:5,date_created:'2026-10-16T10:00:00Z',is_hidden:i===0}))}));});
  const collector=new SourceCollector(settings,fake);const pages=[];
  for await(const page of collector.pages({source:'2gis',externalId:'123',url:''}))pages.push(page);
  assert.equal(calls,2);assert.equal(pages.reduce((n,p)=>n+p.reviews.length,0),98);assert.equal(pages.at(-1)?.stopReason,'limit');
});
test('small budget does not claim to have processed the rest of a short page',async()=>{
  const collector=new SourceCollector({...settings,collectionMaxReviews:1},new SourceHttpClient(async()=>new Response(JSON.stringify({reviews:[{id:'1',text:'A',rating:5},{id:'2',text:'B',rating:5}]}))));
  const pages=[];for await(const page of collector.pages({source:'2gis',externalId:'123',url:''}))pages.push(page);
  assert.equal(pages[0].reviews.length,1);assert.equal(pages[0].stopReason,'limit');
});
test('repeated pages are an explicit source error, not a successful empty result',async()=>{
  const reviews=Array.from({length:50},(_,i)=>({reviewId:String(i),text:'Text '+i,rating:5}));
  const collector=new SourceCollector(settings,new SourceHttpClient(async()=>new Response(html('123',reviews))));
  let pages=0;
  await assert.rejects(async()=>{for await(const page of collector.pages({source:'yandex',externalId:'123',url:''})){pages++;assert.equal(page.reviews.length,50);}},e=>e instanceof CollectionError&&e.code==='layout_changed');
  assert.equal(pages,1);
});
test('source HTTP rejects redirect to local network and classifies CAPTCHA/rate limits',async()=>{
  let calls=0;
  const blocked=new SourceHttpClient(async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/admin'}});});
  await assert.rejects(blocked.text(new URL('https://yandex.ru/maps/')),e=>e instanceof CollectionError&&e.code==='forbidden');assert.equal(calls,1);
  const captcha=new SourceHttpClient(async()=>new Response(null,{status:302,headers:{location:'/showcaptcha?secret=x'}}));
  await assert.rejects(captcha.text(new URL('https://yandex.ru/maps/')),e=>e instanceof CollectionError&&e.code==='captcha');
  const limited=new SourceHttpClient(async()=>new Response(null,{status:429,headers:{'retry-after':'7'}}));
  await assert.rejects(limited.text(new URL('https://yandex.ru/maps/')),e=>e instanceof CollectionError&&e.code==='rate_limited'&&e.retryAfter===7);
});
test('oversize source body and errors never reveal key-bearing URLs',async()=>{
  const oversized=new SourceHttpClient(async()=>new Response('x',{headers:{'content-length':'6000000'}}));
  await assert.rejects(oversized.text(new URL('https://yandex.ru/maps/')),e=>e instanceof CollectionError&&e.code==='invalid_data');
  const failed=new SourceHttpClient(async()=>{throw new Error('secret-key');});
  await assert.rejects(failed.text(new URL('https://public-api.reviews.2gis.com/?key=secret-key')),e=>e instanceof CollectionError&&!e.message.includes('secret-key'));
});
