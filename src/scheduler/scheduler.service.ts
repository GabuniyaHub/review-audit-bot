import {Inject,Injectable} from '@nestjs/common';
import {PoolClient} from 'pg';
import {DatabaseService} from '../database/database.service.js';
import {Settings,SETTINGS} from '../config/settings.js';
import {enqueueAnalysis} from '../analysis/enqueue.js';
import {createReport} from '../report/report.service.js';
import {incident} from './incidents.js';
import {localDay,nextDaily} from './time.js';
type Issue={resource:string;code:string;label:string};
const ERROR_LABELS:Record<string,string>={captcha:'площадка запросила CAPTCHA',forbidden:'площадка отклонила доступ',rate_limited:'достигнут лимит запросов',timeout:'истекло время ожидания',unavailable:'сервис временно недоступен',invalid_data:'ошибка данных',layout_changed:'изменился формат площадки',not_configured:'источник не подключён',access_denied:'LLM отклонила доступ',request_rejected:'LLM отклонила запрос',invalid_response:'ответ LLM не прошёл проверку',version_changed:'изменилась версия анализа',reviews_changed:'отзывы изменились во время анализа',no_fresh_reviews:'свежая выборка не получена',no_verified_sources:'нужно подтвердить карточки',report_unavailable:'недостаточно данных для отчёта',missing_analysis:'анализ недоступен'};
@Injectable()
export class SchedulerService {
 constructor(@Inject(DatabaseService)private readonly database:DatabaseService,@Inject(SETTINGS)private readonly settings:Settings){}
 async tick(now=new Date()):Promise<void>{
  if(!this.settings.schedulerEnabled)return;
  await this.transaction(async db=>{
   const due=(await db.query(`SELECT s.* FROM project_schedules s JOIN telegram_profiles p ON p.project_id=s.project_id WHERE s.enabled AND s.next_run_at<=$1 AND s.next_attempt_at<=$1 ORDER BY s.project_id FOR UPDATE OF s SKIP LOCKED LIMIT 20`,[now])).rows;
   for(const s of due){if(!await this.lock(db,s.project_id))continue;
    const busy=await db.query(`SELECT 1 FROM scheduled_runs WHERE project_id=$1 AND status='running' UNION ALL SELECT 1 FROM audit_runs WHERE project_id=$1 AND status IN ('pending','running') UNION ALL SELECT 1 FROM collection_runs WHERE project_id=$1 AND status IN ('pending','running') LIMIT 1`,[s.project_id]);
    if(busy.rowCount){await db.query("UPDATE project_schedules SET next_attempt_at=$2::timestamptz+interval '1 minute' WHERE project_id=$1",[s.project_id,now]);continue;}
    const run=(await db.query('INSERT INTO scheduled_runs(project_id,slot_at,bot_id,chat_id,started_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',[s.project_id,s.next_run_at,s.bot_id,s.chat_id,now])).rows[0];
    if(run){const cards=(await db.query("SELECT id FROM source_cards WHERE project_id=$1 AND match_status='verified' ORDER BY id",[s.project_id])).rows;
     for(const c of cards){const child=(await db.query('INSERT INTO collection_runs(project_id,source_card_id,max_reviews) VALUES($1,$2,$3) RETURNING id',[s.project_id,c.id,this.settings.collectionMaxReviews])).rows[0];await db.query('INSERT INTO scheduled_collections(scheduled_run_id,project_id,collection_run_id) VALUES($1,$2,$3)',[run.id,s.project_id,child.id]);}
    }
    // One catch-up run after sleep; do not replay every missed day or DST hour.
    const next=nextDaily(now,s.daily_time,s.time_zone,localDay(now,s.time_zone));
    await db.query('UPDATE project_schedules SET next_run_at=$2,next_attempt_at=$2 WHERE project_id=$1',[s.project_id,next]);
   }
  });
  await this.transaction(async db=>{
   const runs=(await db.query("SELECT * FROM scheduled_runs WHERE status='running' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 20")).rows;
   for(const run of runs){if(!await this.lock(db,run.project_id))continue;
    const current=await db.query('SELECT 1 FROM telegram_profiles WHERE project_id=$1',[run.project_id]);
    if(!current.rowCount){await this.cancelChildren(db,run);run.issues=[{resource:'project',code:'settings_changed',label:'Настройки компании изменены'}];await this.finish(db,run,null,'failed',false);continue;}
    if(now.getTime()-new Date(run.started_at).getTime()>this.settings.schedulerRunTimeoutMinutes*60000){await this.cancelChildren(db,run);run.issues=[...run.issues,{resource:'pipeline',code:'timeout',label:'Превышено время автообновления'}];await this.finish(db,run,null,'failed');continue;}
    if(run.phase==='collection'){
     const children=(await db.query(`SELECT c.*,sc.source,o.name FROM scheduled_collections l JOIN collection_runs c ON c.id=l.collection_run_id JOIN source_cards sc ON sc.id=c.source_card_id JOIN organizations o ON o.id=sc.organization_id WHERE l.scheduled_run_id=$1 ORDER BY c.id`,[run.id])).rows;
     if(children.some(c=>['pending','running'].includes(c.status)))continue;
     run.issues=[];
     for(const c of children){const resource='collection:'+c.source_card_id,label=`${c.name}, ${c.source==='2gis'?'2ГИС':'Яндекс.Карты'}`;
      if(c.error_code)run.issues.push({resource,code:c.error_code,label});
      else {const state=await incident(db,run.project_id,resource,null);if(state.recovered)run.issues.push({resource:'recovery:'+resource,code:'recovered',label:label+' — доступ восстановлен'});}
     }
     if(!children.length||!children.some(c=>Number(c.collected_count)>0)){run.issues.push({resource:'collection',code:children.length?'no_fresh_reviews':'no_verified_sources',label:children.length?'Свежая выборка не получена':'Нет подтверждённых карточек'});await this.finish(db,run,null,'failed');continue;}
     await incident(db,run.project_id,'collection',null);
     const analysis=await enqueueAnalysis(db,run.project_id,this.settings);
     if(analysis.count&&!analysis.id)continue;
     run.analysis_run_id=analysis.id;run.phase=analysis.id?'analysis':'report';
     await db.query('UPDATE scheduled_runs SET phase=$2,analysis_run_id=$3,issues=$4 WHERE id=$1',[run.id,run.phase,analysis.id,JSON.stringify(run.issues)]);
    }
    if(run.phase==='analysis'){
     const a=(await db.query('SELECT status,error_code FROM audit_runs WHERE id=$1',[run.analysis_run_id])).rows[0];
     if(a&&['pending','running'].includes(a.status))continue;
     if(!a||a.error_code)run.issues.push({resource:'analysis',code:a?.error_code??'missing_analysis',label:'Анализ отзывов'});
     else {const state=await incident(db,run.project_id,'analysis',null);if(state.recovered)run.issues.push({resource:'recovery:analysis',code:'recovered',label:'Доступ к анализу восстановлен'});}
     run.phase='report';await db.query("UPDATE scheduled_runs SET phase='report',issues=$2 WHERE id=$1",[run.id,JSON.stringify(run.issues)]);
    }
    if(run.phase==='report'){
     const result=await createReport(db,run.project_id,this.settings,{from:null,to:null});
     if(result.report){const reportState=(await db.query('SELECT a.status FROM audit_runs a JOIN reports r ON r.audit_run_id=a.id WHERE r.id=$1',[result.report.id])).rows[0]?.status;const partial=reportState==='partial'||run.issues.some((i:Issue)=>i.code!=='recovered');await this.finish(db,run,result.report,partial?'partial':'completed');}
     else {run.issues.push({resource:'report',code:'report_unavailable',label:result.message??'Отчёт не сформирован'});await this.finish(db,run,null,'failed');}
    }
   }
  });
 }
 private async lock(db:PoolClient,id:string){return (await db.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',['pipeline-project:'+id])).rows[0].locked;}
 private async transaction(fn:(db:PoolClient)=>Promise<void>){const db=await this.database.pool.connect();try{await db.query('BEGIN');await fn(db);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 private async cancelChildren(db:PoolClient,run:any){
  await db.query("UPDATE collection_runs SET status=CASE WHEN collected_count>0 THEN 'partial' ELSE 'failed' END,error_code='timeout',stop_reason='error',finished_at=now(),worker_token=NULL,lease_until=NULL WHERE id IN(SELECT collection_run_id FROM scheduled_collections WHERE scheduled_run_id=$1) AND status IN ('pending','running')",[run.id]);
  await db.query("UPDATE audit_runs SET status=CASE WHEN analyzed_count>0 THEN 'partial' ELSE 'failed' END,error_code='timeout',finished_at=now(),worker_token=NULL,lease_until=NULL WHERE id=$1 AND status IN ('pending','running')",[run.analysis_run_id]);
 }
 private async finish(db:PoolClient,run:any,report:any,status:string,notify=true){
  const notices:string[]=[];
  for(const i of run.issues as Issue[]){if(i.code==='recovered'){notices.push(i.label);continue;}const state=await incident(db,run.project_id,i.resource,i.code);if(state.changed)notices.push(i.label+': '+(ERROR_LABELS[i.code]??'этап не завершён'));}
  if(report){await incident(db,run.project_id,'report',null);if(!run.issues.some((i:Issue)=>i.resource==='analysis')){const recovery=await incident(db,run.project_id,'analysis',null);if(recovery.recovered)notices.push('Доступ к анализу восстановлен');}}
  await db.query('UPDATE scheduled_runs SET status=$2,report_id=$3,issues=$4,error_code=$5,finished_at=now() WHERE id=$1',[run.id,status,report?.id??null,JSON.stringify(run.issues),run.issues.find((i:Issue)=>i.code!=='recovered')?.code??null]);
  if(!notify||(!report&&!notices.length))return;
  const text=`Автообновление: ${report?'отчёт готов':'не завершено'}.\n${notices.join('\n')}\n${report?.summary??'/status — подробности.'}`.slice(0,report?1000:3500);
  await db.query('INSERT INTO telegram_outbox(bot_id,chat_id,text,scheduled_run_id,document_text,document_filename) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[run.bot_id,run.chat_id,text,run.id,report?.markdown??null,report?`audit-${report.id}.md`:null]);
 }
}
