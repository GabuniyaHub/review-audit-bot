import { createHash } from 'node:crypto';
import { CollectionError, NormalizedReview, ReviewInput, Source } from './types.js';
export const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function cleanText(text:string):string {
  return text.normalize('NFC').replace(/\u0000/g,'').replace(/\r\n?/g,'\n').split('\n').map(line=>line.replace(/[\t \u00a0]+/g,' ').trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function isoDate(value:unknown):string|null {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))return null;
  const date=new Date(value);
  const calendar=new Date(value.slice(0,10)+'T00:00:00Z');
  if(value.startsWith('0000')||!Number.isFinite(date.getTime())||!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==value.slice(0,10))return null;
  return date.toISOString();
}
export function normalizeReview(input:ReviewInput,source:Source):NormalizedReview {
  if(typeof input.text!=='string'||input.text.length>100000)throw new CollectionError('invalid_data');
  const text=cleanText(input.text);
  const rating=input.rating==null?null:input.rating;
  if(rating!==null&&(!Number.isInteger(rating)||Number(rating)<1||Number(rating)>5))throw new CollectionError('invalid_data');
  if(!text&&rating===null)throw new CollectionError('invalid_data');
  const externalId=typeof input.externalId==='string'&&input.externalId.length>0&&input.externalId.length<=200&&!/[\u0000-\u001f]/.test(input.externalId)?input.externalId:null;
  const publishedAt=isoDate(input.publishedAt),updatedAtSource=isoDate(input.updatedAtSource);
  const rawDate=typeof input.rawDate==='string'?cleanText(input.rawDate).slice(0,200):typeof input.publishedAt==='string'&&!publishedAt?cleanText(input.publishedAt).slice(0,200):null;
  let sourceUrl:string|null=null;
  if(typeof input.sourceUrl==='string')try {const u=new URL(input.sourceUrl);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(source==='2gis'?['2gis.ru']:['yandex.ru','yandex.com']).includes(u.hostname))sourceUrl=u.toString().slice(0,2048);}catch {}
  const fallback=hash(JSON.stringify([text,rating,publishedAt,rawDate,typeof input.authorKey==='string'?input.authorKey:'']));
  return {externalId,dedupKey:externalId?'id:'+externalId:'hash:'+fallback,text,rating:rating as number|null,publishedAt,updatedAtSource,rawDate,sourceUrl,
    contentHash:hash(JSON.stringify([text,rating])),textFingerprint:hash(text)};
}
