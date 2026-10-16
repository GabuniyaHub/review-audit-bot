import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { Settings, SETTINGS } from '../config/settings.js';
import { CollectionError, NormalizedReview, REVIEW_COLLECTOR, ReviewCollector } from './types.js';
const messages:Record<string,string>={captcha:'площадка запросила проверку CAPTCHA',rate_limited:'площадка ограничила частоту запросов',forbidden:'площадка отклонила доступ',timeout:'истекло время ожидания',layout_changed:'изменился формат данных площадки',unavailable:'источник временно недоступен',invalid_data:'часть данных имеет неверный формат',not_configured:'источник ещё не подключён'};
@Injectable()
export class CollectionService {
  constructor(@Inject(DatabaseService) private readonly database:DatabaseService,
    @Inject(SETTINGS) private readonly settings:Settings,
    @Inject(REVIEW_COLLECTOR) private readonly collector:ReviewCollector) {}
  async processNext(signal?:AbortSignal):Promise<boolean> {
    if(!this.settings.collectionEnabled||signal?.aborted)return false;
    const job=await this.claim();if(!job)return false;
    try {
      if(job.match_status!=='verified')throw new CollectionError('invalid_data');
      let invalid=false;let stopReason:'limit'|'exhausted'='exhausted';let gotPage=false;let terminal=false;
      for await(const page of this.collector.pages({source:job.source,externalId:job.external_id,url:job.url,maxReviews:job.max_reviews},signal)) {
        gotPage=true;if(signal?.aborted)throw new CollectionError('timeout');
        await this.savePage(job,page.reviews,page.page,page.invalidCount);
        invalid ||= page.invalidCount>0;
        if(page.stopReason){stopReason=page.stopReason;terminal=true;}
      }
      if(!gotPage||!terminal)throw new CollectionError('layout_changed');
      await this.finish(job,invalid||stopReason==='limit'?'partial':'completed',invalid?'invalid_data':null,stopReason);
    } catch(error) {
      const problem=error instanceof CollectionError?error:new CollectionError('unavailable');
      const retry=['timeout','unavailable','rate_limited'].includes(problem.code)&&job.attempts<3;
      if(retry) {
        const seconds=Math.min(86400,Math.max(2**job.attempts,problem.retryAfter));
        await this.database.pool.query("UPDATE collection_runs SET status='pending',error_code=$3,next_attempt_at=now()+($4::integer*interval '1 second'),lease_until=NULL,worker_token=NULL WHERE id=$1 AND worker_token=$2",[job.id,job.worker_token,problem.code,seconds]);
      } else await this.finish(job,'failed',problem.code,'error');
    }
    return true;
  }
  private async claim():Promise<any|undefined> {
    const db=await this.database.pool.connect();
    try {
      await db.query('BEGIN');
      // Exhausted leases become explicit terminal failures rather than stuck running jobs.
      const abandoned=await db.query("UPDATE collection_runs SET status=CASE WHEN collected_count>0 THEN 'partial' ELSE 'failed' END,error_code='timeout',stop_reason='error',finished_at=now(),worker_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<now() AND attempts>=3 RETURNING *");
      for(const row of abandoned.rows)await this.notify(db,row);
      const selected=await db.query("SELECT cr.*,sc.source,sc.external_id,sc.url,sc.match_status FROM collection_runs cr JOIN source_cards sc ON sc.id=cr.source_card_id AND sc.project_id=cr.project_id WHERE ((cr.status='pending' AND cr.next_attempt_at<=now()) OR (cr.status='running' AND cr.lease_until<now())) AND cr.attempts<3 ORDER BY cr.id FOR UPDATE OF cr SKIP LOCKED LIMIT 1");
      const row=selected.rows[0];
      if(row) {row.worker_token=randomUUID();row.attempts++;
        await db.query("UPDATE collection_runs SET status='running',started_at=COALESCE(started_at,now()),finished_at=NULL,error_code=NULL,attempts=$2,worker_token=$3,lease_until=now()+interval '5 minutes' WHERE id=$1",[row.id,row.attempts,row.worker_token]);}
      await db.query('COMMIT');return row;
    }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  }
  private async savePage(job:any,reviews:NormalizedReview[],page:number,invalidCount:number):Promise<void> {
    const db=await this.database.pool.connect();
    try {
      await db.query('BEGIN');
      const owned=await db.query("UPDATE collection_runs SET lease_until=now()+interval '5 minutes',pages_fetched=GREATEST(pages_fetched,$3),invalid_count=invalid_count+$4 WHERE id=$1 AND worker_token=$2 AND status='running' RETURNING id",[job.id,job.worker_token,page,invalidCount]);
      if(!owned.rowCount)throw new CollectionError('timeout');
      for(const review of reviews) {
        const existing=(await db.query('SELECT id,content_hash FROM reviews WHERE source_card_id=$1 AND dedup_key=$2 FOR UPDATE',[job.source_card_id,review.dedupKey])).rows[0];
        const change=!existing?'inserted':existing.content_hash!==review.contentHash?'updated':'unchanged';
        const saved=await db.query(`INSERT INTO reviews(project_id,source_card_id,external_id,dedup_key,text,rating,published_at,updated_at_source,raw_date,source_url,content_hash,text_fingerprint)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          ON CONFLICT(source_card_id,dedup_key) DO UPDATE SET text=EXCLUDED.text,rating=EXCLUDED.rating,
          published_at=EXCLUDED.published_at,updated_at_source=EXCLUDED.updated_at_source,raw_date=EXCLUDED.raw_date,
          source_url=EXCLUDED.source_url,content_hash=EXCLUDED.content_hash,text_fingerprint=EXCLUDED.text_fingerprint,collected_at=now()
          RETURNING id`,[job.project_id,job.source_card_id,review.externalId,review.dedupKey,review.text,review.rating,review.publishedAt,review.updatedAtSource,review.rawDate,review.sourceUrl,review.contentHash,review.textFingerprint]);
        await db.query(`INSERT INTO collection_run_items(collection_run_id,project_id,review_id,change_type) VALUES($1,$2,$3,$4)
          ON CONFLICT(collection_run_id,review_id) DO UPDATE SET change_type=CASE WHEN collection_run_items.change_type='inserted' OR EXCLUDED.change_type='inserted' THEN 'inserted' WHEN collection_run_items.change_type='updated' OR EXCLUDED.change_type='updated' THEN 'updated' ELSE 'unchanged' END`,[job.id,job.project_id,saved.rows[0].id,change]);
      }
      await db.query("UPDATE collection_runs SET collected_count=(SELECT count(*) FROM collection_run_items WHERE collection_run_id=$1),lease_until=clock_timestamp()+interval '5 minutes' WHERE id=$1",[job.id]);
      await db.query('COMMIT');
    }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  }
  private async finish(job:any,status:string,errorCode:string|null,stopReason:string):Promise<void> {
    const db=await this.database.pool.connect();
    try {
      await db.query('BEGIN');
      const result=await db.query("UPDATE collection_runs SET status=CASE WHEN $3='failed' AND collected_count>0 THEN 'partial' ELSE $3 END,error_code=$4,stop_reason=$5,finished_at=now(),worker_token=NULL,lease_until=NULL WHERE id=$1 AND worker_token=$2 AND status='running' RETURNING *",[job.id,job.worker_token,status,errorCode,stopReason]);
      if(result.rows[0])await this.notify(db,result.rows[0]);
      await db.query('COMMIT');
    }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  }
  private async notify(db:PoolClient,run:any):Promise<void> {
    if(!run.notify_bot_id||!run.notify_chat_id)return;
    const card=(await db.query('SELECT sc.source,o.name FROM source_cards sc JOIN organizations o ON sc.organization_id=o.id WHERE sc.id=$1',[run.source_card_id])).rows[0];
    const text=`Сбор отзывов: ${card.name}, ${card.source==='2gis'?'2ГИС':'Яндекс.Карты'}. Сохранено в этом сборе: ${run.collected_count}. ${run.error_code?messages[run.error_code]+'.':run.stop_reason==='limit'?'Достигнут лимит выборки; это не все отзывы площадки.':'Доступные страницы обработаны.'} /status — подробности.`;
    await db.query('INSERT INTO telegram_outbox(bot_id,chat_id,text,collection_run_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[run.notify_bot_id,run.notify_chat_id,text,run.id]);
  }
}
