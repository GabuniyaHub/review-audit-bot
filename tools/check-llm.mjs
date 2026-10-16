// Synthetic text only: no customer data and no database connection.
import 'dotenv/config';
import { readSettings } from '../dist/src/config/settings.js';
import { OpenRouterAnalyzer } from '../dist/src/analysis/client.js';
const settings=readSettings();
const inputs=[{id:'check-1',text:'кофе вкусный, но заказ ждали сорок минут',contentHash:'0'.repeat(64)},{id:'check-2',text:'в помещении чисто, цены обычные',contentHash:'1'.repeat(64)}];
const started=Date.now();
try {const result=await new OpenRouterAnalyzer(settings).analyze(inputs);console.log(JSON.stringify({ok:true,model:settings.llmModel,elapsedMs:Date.now()-started,results:result},null,2));}
catch(e){console.error(JSON.stringify({ok:false,errorCode:e.code??'configuration_error',elapsedMs:Date.now()-started}));process.exitCode=1;}
