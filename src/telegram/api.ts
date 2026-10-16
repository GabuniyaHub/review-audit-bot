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
      const response=await this.request(`https://api.telegram.org/bot${this.token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(35000)});
      const body=await response.json() as {ok:boolean;result:T;error_code?:number;parameters?:{retry_after?:number}};
      if(!response.ok||!body.ok) throw new TelegramApiError(body.error_code??response.status,body.parameters?.retry_after);
      return body.result;
    } catch(error) {
      if(error instanceof TelegramApiError) throw error;
      // fetch errors can contain the token-bearing URL; never propagate raw errors.
      throw new TelegramApiError(0);
    }
  }
}
export type TelegramUpdates = TelegramUpdate[];
