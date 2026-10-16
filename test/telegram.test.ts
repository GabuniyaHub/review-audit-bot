import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, prompt, Step } from '../src/telegram/dialog.js';
import { parseSourceUrl } from '../src/telegram/source-url.js';
import { SetupDraft } from '../src/telegram/types.js';
import { HttpTelegramApi, TelegramApiError } from '../src/telegram/api.js';
import { readSettings } from '../src/config/settings.js';
test('source URLs accept exact provider domains and card IDs, drop tracking',()=>{
  assert.deepEqual(parseSourceUrl('https://2gis.ru/tyumen/firm/123/tab/info?foo=bar','2gis'),{source:'2gis',externalId:'123',url:'https://2gis.ru/firm/123/tab/reviews'});
  assert.equal(parseSourceUrl('https://yandex.ru/maps/org/garden/123/reviews/','yandex')?.externalId,'123');
  assert.equal(parseSourceUrl('https://yandex.com/maps/org/123/','yandex')?.externalId,'123');
  for(const link of ['http://yandex.ru/maps/org/123/','https://yandex.ru.evil.test/maps/org/123/','https://user:pass@yandex.ru/maps/org/123/','https://127.0.0.1/maps/org/123/','https://yandex.ru/maps/55/tyumen/chain/test/123/','https://yandex.ru:8443/maps/org/123/']) assert.throws(()=>parseSourceUrl(link,'yandex'));
  assert.equal(parseSourceUrl('-','yandex'),null);
});
test('wizard needs one source and rejects duplicate cards across companies',()=>{
  let step:Step='name';let draft:SetupDraft={organizations:[],current:{cards:[]}};
  for(const answer of ['Company','Tyumen','Street, 1','-','-']) {const next=advance(step,draft,answer);step=next.step;draft=next.draft;}
  assert.equal(step,'yandex');assert.equal(draft.organizations.length,0);
  let next=advance(step,draft,'https://yandex.ru/maps/org/123/');draft=next.draft;assert.equal(next.step,'next');
  next=advance('next',draft,'/add');step=next.step;draft=next.draft;
  for(const answer of ['Competitor','Tyumen','Street, 2','-','https://yandex.ru/maps/org/123/']) {next=advance(step,draft,answer);step=next.step;draft=next.draft;}
  assert.equal(step,'yandex');assert.match(next.text,/уже добавлена/);
});
test('wizard limits competitors and previews before save without mutating input',()=>{
  const draft:SetupDraft={organizations:Array.from({length:4},(_,i)=>({name:'Name'+i,city:'City',address:'Address',cards:[{source:'yandex',externalId:String(i),url:`https://yandex.ru/maps/org/${i}/reviews/`}]}))};
  assert.equal(advance('next',draft,'/add').draft.organizations.length,4);
  const preview=advance('next',draft,'/done');assert.equal(preview.step,'confirm');assert.equal(preview.save,undefined);
  assert.equal(advance('confirm',draft,'/save').save,true);
  assert.match(prompt('confirm',draft),/не проверено/);
  const original:SetupDraft={organizations:[],current:{cards:[]}};advance('name',original,'New');assert.equal(original.current?.name,undefined);
});
test('Telegram configuration remains opt-in and does not reveal token values',()=>{
  const database={DATABASE_URL:'postgresql://u:p@localhost/db'};
  assert.equal(readSettings(database).telegramEnabled,false);
  assert.throws(()=>readSettings({...database,TELEGRAM_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123:'+'a'.repeat(30),DB_POOL_MAX:'1'}),/DB_POOL_MAX/);
  assert.throws(()=>readSettings({...database,TELEGRAM_ENABLED:'true',TELEGRAM_BOT_TOKEN:'private-secret'}),error=>{
    assert.ok(error instanceof Error);assert.match(error.message,/TELEGRAM_BOT_TOKEN/);assert.doesNotMatch(error.message,/private-secret/);return true;
  });
});
test('API transport sanitizes fetch failures and exposes only retry metadata',async()=>{
  const api=new HttpTelegramApi('secret-token',async()=>{throw new Error('https://api.telegram.org/botsecret-token/getMe');});
  await assert.rejects(api.call('getMe',{}),error=>{assert.ok(error instanceof TelegramApiError);assert.doesNotMatch(error.message,/secret-token/);return true;});
  const rateLimited=new HttpTelegramApi('secret-token',async()=>new Response(JSON.stringify({ok:false,error_code:429,parameters:{retry_after:12}}),{status:429}));
  await assert.rejects(rateLimited.call('sendMessage',{}),error=>error instanceof TelegramApiError && error.code===429 && error.retryAfter===12);
});
