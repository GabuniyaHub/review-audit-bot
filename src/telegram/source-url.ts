import { SourceCardDraft } from './types.js';
export function parseSourceUrl(input: string, source: '2gis'|'yandex'): SourceCardDraft | null {
  if (input === '-') return null;
  let url: URL;
  try {url = new URL(input);} catch {throw new Error('Укажите полную ссылку https:// на карточку организации или «-».');}
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Нужна HTTPS-ссылка без логина, пароля и порта.');
  const hosts = source === '2gis' ? ['2gis.ru','www.2gis.ru'] : ['yandex.ru','yandex.com','www.yandex.ru','www.yandex.com'];
  if (!hosts.includes(url.hostname)) throw new Error(`Нужна карточка ${source === '2gis' ? '2ГИС' : 'Яндекс.Карт'}. Короткие ссылки сначала откройте в браузере.`);
  const match = source === '2gis' ? url.pathname.match(/^\/(?:[^/]+\/)?firm\/(\d{1,20})(?:\/|$)/) : url.pathname.match(/^\/maps\/org\/(?:[^/]+\/)?(\d{1,20})(?:\/|$)/);
  if (!match) throw new Error('Не найден ID карточки. Пришлите ссылку на организацию, а не поиск или сеть филиалов.');
  const canonical = source === '2gis' ? `https://2gis.ru/firm/${match[1]}/tab/reviews` : `https://yandex.ru/maps/org/${match[1]}/reviews/`;
  return {source, externalId:match[1], url:canonical};
}
