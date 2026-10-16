import { SetupDraft } from './types.js';
import { parseSourceUrl } from './source-url.js';
export type Step = 'name'|'city'|'address'|'2gis'|'yandex'|'next'|'confirm';
export interface DialogResult { step: Step; draft: SetupDraft; text: string; save?: boolean }
export function prompt(step: Step, draft: SetupDraft): string {
  const index=draft.organizations.length;
  const target=index===0 ? 'своей компании' : `конкурента №${index}`;
  switch(step) {
    case 'name': return `Введите название ${target}. Для отмены: /cancel.`;
    case 'city': return 'Введите город.';
    case 'address': return 'Введите точный адрес филиала.';
    case '2gis': return 'Пришлите HTTPS-ссылку на карточку этого филиала в 2ГИС. Если её нет — отправьте «-».';
    case 'yandex': return 'Пришлите HTTPS-ссылку на карточку этого филиала в Яндекс.Картах. Если её нет — отправьте «-». Нужна хотя бы одна площадка.';
    case 'next': return `Добавлено организаций: ${draft.organizations.length}. /add — добавить конкурента, /done — перейти к сохранению, /cancel — отменить.`;
    case 'confirm': return 'Проверьте настройки:\n'+draft.organizations.map((o,i)=>`${i===0?'Своя компания':`Конкурент ${i}`}: ${o.name}, ${o.city}, ${o.address}\n${o.cards.map(c=>c.url).join('\n')}`).join('\n\n')+'\n\n/save — сохранить, /cancel — отменить. Совпадение филиалов на площадках ещё не проверено автоматически.';
  }
}
export function advance(step: Step, original: SetupDraft, input: string): DialogResult {
  const draft=structuredClone(original); const text=input.trim();
  const result=(next:Step,message?:string):DialogResult=>({step:next,draft,text:message??prompt(next,draft)});
  if(step==='next') {
    if(text==='/done') return result('confirm');
    if(text==='/add') {
      if(draft.organizations.length>=4) return result(step,'Можно добавить не более трёх конкурентов. /done — завершить настройку.');
      draft.current={cards:[]}; return result('name');
    }
    return result(step);
  }
  if(step==='confirm') return text==='/save' ? {...result(step,'Настройки сохранены.'),save:true} : result(step);
  if(text.startsWith('/')) return result(step,'Сейчас ожидается ответ на вопрос. /resume — повторить вопрос, /cancel — отменить.');
  const current=draft.current??{cards:[]};draft.current=current;
  if(step==='name'||step==='city'||step==='address') {
    const max=step==='address'?300:120;
    if(!text || text.length>max || /[\u0000-\u001f\u007f]/.test(text)) return result(step,`Нужно от 1 до ${max} символов без управляющих знаков.`);
    current[step]=text;return result(step==='name'?'city':step==='city'?'address':'2gis');
  }
  try {
    if(text.length>2048) throw new Error('Ссылка слишком длинная.');
    const card=parseSourceUrl(text,step);
    if(card && draft.organizations.some(o=>o.cards.some(c=>c.source===card.source && c.externalId===card.externalId))) throw new Error('Эта карточка уже добавлена к другой организации.');
    if(step==='2gis') {current.cards=card?[card]:[];return result('yandex');}
    if(!card && !current.cards?.length) throw new Error('Нужна хотя бы одна карточка: добавьте Яндекс.Карты или начните настройку заново с 2ГИС.');
    if(card) current.cards=[...(current.cards??[]),card];
    if(!current.name||!current.city||!current.address) throw new Error('Неполная настройка. Начните заново: /setup.');
    draft.organizations.push({name:current.name,city:current.city,address:current.address,cards:current.cards??[]});
    delete draft.current;
    return result(draft.organizations.length===4?'confirm':'next');
  } catch(error) {return result(step,error instanceof Error?error.message:'Проверьте ссылку.');}
}
