import { createHash } from 'node:crypto';
import { AnalysisResult, redact, validateResult, TOPICS, SENTIMENTS } from '../analysis/contract.js';
export const REPORT_VERSION='comparison-v1';
export interface Period {from:string|null;to:string|null}
export interface Snapshot {projectId:string;model:string;promptVersion:string;schemaVersion:string;period:Period;organizations:{id:string;name:string;role:string;city:string;address:string}[];cards:{id:string;organization_id:string;source:string;url:string;match_status:string;status:string|null;error_code:string|null;stop_reason:string|null}[];reviews:{id:string;organization_id:string;source:string;source_url:string|null;card_url:string;content_hash:string;text:string;rating:number|null;published_at:string|null;collected_at:string;result:unknown}[]}
export const LABELS:Record<string,string>={product:'Продукт и услуги',service:'Обслуживание',waiting:'Ожидание',price:'Цена',atmosphere:'Атмосфера',cleanliness:'Чистота',accessibility:'Доступность',other:'Прочее'};
const ACTIONS:Record<string,string>={product:'Проверить стабильность качества и разобрать описанные случаи с командой.',service:'Разобрать ситуации обслуживания и согласовать стандарт общения с гостями.',waiting:'Замерить время ожидания в часы нагрузки и проверить распределение работы.',price:'Проверить прозрачность меню, доплат и информирования о стоимости.',atmosphere:'Проверить описанные неудобства в зале и выбрать конкретное улучшение.',cleanliness:'Проверить уборку и ввести контроль чистоты в часы нагрузки.',accessibility:'Проверить доступность входа, графика и информации для посетителей.',other:'Разобрать подтверждённые жалобы и определить ответственное действие.'};
const md=(s:unknown)=>String(s??'').replace(/[\\`*_{}\[\]<>#|]/g,'\\$&').replace(/[\r\n]+/g,' ');
const SOURCE_LABELS:Record<string,string>={'2gis':'2ГИС',yandex:'Яндекс.Карты'};
const STATUS_LABELS:Record<string,string>={pending:'ожидает',running:'выполняется',completed:'доступные страницы обработаны',partial:'частичная выборка',failed:'ошибка',limit:'достигнут лимит выборки',exhausted:'доступные страницы обработаны',captcha:'требуется CAPTCHA',forbidden:'доступ отклонён',rate_limited:'ограничена частота запросов',timeout:'истекло время ожидания',unavailable:'источник недоступен',layout_changed:'изменился формат площадки',invalid_data:'ошибка данных',not_configured:'источник не подключён'};
const pct=(n:number,d:number)=>d?Math.round(n/d*1000)/10:null;
export function parsePeriod(command:string):Period {
 const parts=command.trim().split(/\s+/);if(parts.length===1)return {from:null,to:null};
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(parts.length!==3||!valid(parts[1])||!valid(parts[2])||parts[1]>parts[2])throw new Error('Формат: /report или /report ГГГГ-ММ-ДД ГГГГ-ММ-ДД.');
 return {from:parts[1]+'T00:00:00.000Z',to:new Date(Date.parse(parts[2])+86400000).toISOString()};
}
function safeLink(raw:string|null):string|null {try{const u=new URL(raw??'');if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['2gis.ru','yandex.ru','yandex.com'].includes(u.hostname))return u.toString().replace(/[()]/g,c=>encodeURIComponent(c));}catch{}return null;}
export function buildReport(snapshot:Snapshot,createdAt=new Date().toISOString()) {
 const from=snapshot.period.from,to=snapshot.period.to;
 const selected=snapshot.reviews.filter(r=>(!from||!!r.published_at&&r.published_at>=from)&&(!to||!!r.published_at&&r.published_at<to));
 const unknownDates=snapshot.reviews.filter(r=>!r.published_at).length;
 const analyses=new Map<string,AnalysisResult>();let invalidAnalyses=0;
 for(const r of selected)if(r.result){try{const result=validateResult({reviews:[r.result]},[{id:r.id,text:redact(r.text),contentHash:r.content_hash}])[0];if(r.text.trim())analyses.set(r.id,result);}catch{invalidAnalyses++;}}
 const organizations=snapshot.organizations.map(o=>{
  const reviews=selected.filter(r=>r.organization_id===o.id),analyzed=reviews.filter(r=>analyses.has(r.id));
  const ratings=reviews.filter(r=>r.rating!==null);
  const sentiments=Object.fromEntries(SENTIMENTS.map(s=>[s,analyzed.filter(r=>analyses.get(r.id)!.sentiment===s).length]));
  const topics=TOPICS.map(topic=>{const hits=analyzed.filter(r=>analyses.get(r.id)!.topics.some(t=>t.topic===topic));const count=(s:string)=>hits.filter(r=>analyses.get(r.id)!.topics.some(t=>t.topic===topic&&t.sentiment===s)).length;return {topic,count:hits.length,share:pct(hits.length,analyzed.length),positive:count('positive'),negative:count('negative'),mixed:count('mixed'),neutral:count('neutral')};});
  return {...o,total:reviews.length,textReviews:reviews.filter(r=>r.text.trim()).length,analyzed:analyzed.length,ratings:ratings.length,sampleAverage:ratings.length?Math.round(ratings.reduce((a,r)=>a+r.rating!,0)/ratings.length*100)/100:null,sentiments,topics,coverage:pct(analyzed.length,reviews.filter(r=>r.text.trim()).length)};
 });
 const own=organizations.find(o=>o.role==='own');
 const recommendations=own?own.topics.filter(t=>t.negative+t.mixed>0).sort((a,b)=>(b.negative+b.mixed)-(a.negative+a.mixed)||a.topic.localeCompare(b.topic)).slice(0,5).map(t=>({topic:t.topic,count:t.negative+t.mixed,action:ACTIONS[t.topic],evidence:selected.filter(r=>r.organization_id===own.id&&analyses.get(r.id)?.topics.some(x=>x.topic===t.topic&&['negative','mixed'].includes(x.sentiment))).slice(0,3).map(r=>({reviewId:r.id,quote:analyses.get(r.id)!.topics.find(x=>x.topic===t.topic)!.evidence,url:safeLink(r.source_url)||safeLink(r.card_url)}))})):[];
 const comparisons=own?organizations.filter(o=>o.role==='competitor').flatMap(o=>own.topics.map(t=>{const other=o.topics.find(x=>x.topic===t.topic)!;return {competitorId:o.id,topic:t.topic,negativeDifferencePp:own.analyzed>=30&&o.analyzed>=30&&!(selected.some(r=>!r.published_at))?Math.round(((t.negative+t.mixed)/own.analyzed-(other.negative+other.mixed)/o.analyzed)*1000)/10:null};})):[];
 const warnings:string[]=[];
 if(snapshot.organizations.length<4)warnings.push('Настроено меньше четырёх организаций.');
 if(organizations.some(o=>o.analyzed<30))warnings.push('Малая выборка: меньше 30 проанализированных отзывов хотя бы у одной организации. Ранжирование не выполняется.');
 if(organizations.some(o=>o.analyzed<o.textReviews))warnings.push('Часть текстовых отзывов не имеет актуального проверенного анализа.');
 if(snapshot.cards.some(c=>c.status!=='completed'||c.error_code||c.stop_reason==='limit'||c.match_status!=='verified'))warnings.push('Источники собраны не полностью, недоступны или филиал не подтверждён; см. таблицу источников.');
 if(unknownDates)warnings.push(`${unknownDates} отзывов без точной даты публикации${from?': исключены из заданного периода':': входят в общую выборку, календарная сопоставимость не установлена'}.`);
 const fingerprints=selected.map(r=>createHash('sha256').update(r.text.trim()).digest('hex'));const duplicates=fingerprints.length-new Set(fingerprints).size;
 if(duplicates)warnings.push(`Совпадений текста в выборке: ${duplicates}; записи автоматически не удаляются, независимость наблюдений не гарантируется.`);
 if(invalidAnalyses)warnings.push(`Отклонено анализов с неверными доказательствами: ${invalidAnalyses}.`);
 const eligible=selected.length>0;const analyzedTotal=organizations.reduce((a,o)=>a+o.analyzed,0);
 const metrics={version:REPORT_VERSION,createdAt,model:snapshot.model,promptVersion:snapshot.promptVersion,schemaVersion:snapshot.schemaVersion,period:snapshot.period,organizations,comparisons,recommendations,unknownDates,invalidAnalyses,duplicateTexts:duplicates,warnings,analyzedTotal};
 let markdown=`# Репутационный аудит\n\nСформирован: ${createdAt}\n\nПериод: ${from?`${from.slice(0,10)} — ${new Date(Date.parse(to!)-86400000).toISOString().slice(0,10)} включительно`:'все сохранённые отзывы; единый календарный период не задан'}.\n\nМодель: ${md(snapshot.model)}; промпт: ${md(snapshot.promptVersion)}; схема: ${md(snapshot.schemaVersion)}.\n\n## Ограничения\n\n${warnings.length?warnings.map(w=>'- '+w).join('\n'):'- Выводы описывают собранную выборку и не доказывают причинные связи.'}\n\n## Сравнение выборок\n\n| Компания | Отзывов | Текстовых | Проанализировано | Оценок | Средняя оценка выборки |\n|---|---:|---:|---:|---:|---:|\n`;
 for(const o of organizations)markdown+=`| ${md(o.name)}${o.role==='own'?' (своя)':''} | ${o.total} | ${o.textReviews} | ${o.analyzed} | ${o.ratings} | ${o.sampleAverage??'нет данных'} |\n`;
 markdown+='\nСредняя оценка выборки — не официальный рейтинг площадки. Доля темы считается от числа отзывов с актуальным анализом; каждый отзыв учитывается в теме один раз. Тональность текста и звёзды — разные показатели.\n\n## Источники и полнота\n\n';
 for(const c of snapshot.cards){const o=organizations.find(o=>o.id===c.organization_id);const rows=selected.filter(r=>r.organization_id===c.organization_id&&r.source===c.source);markdown+=`- ${md(o?.name)} / ${md(SOURCE_LABELS[c.source]??c.source)}: ${rows.length} отзывов в периоде; состояние: ${md(c.status?STATUS_LABELS[c.status]??c.status:'сбор не запускался')}; ${md(STATUS_LABELS[c.error_code??c.stop_reason??'']??'полнота не подтверждена')}; филиал: ${c.match_status==='verified'?'подтверждён':'не подтверждён'}.\n`;}
 const dates=selected.map(r=>r.collected_at).sort();markdown+=`\nСбор выбранных записей: ${dates[0]??'нет данных'} — ${dates.at(-1)??'нет данных'}.\n`;
 for(const o of organizations){markdown+=`\n## ${md(o.name)}\n\n${md(o.city)}, ${md(o.address)}. Покрытие анализом: ${o.coverage??0}%.\n\nТональность: положительная ${o.sentiments.positive}, отрицательная ${o.sentiments.negative}, нейтральная ${o.sentiments.neutral}, смешанная ${o.sentiments.mixed}.\n\n| Тема | Упоминаний | Доля | Похвала | Жалобы | Смешанные | Нейтральные |\n|---|---:|---:|---:|---:|---:|---:|\n`;for(const t of o.topics.filter(t=>t.count))markdown+=`| ${LABELS[t.topic]} | ${t.count} | ${t.share}% | ${t.positive} | ${t.negative} | ${t.mixed} | ${t.neutral} |\n`;}
 markdown+='\n## Отличия от конкурентов\n\nОписательные различия доли отрицательных и смешанных упоминаний в проанализированной выборке, в процентных пунктах. Плюс означает большую долю у своей компании. Это не оценка статистической значимости и не рейтинг.\n\n';
 for(const o of organizations.filter(o=>o.role==='competitor')){const rows=comparisons.filter(c=>c.competitorId===o.id&&c.negativeDifferencePp!==null&&c.negativeDifferencePp!==0);markdown+=`- ${md(o.name)}: ${rows.length?rows.map(c=>`${LABELS[c.topic]} ${c.negativeDifferencePp!>0?'+':''}${c.negativeDifferencePp} п.п.`).join('; '):'нет достаточных данных или ненулевых различий'}.\n`;}
 markdown+='\n## Приоритетные действия\n\nРекомендации — предложения для проверки, а не доказанные причины проблем. Приоритет определяется числом отрицательных и смешанных упоминаний.\n\n';
 for(const [i,r] of recommendations.entries()){markdown+=`${i+1}. **${LABELS[r.topic]}** — ${r.action} Оснований: ${r.count} отзывов.\n`;for(const e of r.evidence)markdown+=`   - Отзыв ${e.reviewId}: «${md(e.quote)}»${e.url?` — [источник](${e.url})`:''}.\n`;}
 if(!recommendations.length)markdown+='Недостаточно подтверждённых жалоб для приоритетных действий.\n';
 if(recommendations.length<3)markdown+='\nВыдано меньше трёх действий: дополнительные проблемы не выдумываются.\n';
 const summary=`Аудит: ${own?.name??'проект'}. Проанализировано ${analyzedTotal} из ${organizations.reduce((a,o)=>a+o.textReviews,0)} текстовых отзывов.\n${organizations.map(o=>`${o.name}: ${o.analyzed} анализов, средняя оценка выборки ${o.sampleAverage??'нет данных'}.`).join('\n')}\n${recommendations.length?recommendations.map((r,i)=>`${i+1}. ${LABELS[r.topic]}: ${r.action}`).join('\n'):'Недостаточно данных для рекомендаций.'}\n${warnings.length?'Есть ограничения выборки: '+warnings.join(' '):''}\nПодробности — в Markdown-файле отчёта.`.slice(0,3500);
 return {metrics,markdown,summary,eligible,partial:warnings.length>0||!analyzedTotal};
}
