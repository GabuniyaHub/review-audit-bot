import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { Settings, SETTINGS } from '../config/settings.js';
import { ANALYZER, Analyzer } from './client.js';
import { AnalysisError, AnalysisInput, PROMPT_VERSION, SCHEMA_VERSION, redact, validateResult } from './contract.js';
@Injectable()
export class AnalysisService {
 constructor(@Inject(DatabaseService) private readonly db:DatabaseService,@Inject(SETTINGS) private readonly settings:Settings,@Inject(ANALYZER) private readonly analyzer:Analyzer){}
 async processNext(signal?:AbortSignal):Promise<boolean>{
  if(!this.settings.analysisEnabled||signal?.aborted)return false;
  const conn=await this.db.pool.connect();let job:any;
  try{await conn.query('BEGIN');
   const expired=await conn.query("UPDATE audit_runs SET status=CASE WHEN analyzed_count>0 THEN 'partial' ELSE 'failed' END,error_code='timeout',finished_at=now(),worker_token=NULL,lease_until=NULL WHERE stage='analysis' AND status='running' AND lease_until<now() AND attempts>=3 RETURNING *");
   for(const row of expired.rows)await this.notify(conn,row);
   job=(await conn.query("SELECT * FROM audit_runs WHERE stage='analysis' AND ((status='pending' AND next_attempt_at<=now()) OR (status='running' AND lease_until<now())) AND attempts<3 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
   if(job){job.worker_token=randomUUID();job.attempts++;await conn.query("UPDATE audit_runs SET status='running',started_at=COALESCE(started_at,now()),attempts=$2,worker_token=$3,lease_until=now()+interval '3 minutes' WHERE id=$1",[job.id,job.attempts,job.worker_token]);}
   await conn.query('COMMIT');
  }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
  if(!job)return false;
  try{
   if(job.model!==this.settings.llmModel||job.prompt_version!==PROMPT_VERSION||job.schema_version!==SCHEMA_VERSION)throw new AnalysisError('version_changed');
   while(!signal?.aborted){
    const rows=(await this.db.pool.query(`SELECT r.id,r.text,r.content_hash FROM analysis_run_items i JOIN reviews r ON r.id=i.review_id AND r.project_id=i.project_id AND r.content_hash=i.content_hash
     WHERE i.audit_run_id=$1 AND NOT EXISTS(SELECT 1 FROM review_analyses a WHERE a.review_id=r.id AND a.content_hash=r.content_hash AND a.model=$2 AND a.prompt_version=$3 AND a.schema_version=$4) ORDER BY r.id LIMIT $5`,[job.id,job.model,PROMPT_VERSION,SCHEMA_VERSION,this.settings.analysisBatchSize])).rows;
    if(!rows.length)break;
    const inputs:AnalysisInput[]=rows.map(r=>({id:r.id,text:redact(r.text),contentHash:r.content_hash}));
    const results=validateResult({reviews:await this.analyzer.analyze(inputs,signal)},inputs);
    const tx=await this.db.pool.connect();try{await tx.query('BEGIN');
     const owned=await tx.query("UPDATE audit_runs SET lease_until=now()+interval '3 minutes' WHERE id=$1 AND worker_token=$2 AND status='running' RETURNING id",[job.id,job.worker_token]);if(!owned.rowCount)throw new AnalysisError('lease_lost');
     for(const result of results){const input=inputs.find(i=>i.id===result.reviewId)!;
      await tx.query(`INSERT INTO review_analyses(project_id,review_id,content_hash,model,prompt_version,schema_version,result) SELECT project_id,id,content_hash,$4,$5,$6,$7::jsonb FROM reviews WHERE id=$1 AND project_id=$2 AND content_hash=$3 ON CONFLICT DO NOTHING`,[input.id,job.project_id,input.contentHash,job.model,PROMPT_VERSION,SCHEMA_VERSION,JSON.stringify(result)]);}
     await tx.query(`UPDATE audit_runs SET analyzed_count=(SELECT count(*) FROM analysis_run_items i JOIN review_analyses a ON a.review_id=i.review_id AND a.content_hash=i.content_hash AND a.model=$2 AND a.prompt_version=$3 AND a.schema_version=$4 WHERE i.audit_run_id=$1) WHERE id=$1`,[job.id,job.model,PROMPT_VERSION,SCHEMA_VERSION]);await tx.query('COMMIT');
    }catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
   }
   if(signal?.aborted)throw new AnalysisError('cancelled');
   const changed=await this.db.pool.query('SELECT 1 FROM analysis_run_items i JOIN reviews r ON r.id=i.review_id WHERE i.audit_run_id=$1 AND r.content_hash<>i.content_hash LIMIT 1',[job.id]);
   await this.finish(job,changed.rowCount?'partial':'completed',changed.rowCount?'reviews_changed':null);
  }catch(e){const error=e instanceof AnalysisError?e:new AnalysisError('unavailable');
   if(['unavailable','rate_limited','cancelled'].includes(error.code)&&job.attempts<3){await this.db.pool.query("UPDATE audit_runs SET status='pending',error_code=$3,next_attempt_at=now()+($4::int*interval '1 second'),worker_token=NULL,lease_until=NULL WHERE id=$1 AND worker_token=$2",[job.id,job.worker_token,error.code,Math.max(10*2**job.attempts,error.retryAfter)]);}
   else await this.finish(job,'failed',error.code);
  }return true;
 }
 private async finish(job:any,status:string,error:string|null){const tx=await this.db.pool.connect();try{await tx.query('BEGIN');const r=await tx.query("UPDATE audit_runs SET status=CASE WHEN $3='failed' AND analyzed_count>0 THEN 'partial' ELSE $3 END,error_code=$4,finished_at=now(),worker_token=NULL,lease_until=NULL WHERE id=$1 AND worker_token=$2 AND status='running' RETURNING *",[job.id,job.worker_token,status,error]);if(r.rows[0])await this.notify(tx,r.rows[0]);await tx.query('COMMIT');}catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}}
 private async notify(tx:import('pg').PoolClient,job:any){if(!job.notify_bot_id||!job.notify_chat_id)return;await tx.query('INSERT INTO telegram_outbox(bot_id,chat_id,text,audit_run_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[job.notify_bot_id,job.notify_chat_id,`Анализ отзывов: ${job.status==='completed'?'завершён':job.status==='partial'?'частичный результат':'ошибка'}. Обработано: ${job.analyzed_count}.${job.error_code?' Причина: '+job.error_code+'.':''} /status — состояние. /report — сравнение и файл отчёта.`,job.id]);}
}
