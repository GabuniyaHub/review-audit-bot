import { Settings } from '../config/settings.js';
import { AnalysisError, AnalysisInput, AnalysisResult, RESPONSE_SCHEMA, SYSTEM_PROMPT, validateResult } from './contract.js';
export const ANALYZER=Symbol('ANALYZER');
export interface Analyzer {analyze(inputs:AnalysisInput[],signal?:AbortSignal):Promise<AnalysisResult[]>}
export class OpenRouterAnalyzer implements Analyzer {
 constructor(private readonly settings:Settings,private readonly request:typeof fetch=fetch){}
 async analyze(inputs:AnalysisInput[],signal?:AbortSignal):Promise<AnalysisResult[]> {
  if(!this.settings.llmApiKey)throw new AnalysisError('not_configured');
  if(!inputs.length||inputs.length>10||inputs.some(i=>!i.text.trim()||i.text.length>12000))throw new AnalysisError('invalid_input');
  let response:Response;
  try{response=await this.request('https://openrouter.ai/api/v1/chat/completions',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${this.settings.llmApiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:this.settings.llmModel,messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:JSON.stringify({reviews:inputs.map(i=>({reviewId:i.id,text:i.text}))})}],response_format:{type:'json_schema',json_schema:{name:'review_analysis',strict:true,schema:RESPONSE_SCHEMA}},provider:{require_parameters:true},temperature:0,max_tokens:8192}),signal:AbortSignal.any([AbortSignal.timeout(this.settings.llmTimeoutMs),...(signal?[signal]:[])])});}catch{throw new AnalysisError(signal?.aborted?'cancelled':'unavailable');}
  if(!response.ok){await response.body?.cancel();throw new AnalysisError(response.status===429?'rate_limited':[401,403].includes(response.status)?'access_denied':response.status>=500?'unavailable':'request_rejected',Math.min(86400,Math.max(0,Number(response.headers.get('retry-after'))||0)));}
  // Bound response buffering; provider errors and raw review text never enter logs.
  const reader=response.body?.getReader();if(!reader)throw new AnalysisError('invalid_response');let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_000_000){await reader.cancel();throw new AnalysisError('invalid_response');}chunks.push(value);}}catch(e){if(e instanceof AnalysisError)throw e;throw new AnalysisError('unavailable');}
  try {const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data.choices?.[0]?.finish_reason!=='stop'||typeof data.choices?.[0]?.message?.content!=='string')throw new Error();return validateResult(JSON.parse(data.choices[0].message.content),inputs);}catch(e){if(e instanceof AnalysisError)throw e;throw new AnalysisError('invalid_response');}
 }
}
