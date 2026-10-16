import { CollectionError } from './types.js';
const HOSTS=['yandex.ru','yandex.com','public-api.reviews.2gis.com'];
export class SourceHttpClient {
  constructor(private readonly request:typeof fetch=fetch,private readonly timeoutMs=15000) {}
  async text(input:URL,signal?:AbortSignal):Promise<string> {
    const abort=new AbortController();
    const timer=setTimeout(()=>abort.abort(),this.timeoutMs);
    const combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
    try {
      let url=input;
      for(let redirects=0;redirects<4;redirects++) {
        if(url.protocol!=='https:'||url.username||url.password||url.port||!HOSTS.includes(url.hostname))throw new CollectionError('forbidden');
        if(url.pathname.includes('showcaptcha'))throw new CollectionError('captcha');
        const response=await this.request(url,{redirect:'manual',signal:combined,headers:{'User-Agent':'review-audit-bot-research/0.1','Accept':'text/html,application/json'}});
        if(response.status>=300&&response.status<400) {
          const location=response.headers.get('location');await response.body?.cancel();
          if(!location)throw new CollectionError('layout_changed');url=new URL(location,url);continue;
        }
        if(response.status===429) {await response.body?.cancel();throw new CollectionError('rate_limited',Math.min(86400,Math.max(1,Number(response.headers.get('retry-after'))||60)));}
        if(response.status===403) {await response.body?.cancel();throw new CollectionError('forbidden');}
        if(!response.ok) {await response.body?.cancel();throw new CollectionError('unavailable');}
        if(Number(response.headers.get('content-length'))>5_000_000) {await response.body?.cancel();throw new CollectionError('invalid_data');}
        const reader=response.body?.getReader();if(!reader)throw new CollectionError('invalid_data');
        const chunks:Uint8Array[]=[];let size=0;
        try {while(true) {const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>5_000_000) {await reader.cancel();throw new CollectionError('invalid_data');}chunks.push(next.value);}}
        finally {reader.releaseLock();}
        const text=Buffer.concat(chunks).toString('utf8');
        if(/<title[^>]*>\s*(?:Are you not a robot\?|Ой!|Подтвердите)/i.test(text)||/SmartCaptcha|CheckboxCaptcha/.test(text.slice(0,5000)))throw new CollectionError('captcha');
        return text;
      }
      throw new CollectionError('layout_changed');
    } catch(error) {
      if(error instanceof CollectionError)throw error;
      throw new CollectionError(combined.aborted?'timeout':'unavailable');
    } finally {clearTimeout(timer);}
  }
}
