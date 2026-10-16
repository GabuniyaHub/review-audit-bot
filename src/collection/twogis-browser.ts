import { chromium } from 'playwright';
import { load } from 'cheerio';
import { Settings } from '../config/settings.js';
import { normalizeReview } from './normalize.js';
import { CollectionError, ReviewInput, ReviewPage, SourceTarget } from './types.js';

// Both short and expandable review variants share these inner elements.
// Read only the visitor's text; official responses are outside _83kmcy.
export function parseTwoGisDom(html:string, url:string):ReviewInput[] {
  const $=load(html);const result:ReviewInput[]=[];
  $('._hf8ayi').each((_i,header)=>{
    const card=$(header).parent();
    const text=card.children('._83kmcy').find('a').text();
    const date=$(header).find('._10c0hgu').text();
    const rating=$(header).find('._1fkin5c svg').length;
    if(!date||rating<1||rating>5)throw new CollectionError('layout_changed');
    // UI dates may describe an edit, with no publication timestamp or timezone.
    // Preserve their exact value instead of inventing a publication time.
    result.push({text,rating,rawDate:date,sourceUrl:url});
  });
  if(!result.length)throw new CollectionError('layout_changed');
  return result;
}
export async function* twoGisBrowserPages(settings:Settings,target:SourceTarget,signal?:AbortSignal):AsyncGenerator<ReviewPage> {
  const limit=target.maxReviews??settings.collectionMaxReviews;
  if(!/^\d{1,20}$/.test(target.externalId)||!Number.isInteger(limit)||limit<1||limit>1000)throw new CollectionError('invalid_data');
  let url:URL;try {url=new URL(target.url);}catch {throw new CollectionError('invalid_data');}
  if(url.protocol!=='https:'||url.hostname!=='2gis.ru'||url.username||url.password||url.port||!new RegExp(`^/(?:[a-z_-]+/)?firm/${target.externalId}(?:/|$)`).test(url.pathname))throw new CollectionError('invalid_data');
  url.pathname=(url.pathname.startsWith('/firm/')?'':url.pathname.split('/firm/')[0])+`/firm/${target.externalId}/tab/reviews`;url.search='';url.hash='';
  if(signal?.aborted)throw new CollectionError('timeout');
  const browser=await chromium.launch({headless:true}).catch(()=>{throw new CollectionError('not_configured');});
  const abort=()=>{void browser.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  let timedOut=false;
  const deadline=setTimeout(()=>{timedOut=true;abort();},180_000);
  try {
    const page=await browser.newPage({locale:'ru-RU'});page.setDefaultTimeout(settings.collectionTimeoutMs);
    const response=await page.goto(url.toString(),{waitUntil:'domcontentloaded',timeout:settings.collectionTimeoutMs});
    if(response?.status()===429)throw new CollectionError('rate_limited');
    if(response?.status()===403)throw new CollectionError('forbidden');
    if(response&&response.status()>=500)throw new CollectionError('unavailable');
    const checkChallenge=async()=>{if(/captcha|капч|не робот|подтвердите.{0,30}(человек|робот)/i.test((await page.title())+' '+await page.locator('body').innerText()))throw new CollectionError('captcha');};
    await checkChallenge();
    await page.locator('._hf8ayi').first().waitFor().catch(async(error)=>{await checkChallenge();throw error;});
    const seen=new Set<string>();let accepted=0;
    for(let index=1;index<=Math.ceil(limit/50)+2;index++) {
      if(signal?.aborted)throw new CollectionError('timeout');
      await checkChallenge();
      const raw=parseTwoGisDom(await page.content(),url.toString());const reviews=[];let invalidCount=0,newKeys=0;
      for(const item of raw){try{const review=normalizeReview(item,'2gis');if(seen.has(review.dedupKey))continue;seen.add(review.dedupKey);newKeys++;if(accepted<limit){reviews.push(review);accepted++;}}catch(error){if(!(error instanceof CollectionError))throw error;invalidCount++;}}
      if(!newKeys)throw new CollectionError('layout_changed');
      const more=page.getByRole('button',{name:'Загрузить ещё',exact:true});const exhausted=await more.count()===0;
      const reachedLimit=accepted>=limit||index===Math.ceil(limit/50)+2;
      yield {reviews,invalidCount,page:index,stopReason:reachedLimit?'limit':exhausted?'exhausted':null};
      if(exhausted||reachedLimit)return;
      const previous=raw.length;
      await page.waitForTimeout(settings.collectionPageDelayMs);await more.click();
      await page.waitForFunction(count=>document.querySelectorAll('._hf8ayi').length>count,previous,{timeout:settings.collectionTimeoutMs});
    }
  }catch(error){if(error instanceof CollectionError)throw error;throw new CollectionError(timedOut||signal?.aborted||error instanceof Error&&error.name==='TimeoutError'?'timeout':'unavailable');}
  finally{clearTimeout(deadline);signal?.removeEventListener('abort',abort);await browser.close().catch(()=>{});}
}
