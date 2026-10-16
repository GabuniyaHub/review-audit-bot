import { TelegramUpdate } from './types.js';
export class TelegramApiError extends Error {
  constructor(readonly code:number,readonly retryAfter=5) {super('Telegram API request failed');}
}
export interface TelegramApi {
  call<T>(method:string,payload:Record<string,unknown>,signal?:AbortSignal):Promise<T>;
}
export class HttpTelegramApi implements TelegramApi {
  constructor(private readonly token:string, private readonly request:typeof fetch=fetch) {}
  async call<T>(method:string,payload:Record<string,unknown>,signal?:AbortSignal):Promise<T> {
    try {
      let body: string|FormData=JSON.stringify(payload);let headers:Record<string,string>|undefined={'Content-Type':'application/json'};
      if(method==='sendDocument'){
        if(typeof payload.document!=='string'||typeof payload.filename!=='string'||!/^audit-[0-9]+\.md$/.test(payload.filename))throw new TelegramApiError(400);
        const form=new FormData();form.set('chat_id',String(payload.chat_id));form.set('caption',String(payload.caption??'').slice(0,1024));form.set('document',new Blob([payload.document],{type:'text/markdown;charset=utf-8'}),payload.filename);body=form;headers=undefined;
      }
      const response=await this.request(`https://api.telegram.org/bot${this.token}/${method}`,{method:'POST',headers,body,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(35000)});
      const responseBody=await response.json() as {ok:boolean;result:T;error_code?:number;parameters?:{retry_after?:number}};
      if(!response.ok||!responseBody.ok) throw new TelegramApiError(responseBody.error_code??response.status,responseBody.parameters?.retry_after);
      return responseBody.result;
    } catch(error) {
      if(error instanceof TelegramApiError) throw error;
      // fetch errors can contain the token-bearing URL; never propagate raw errors.
      throw new TelegramApiError(0);
    }
  }
}
export type TelegramUpdates = TelegramUpdate[];
