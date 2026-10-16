// Synthetic examples only. No Telegram polling or customer data.
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import 'dotenv/config';
import { readSettings } from '../dist/src/config/settings.js';
import { OpenRouterAnalyzer } from '../dist/src/analysis/client.js';
import { PROMPT_VERSION, SCHEMA_VERSION } from '../dist/src/analysis/contract.js';
import { buildReport, parsePeriod } from '../dist/src/report/report.js';
import { hash } from '../dist/src/collection/normalize.js';
const output=resolve(process.argv[2]??'data/demo-report');
let key=process.env.OPENROUTER_API_KEY||process.env.LLM_API_KEY;
if(process.argv.includes('--server-key')){
 const privateKey=process.env.DEMO_SSH_KEY;if(!privateKey)throw new Error('Set DEMO_SSH_KEY to an existing authorized local key path');
 const remote=`cd /opt/review-audit-bot && node --input-type=module -e 'import fs from "node:fs";import {parse} from "dotenv";const e=parse(fs.readFileSync(".env"));process.stdout.write((e.OPENROUTER_API_KEY||e.LLM_API_KEY||"").trim());'`;
 key=execFileSync('ssh',['-i',privateKey,'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','ConnectTimeout=15','root@191.44.47.253',remote],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim();
}
if(!key)throw new Error('Set an OpenRouter key privately');
const settings=readSettings({DATABASE_URL:'postgresql://unused:unused@localhost/unused',LLM_API_KEY:key,LLM_TIMEOUT_MS:'120000'});
const texts=['кофе вкусный, но заказ ждали сорок минут','столы грязные, персонал грубит и не объясняет доплату','кофе вкусный, заказ принесли быстро','в зале чисто и тихо, цены обычные','напиток холодный, зато персонал вежливый','ожидание короткое, но цены высокие','вкусные десерты и приветливый персонал','шумно, тесно, долго ждали заказ'];
const organizations=['А','Б','В','Г'].map((name,i)=>({id:String(i+1),name:'Демо-кофейня '+name,role:i===0?'own':'competitor',city:'Тюмень (демонстрация)',address:'Вымышленный пример'}));
const inputs=texts.map((text,i)=>({id:String(i+1),text,contentHash:hash(text)}));
const start=Date.now();
try{
 const analyses=await new OpenRouterAnalyzer(settings).analyze(inputs);
 const now=new Date().toISOString();const snapshot={projectId:'demo',model:settings.llmModel,promptVersion:PROMPT_VERSION,schemaVersion:SCHEMA_VERSION,period:parsePeriod('/report 2026-10-01 2026-10-16'),organizations,cards:organizations.map(o=>({id:o.id,organization_id:o.id,source:'yandex',url:'',match_status:'unverified',status:null,error_code:null,stop_reason:null})),reviews:inputs.map((r,i)=>({id:r.id,organization_id:String(Math.floor(i/2)+1),source:'yandex',source_url:null,card_url:'',content_hash:r.contentHash,text:r.text,rating:[4,1,5,5,3,3,5,2][i],published_at:'2026-10-01T12:00:00.000Z',collected_at:now,result:analyses.find(a=>a.reviewId===r.id)}))};
 const report=buildReport(snapshot);const banner='> ДЕМОНСТРАЦИЯ. Компании и отзывы вымышлены. Анализ выполнен реальной моделью OpenRouter. Это проверка работы программы, не аудит реальных кофеен. Ссылки на реальные отзывы отсутствуют.\n\n';
 await mkdir(output,{recursive:true});await writeFile(join(output,'report.md'),banner+report.markdown);await writeFile(join(output,'metrics.json'),JSON.stringify({provenance:'synthetic-texts-live-llm',elapsedMs:Date.now()-start,...report.metrics},null,2)+'\n');await writeFile(join(output,'analysis.json'),JSON.stringify({provenance:'synthetic-texts-live-llm',inputs,analyses},null,2)+'\n');console.log(JSON.stringify({ok:true,syntheticReviews:inputs.length,analyses:analyses.length,recommendations:report.metrics.recommendations.length,elapsedMs:Date.now()-start,output}));
}catch(e){console.error(JSON.stringify({ok:false,errorCode:e.code??'unavailable'}));process.exitCode=1;}
