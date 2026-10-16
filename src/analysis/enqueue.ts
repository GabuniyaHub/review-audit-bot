import {PoolClient} from 'pg';
import {Settings} from '../config/settings.js';
import {PROMPT_VERSION,SCHEMA_VERSION} from './contract.js';
export async function enqueueAnalysis(db:PoolClient,project:string,settings:Settings,botId:number|null=null,chatId:number|null=null){
 const rows=(await db.query(`SELECT r.id,r.content_hash FROM reviews r WHERE r.project_id=$1 AND length(trim(r.text))>0 AND length(r.text)<=12000 AND NOT EXISTS(SELECT 1 FROM review_analyses a WHERE a.review_id=r.id AND a.content_hash=r.content_hash AND a.model=$2 AND a.prompt_version=$3 AND a.schema_version=$4) ORDER BY r.id LIMIT 1000`,[project,settings.llmModel,PROMPT_VERSION,SCHEMA_VERSION])).rows;
 if(!rows.length)return {id:null,count:0};
 const run=(await db.query("INSERT INTO audit_runs(project_id,stage,model,prompt_version,schema_version,notify_bot_id,notify_chat_id) VALUES($1,'analysis',$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id",[project,settings.llmModel,PROMPT_VERSION,SCHEMA_VERSION,botId,chatId])).rows[0];
 if(!run)return {id:null,count:rows.length};
 for(const row of rows)await db.query('INSERT INTO analysis_run_items(audit_run_id,project_id,review_id,content_hash) VALUES($1,$2,$3,$4)',[run.id,project,row.id,row.content_hash]);
 return {id:run.id as string,count:rows.length};
}
