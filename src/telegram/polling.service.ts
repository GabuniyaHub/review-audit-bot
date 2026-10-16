import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PoolClient } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { SETTINGS, Settings } from '../config/settings.js';
import { DatabaseService } from '../database/database.service.js';
import { BotService } from './bot.service.js';
import { HttpTelegramApi, TelegramApi, TelegramApiError } from './api.js';
import { TelegramUpdate } from './types.js';
export const TELEGRAM_API=Symbol('TELEGRAM_API');
@Injectable()
export class PollingService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger=new Logger(PollingService.name);
  private readonly abort=new AbortController();
  private running=false;
  isReady():boolean {return !this.settings.telegramEnabled || (this.running && !this.abort.signal.aborted);}
  private task?:Promise<void>; private lock?:PoolClient; private botId?:number;
  constructor(@Inject(SETTINGS) private readonly settings:Settings,
    @Inject(DatabaseService) private readonly database:DatabaseService,
    @Inject(BotService) private readonly bot:BotService,
    @Inject(TELEGRAM_API) private readonly api:TelegramApi) {}
  async onApplicationBootstrap():Promise<void> {
    if(!this.settings.telegramEnabled) return;
    if(!await this.database.ready()) throw new Error('Telegram requires a migrated database');
    const me=await this.api.call<{id:number;is_bot:boolean}>('getMe',{},this.abort.signal);
    if(!Number.isSafeInteger(me.id)||me.id<=0||!me.is_bot) throw new Error('Invalid Telegram bot identity');
    const webhook=await this.api.call<{url:string}>('getWebhookInfo',{},this.abort.signal);
    if(webhook.url) throw new Error('Telegram webhook is configured; disable it explicitly before using polling');
    this.botId=me.id;
    const lock=await this.database.pool.connect();
    try {
      const result=await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',['telegram-bot:'+me.id]);
      if(!result.rows[0].locked) throw new Error('This Telegram bot already has an active poller');
      this.lock=lock;
      lock.on('error',()=>{this.logger.error('Telegram poller database connection lost');this.abort.abort();});
      this.running=true;
      this.task=this.poll().catch(()=>this.logger.error('Telegram polling stopped; restart after checking configuration'));
    } catch(error) {lock.release(true);throw error;}
  }
  private async poll():Promise<void> {
    try {
      while(!this.abort.signal.aborted) {
        try {
          await this.flushOutbox();
          const state=await this.database.pool.query('SELECT next_offset FROM telegram_polling_state WHERE bot_id=$1',[this.botId]);
          const offset=Number(state.rows[0]?.next_offset??0);
          const updates=await this.api.call<TelegramUpdate[]>('getUpdates',{offset,timeout:25,limit:20,allowed_updates:['message']},this.abort.signal);
          if(!Array.isArray(updates)) throw new Error('Invalid update batch');
          for(const update of updates) {
            if(this.abort.signal.aborted) break;
            if(!Number.isSafeInteger(update.update_id)||update.update_id<0) throw new Error('Invalid update identifier');
            await this.bot.processUpdate(this.botId!,update);
            await this.database.pool.query('INSERT INTO telegram_polling_state(bot_id,next_offset) VALUES($1,$2) ON CONFLICT(bot_id) DO UPDATE SET next_offset=GREATEST(telegram_polling_state.next_offset,EXCLUDED.next_offset)',[this.botId,update.update_id+1]);
          }
          await this.flushOutbox();
        } catch(error) {
          if(this.abort.signal.aborted) break;
          if(error instanceof TelegramApiError && [401,409].includes(error.code)) throw error;
          this.logger.warn('Telegram update or delivery temporarily unavailable');
          const seconds=error instanceof TelegramApiError?Math.min(60,Math.max(1,error.retryAfter)):5;
          await delay(seconds*1000,undefined,{signal:this.abort.signal}).catch(()=>{});
        }
      }
    } finally {
      this.running=false;
      if(this.lock) {this.lock.release(true);this.lock=undefined;}
    }
  }
  async flushOutbox():Promise<void> {
    if(!this.botId) return;
    const messages=await this.database.pool.query("SELECT id,chat_id,text,attempts,next_attempt_at,document_text,document_filename FROM telegram_outbox WHERE bot_id=$1 AND status='pending' ORDER BY id LIMIT 20",[this.botId]);
    for(const row of messages.rows) {
      if(this.abort.signal.aborted || new Date(row.next_attempt_at).getTime()>Date.now()) break;
      try {
        if(row.document_text!==null)await this.api.call('sendDocument',{chat_id:row.chat_id,caption:row.text.slice(0,1024),document:row.document_text,filename:row.document_filename},this.abort.signal);
        else await this.api.call('sendMessage',{chat_id:row.chat_id,text:row.text,link_preview_options:{is_disabled:true}},this.abort.signal);
        await this.database.pool.query("UPDATE telegram_outbox SET status='sent',sent_at=now(),attempts=attempts+1 WHERE id=$1",[row.id]);
      } catch(error) {
        if(this.abort.signal.aborted) break;
        const permanent=error instanceof TelegramApiError && [400,403].includes(error.code);
        const attempts=row.attempts+1;
        const wait=error instanceof TelegramApiError && error.code===429?Math.min(86400,Math.max(1,error.retryAfter)):Math.min(300,2**attempts);
        await this.database.pool.query("UPDATE telegram_outbox SET attempts=$2,status=$3,next_attempt_at=now()+($4::integer * interval '1 second') WHERE id=$1",[row.id,attempts,permanent||attempts>=5?'failed':'pending',wait]);
        if(error instanceof TelegramApiError && error.code===401) throw error;
        // Preserve reply order and respect rate limits before sending anything else.
        break;
      }
    }
  }
  async beforeApplicationShutdown():Promise<void> {this.abort.abort();await this.task;}
}
export const telegramApiProvider={provide:TELEGRAM_API,inject:[SETTINGS],useFactory:(settings:Settings)=>new HttpTelegramApi(settings.telegramBotToken)};
