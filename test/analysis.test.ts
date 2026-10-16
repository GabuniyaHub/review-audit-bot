import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisInput, redact, validateResult } from '../src/analysis/contract.js';
import { OpenRouterAnalyzer } from '../src/analysis/client.js';
import { readSettings } from '../src/config/settings.js';
const settings=readSettings({DATABASE_URL:'postgresql://u:p@localhost/test',LLM_API_KEY:'secret-not-for-logs'});
const inputs:AnalysisInput[]=[{id:'17',text:'кофе вкусный, но долго ждали',contentHash:'a'.repeat(64)}];
const result={reviewId:'17',sentiment:'mixed',topics:[{topic:'product',sentiment:'positive',evidence:'кофе вкусный'},{topic:'waiting',sentiment:'negative',evidence:'долго ждали'}]};
test('analysis rejects fabricated IDs, quotes, duplicate themes, missing reviews and unexpected fields',()=>{
 assert.deepEqual(validateResult({reviews:[result]},inputs),[result]);
 for(const invalid of [{...result,reviewId:'18'},{...result,topics:[{...result.topics[0],evidence:'всё ужасно'}]},{...result,topics:[result.topics[0],result.topics[0]]},{...result,confidence:1},{...result,sentiment:'happy'}])assert.throws(()=>validateResult({reviews:[invalid]},inputs));
 assert.throws(()=>validateResult({reviews:[]},inputs));assert.throws(()=>validateResult({reviews:[result,result]},inputs));
});
test('PII masking removes names, contacts and links before analysis',()=>{
 const value=redact('Спасибо Анне и Ivan. почта user@example.com телефон +7 (999) 123-45-67 https://example.com @username');
 for(const privateText of ['Анне','Ivan','user@example.com','999','https://','@username'])assert.ok(!value.includes(privateText));
});
test('OpenRouter enforces JSON schema and sends only anonymous IDs and text',async()=>{
 let body:any;const client=new OpenRouterAnalyzer(settings,async(_url,options)=>{body=JSON.parse(String(options?.body));assert.equal(options?.redirect,'error');return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reviews:[result]})}}]}));});
 assert.deepEqual(await client.analyze(inputs),[result]);assert.equal(body.provider.require_parameters,true);assert.equal(body.response_format.type,'json_schema');assert.deepEqual(JSON.parse(body.messages[1].content).reviews,[{reviewId:'17',text:inputs[0].text}]);assert.ok(!body.messages[1].content.includes('contentHash'));
});
test('provider denial, rate limits and truncated JSON remain explicit sanitized errors',async()=>{
 for(const [status,code] of [[403,'access_denied'],[429,'rate_limited'],[503,'unavailable']] as const){const client=new OpenRouterAnalyzer(settings,async()=>new Response('secret-not-for-logs',{status,headers:{'retry-after':'60'}}));await assert.rejects(client.analyze(inputs),(e:any)=>e.code===code&&!e.message.includes('secret-not-for-logs'));}
 for(const response of [{choices:[{finish_reason:'length',message:{content:JSON.stringify({reviews:[result]})}}]},{choices:[{finish_reason:'stop',message:{content:'not JSON'}}]}])await assert.rejects(new OpenRouterAnalyzer(settings,async()=>new Response(JSON.stringify(response))).analyze(inputs),(e:any)=>e.code==='invalid_response');
});
test('analysis requires an opt-in key and validates batch limits without exposing values',()=>{
 assert.equal(settings.analysisEnabled,false);assert.throws(()=>readSettings({DATABASE_URL:'postgresql://u:p@localhost/test',ANALYSIS_ENABLED:'true'}),/LLM_API_KEY/);
 assert.throws(()=>readSettings({DATABASE_URL:'postgresql://u:p@localhost/test',ANALYSIS_BATCH_SIZE:'100'}),/ANALYSIS_BATCH_SIZE/);
});
