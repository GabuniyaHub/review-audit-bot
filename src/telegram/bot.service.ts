import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import { advance, prompt, Step } from './dialog.js';
import { SetupDraft, TelegramUpdate } from './types.js';
const HELP='/setup — настроить компанию и до трёх конкурентов\n/settings — посмотреть сохранённые настройки\n/status — состояние аудита\n/report — последний отчёт\n/resume — продолжить настройку\n/cancel — отменить черновик\n/help — справка';
@Injectable()
export class BotService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async processUpdate(botId: number, update: TelegramUpdate): Promise<void> {
    if(!Number.isSafeInteger(botId)||botId<=0||!Number.isSafeInteger(update.update_id)||update.update_id<0) return;
    const client=await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted=await client.query('INSERT INTO telegram_updates(bot_id,update_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING update_id',[botId,update.update_id]);
      if(!inserted.rowCount) {await client.query('COMMIT');return;}
      const message=update.message;
      // Only direct user messages may read or change that user's project.
      if(message?.chat.type==='private' && Number.isSafeInteger(message.from?.id) && message.from!.id>0 && message.chat.id===message.from!.id && !message.from!.is_bot) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['telegram-user:'+message.from!.id]);
        const user=(await client.query('INSERT INTO users(telegram_user_id) VALUES($1) ON CONFLICT(telegram_user_id) DO UPDATE SET telegram_user_id=EXCLUDED.telegram_user_id RETURNING id',[message.from!.id])).rows[0].id;
        const reply=await this.respond(client,user,message.text);
        await client.query('INSERT INTO telegram_outbox(bot_id,update_id,chat_id,text) VALUES($1,$2,$3,$4)',[botId,update.update_id,message.chat.id,reply]);
      }
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK');throw error;}
    finally {client.release();}
  }
  private async respond(db:PoolClient,user:string,raw?:string):Promise<string> {
    if(typeof raw!=='string') return 'Пока поддерживаются текстовые сообщения. /help — команды.';
    const text=raw.trim();
    if(text.length>4096) return 'Слишком длинное сообщение. Отправьте короткий ответ.';
    const session=(await db.query('SELECT step,payload FROM telegram_sessions WHERE user_id=$1',[user])).rows[0] as {step:Step;payload:SetupDraft}|undefined;
    if(text==='/start') return 'Я помогу сравнить репутацию вашей компании с конкурентами.\n'+HELP+(session?'\nУ вас есть черновик: /resume.':'');
    if(text==='/help') return HELP;
    if(text==='/cancel') {await db.query('DELETE FROM telegram_sessions WHERE user_id=$1',[user]);return 'Черновик отменён. Сохранённые настройки не изменены. /setup — начать заново.';}
    if(text==='/setup') {
      if(session) return 'Есть незавершённая настройка. /resume — продолжить, /cancel — отменить её перед новой.';
      const draft:SetupDraft={organizations:[],current:{cards:[]}};
      await db.query('INSERT INTO telegram_sessions(user_id,step,payload) VALUES($1,$2,$3)',[user,'name',draft]);return prompt('name',draft);
    }
    if(text==='/resume') return session?prompt(session.step,session.payload):'Черновика нет. /setup — настроить компанию.';
    const profile=(await db.query('SELECT p.id FROM audit_projects p JOIN telegram_profiles tp ON tp.project_id=p.id AND tp.user_id=p.user_id WHERE p.user_id=$1',[user])).rows[0];
    if(text==='/settings') {
      if(!profile) return 'Сохранённых настроек нет. /setup — начать.';
      const organizations=(await db.query('SELECT id,role,name,city,address FROM organizations WHERE project_id=$1 ORDER BY CASE role WHEN \'own\' THEN 0 ELSE 1 END,id',[profile.id])).rows;
      const cards=(await db.query('SELECT organization_id,source,url,match_status FROM source_cards WHERE project_id=$1 ORDER BY id',[profile.id])).rows;
      return organizations.map(o=>`${o.role==='own'?'Своя компания':'Конкурент'}: ${o.name}\n${o.city}, ${o.address}\n${cards.filter(c=>c.organization_id===o.id).map(c=>`${c.source}: ${c.url} (${c.match_status==='verified'?'филиал подтверждён':'филиал не подтверждён'})`).join('\n')}`).join('\n\n')+'\n\nИзменить: /setup. Предыдущая версия сохранится в истории.';
    }
    if(text==='/status'||text==='/report') {
      if(!profile) return 'Сначала настройте свою компанию: /setup.';
      const audit=(await db.query('SELECT id,status,stage,created_at FROM audit_runs WHERE project_id=$1 ORDER BY id DESC LIMIT 1',[profile.id])).rows[0];
      if(text==='/report') {
        const report=(await db.query('SELECT r.summary,r.created_at FROM reports r JOIN audit_projects p ON p.id=r.project_id WHERE r.project_id=$1 AND p.user_id=$2 ORDER BY r.id DESC LIMIT 1',[profile.id,user])).rows[0];
        if(report) return `Отчёт от ${new Date(report.created_at).toISOString()}:\n${String(report.summary).slice(0,3400)}`;
        return 'Отчёта пока нет. Настройки сохранены; сбор и анализ будут подключены на следующих этапах. Пустой аудит не создаётся.';
      }
      if(!audit) return 'Настройки сохранены. Аудит ещё не запускался; автоматический сбор пока не подключён.';
      const statuses:Record<string,string>={pending:'ожидает',running:'выполняется',completed:'завершён',partial:'завершён частично',failed:'ошибка'};
      const stages:Record<string,string>={collection:'сбор отзывов',analysis:'анализ',report:'отчёт'};
      return `Последний аудит: ${statuses[audit.status]??'неизвестно'}. Этап: ${stages[audit.stage]??'неизвестно'}. Дата: ${new Date(audit.created_at).toISOString()}.`;
    }
    if(!session) return 'Неизвестная команда. /help — список команд, /setup — настройка.';
    const next=advance(session.step,session.payload,text);
    if(next.save) {
      await this.saveProject(db,user,next.draft);
      await db.query('DELETE FROM telegram_sessions WHERE user_id=$1',[user]);
      return 'Настройки сохранены. /settings — проверить, /status — состояние. Сбор и анализ пока не подключены.';
    }
    await db.query('UPDATE telegram_sessions SET step=$2,payload=$3,updated_at=now() WHERE user_id=$1',[user,next.step,next.draft]);
    // Four full organization URLs and short fields fit below Telegram's 4096 limit.
    return next.text;
  }
  private async saveProject(db:PoolClient,user:string,draft:SetupDraft):Promise<void> {
    if(draft.organizations.length<1||draft.organizations.length>4) throw new Error('Invalid setup');
    const project=(await db.query('INSERT INTO audit_projects(user_id,name) VALUES($1,$2) RETURNING id',[user,draft.organizations[0].name])).rows[0].id;
    for(const [index,organization] of draft.organizations.entries()) {
      const org=(await db.query('INSERT INTO organizations(project_id,role,name,city,address) VALUES($1,$2,$3,$4,$5) RETURNING id',[project,index===0?'own':'competitor',organization.name,organization.city,organization.address])).rows[0].id;
      for(const card of organization.cards) await db.query('INSERT INTO source_cards(project_id,organization_id,source,external_id,url) VALUES($1,$2,$3,$4,$5)',[project,org,card.source,card.externalId,card.url]);
    }
    await db.query('INSERT INTO telegram_profiles(user_id,project_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET project_id=EXCLUDED.project_id',[user,project]);
  }
}
