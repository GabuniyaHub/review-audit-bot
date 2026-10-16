import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTwoGisDom, twoGisBrowserPages } from '../src/collection/twogis-browser.js';
import { readSettings } from '../src/config/settings.js';
const url='https://2gis.ru/tyumen/firm/70000001031280266/tab/reviews';
const card=(stars:number,text:string)=>`<div class="any-variant"><div class="_hf8ayi"><div class="_1fkin5c">${'<svg></svg>'.repeat(stars)}</div><div class="_1ixuu7m">${'<svg></svg>'.repeat(5-stars)}</div><span class="_10c0hgu">7 августа 2026, изменён</span></div><div class="_83kmcy"><a>${text}</a></div><div class="_sgs1pz">Спасибо, официальный ответ!</div></div>`;
test('browser DOM reads short/expanded variants, counts filled stars and excludes business replies',()=>{
 const reviews=parseTwoGisDom(card(2,'Плохо')+card(5,'Хорошо'),url);
 assert.deepEqual(reviews.map(r=>[r.rating,r.text]),[[2,'Плохо'],[5,'Хорошо']]);
 assert.equal(reviews[0].rawDate,'7 августа 2026, изменён');assert.equal(reviews[0].publishedAt,undefined);
});
test('changed or empty layout fails explicitly',()=>{
 assert.throws(()=>parseTwoGisDom('<body>Loading</body>',url),/collection failed/);
 assert.throws(()=>parseTwoGisDom(card(0,'Оценка пропала'),url),/collection failed/);
});
test('browser mode rejects arbitrary target URLs before launching Chromium',async()=>{
 const settings=readSettings({DATABASE_URL:'postgresql://u:p@localhost/test',TWOGIS_MODE:'browser'});
 await assert.rejects(async()=>{for await(const _ of twoGisBrowserPages(settings,{source:'2gis',externalId:'123',url:'http://localhost/tyumen/firm/123'})){};},e=>(e as any).code==='invalid_data');
 assert.throws(()=>readSettings({DATABASE_URL:'postgresql://u:p@localhost/test',TWOGIS_MODE:'unknown'}),/TWOGIS_MODE/);
});
