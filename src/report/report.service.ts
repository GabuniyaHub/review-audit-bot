import { PoolClient } from 'pg';
import { Settings } from '../config/settings.js';
import { PROMPT_VERSION, SCHEMA_VERSION } from '../analysis/contract.js';
import { hash } from '../collection/normalize.js';
import { buildReport, Period, REPORT_VERSION, Snapshot } from './report.js';
// Caller owns the transaction. No model calls or filesystem writes inside it.
export async function createReport(db:PoolClient,projectId:string,settings:Settings,period:Period){
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['report-project:'+projectId]);
 const active=await db.query("SELECT 1 FROM audit_runs WHERE project_id=$1 AND status IN ('pending','running') LIMIT 1",[projectId]);
 if(active.rowCount)return {message:'Аудит уже выполняется. Дождитесь завершения: /status.'};
 const data=(await db.query(`SELECT
 (SELECT COALESCE(jsonb_agg(x ORDER BY x.id),'[]') FROM (SELECT id::text,name,role,city,address FROM organizations WHERE project_id=$1)x) AS organizations,
 (SELECT COALESCE(jsonb_agg(x ORDER BY x.id),'[]') FROM (SELECT sc.id::text,sc.organization_id::text,sc.source,sc.url,sc.match_status,cr.status,cr.error_code,cr.stop_reason FROM source_cards sc LEFT JOIN LATERAL(SELECT status,error_code,stop_reason FROM collection_runs WHERE source_card_id=sc.id ORDER BY id DESC LIMIT 1)cr ON true WHERE sc.project_id=$1)x) AS cards,
 (SELECT COALESCE(jsonb_agg(x ORDER BY x.id),'[]') FROM (SELECT r.id::text,sc.organization_id::text,sc.source,r.source_url,sc.url AS card_url,r.content_hash,r.text,r.rating,r.published_at,r.collected_at,a.result FROM reviews r JOIN source_cards sc ON sc.id=r.source_card_id AND sc.project_id=r.project_id LEFT JOIN review_analyses a ON a.review_id=r.id AND a.project_id=r.project_id AND a.content_hash=r.content_hash AND a.model=$2 AND a.prompt_version=$3 AND a.schema_version=$4 WHERE r.project_id=$1)x) AS reviews`,[projectId,settings.llmModel,PROMPT_VERSION,SCHEMA_VERSION])).rows[0];
 for(const r of data.reviews){if(r.published_at)r.published_at=new Date(r.published_at).toISOString();r.collected_at=new Date(r.collected_at).toISOString();}
 const snapshot:Snapshot={projectId,model:settings.llmModel,promptVersion:PROMPT_VERSION,schemaVersion:SCHEMA_VERSION,period,...data};
 const fingerprint=hash(JSON.stringify([REPORT_VERSION,snapshot]));
 const cached=(await db.query('SELECT id,summary,markdown,created_at FROM reports WHERE project_id=$1 AND input_hash=$2',[projectId,fingerprint])).rows[0];
 if(cached)return {report:cached,cached:true};
 const built=buildReport(snapshot);if(!built.eligible)return {message:'В выбранном периоде нет сохранённых отзывов. Пустой отчёт не создаётся. /collect — сбор; без дат /report включает отзывы с неизвестной датой.'};
 if(!built.metrics.analyzedTotal)return {message:'Для выбранной выборки нет актуальных проверенных анализов. Сначала /analyze. Пустой анализ не выдаётся за отчёт.'};
 const audit=(await db.query("INSERT INTO audit_runs(project_id,stage,status,model,prompt_version,schema_version,period_from,period_to,started_at,finished_at,analyzed_count) VALUES($1,'report',$2,$3,$4,$5,$6,$7,now(),now(),$8) RETURNING id",[projectId,built.partial?'partial':'completed',settings.llmModel,PROMPT_VERSION,SCHEMA_VERSION,period.from,period.to,built.metrics.analyzedTotal])).rows[0].id;
 const report=(await db.query('INSERT INTO reports(project_id,audit_run_id,summary,markdown,metrics,input_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,summary,markdown,created_at',[projectId,audit,built.summary,built.markdown,JSON.stringify(built.metrics),fingerprint])).rows[0];
 return {report,cached:false};
}
