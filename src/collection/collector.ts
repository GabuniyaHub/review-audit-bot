import { load } from 'cheerio';
import { setTimeout as delay } from 'node:timers/promises';
import { Settings } from '../config/settings.js';
import { SourceHttpClient } from './http.js';
import { normalizeReview } from './normalize.js';
import { CollectionError, ReviewCollector, ReviewInput, ReviewPage, SourceTarget } from './types.js';
// All network URLs are built from a validated numeric provider ID, never a supplied host.
function cardInState(value:unknown,id:string):Record<string,any>|undefined {
  if(!value||typeof value!=='object')return;
  if(!Array.isArray(value)) {const record=value as Record<string,any>;if(String(record.id)===id&&record.reviewResults)return record;}
  for(const child of Object.values(value)) {const found=cardInState(child,id);if(found)return found;}
}
export function parseYandex(html:string,id:string):ReviewInput[] {
  const $=load(html);let card:Record<string,any>|undefined;
  for(const element of $('script.state-view[type="application/json"]').toArray()) {
    try {card=cardInState(JSON.parse($(element).text()),id);if(card)break;}catch {}
  }
  if(!card||!Array.isArray(card.reviewResults?.reviews))throw new CollectionError('layout_changed');
  if(!card.reviewResults.reviews.length && Number(card.ratingData?.reviewCount)>0)throw new CollectionError('layout_changed');
  return card.reviewResults.reviews.map((value:any)=>{const r=value??{};if(r.businessId && String(r.businessId)!==id)throw new CollectionError('invalid_data');return ({externalId:r.reviewId,text:r.text??'',rating:r.rating,updatedAtSource:r.updatedTime,
    // updatedTime is not a publication date. Keep publishedAt unknown here.
    rawDate:r.updatedTime,sourceUrl:r.url,authorKey:r.author?.id??r.author?.name});});
}
export function parseTwoGis(text:string):ReviewInput[] {
  let data:any;try {data=JSON.parse(text);}catch {throw new CollectionError('layout_changed');}
  if(!Array.isArray(data.reviews))throw new CollectionError('layout_changed');
  return data.reviews.map((value:any)=>{const r=value??{};return ({excluded:!!r.is_hidden,externalId:r.id,text:r.text??'',rating:r.rating,publishedAt:r.date_created,updatedAtSource:r.date_edited,rawDate:r.date_created,sourceUrl:r.url,authorKey:r.user?.id??r.user?.name});});
}
export class SourceCollector implements ReviewCollector {
  constructor(private readonly settings:Settings,private readonly http=new SourceHttpClient(undefined,settings.collectionTimeoutMs)) {}
  async *pages(target:SourceTarget,signal?:AbortSignal):AsyncGenerator<ReviewPage> {
    if(!/^\d{1,20}$/.test(target.externalId))throw new CollectionError('invalid_data');
    if(target.source==='2gis'&&!this.settings.twoGisReviewsKey)throw new CollectionError('not_configured');
    const limit=target.maxReviews??this.settings.collectionMaxReviews;
    if(!Number.isInteger(limit)||limit<1||limit>1000)throw new CollectionError('invalid_data');const seen=new Set<string>();let accepted=0;
    for(let page=1;page<=Math.ceil(limit/50);page++) {
      if(signal?.aborted)throw new CollectionError('timeout');
      const url=target.source==='yandex'?new URL(`https://yandex.ru/maps/org/${target.externalId}/reviews/?page=${page}&sort_by=by_time`):new URL(`https://public-api.reviews.2gis.com/3.0/branches/${target.externalId}/reviews`);
      if(target.source==='2gis') {url.searchParams.set('limit','50');url.searchParams.set('offset',String((page-1)*50));url.searchParams.set('sort_by','date_created');url.searchParams.set('key',this.settings.twoGisReviewsKey);}
      const text=await this.http.text(url,signal);
      const raw=target.source==='yandex'?parseYandex(text,target.externalId):parseTwoGis(text);
      const reviews=[];let invalidCount=0;let newKeys=0;
      for(const item of raw) {
        if(item.excluded)continue;
        try {
          const review=normalizeReview(item,target.source);
          if(seen.has(review.dedupKey))continue;
          seen.add(review.dedupKey);newKeys++;
          if(accepted<limit){reviews.push(review);accepted++;}
        } catch(error) {if(!(error instanceof CollectionError))throw error;invalidCount++;}
      }
      if(raw.some(item=>!item.excluded)&&!newKeys&&!invalidCount)throw new CollectionError('layout_changed');
      const exhausted=raw.length<50;
      const reachedLimit=accepted>=limit||page===Math.ceil(limit/50);
      yield {reviews,invalidCount,page,stopReason:newKeys>reviews.length?'limit':exhausted?'exhausted':reachedLimit?'limit':null};
      if(exhausted||reachedLimit)return;
      await delay(this.settings.collectionPageDelayMs,undefined,{signal}).catch(()=>{throw new CollectionError('timeout');});
    }
  }
}
