> Архив инструкции Telegram-версии от 16.10.2026. Серверная установка позднее удалена по запросу владельца. Текущая версия — Android; см. основной README.

# review-audit-bot

Telegram-бот для репутационного аудита: одна своя компания и до трёх конкурентов, отзывы Яндекс.Карт и 2ГИС, анализ тональности и тем, сравнение и рекомендации с цитатами.

**Бот:** [@revie_audit_bot](https://t.me/revie_audit_bot). **Стек:** NestJS, TypeScript, PostgreSQL, OpenRouter. Приложение получает сообщения через Telegram long polling.

## 1. Команды бота

Работают только личные сообщения боту. Группы, голосовые сообщения и фотографии не обрабатываются. Команды вводятся в указанном виде, без суффикса `@имя_бота`.

### Настройка компаний

| Команда | Действие |
|---|---|
| `/start` | Описание сервиса и команды. Не удаляет настройки. |
| `/help` | Справка по основным командам. |
| `/setup` | Начать настройку своей компании и конкурентов. |
| `/add` | Добавить следующего конкурента, когда бот предлагает продолжить настройку. Максимум три. |
| `/done` | Завершить добавление компаний и перейти к проверке настроек. |
| `/save` | Сохранить проверенный черновик. Доступна на последнем шаге настройки. |
| `/resume` | Продолжить незавершённую настройку и повторить текущий вопрос. |
| `/cancel` | Удалить только черновик. Сохранённые настройки остаются. |
| `/settings` | Показать сохранённые компании, адреса и карточки источников. |
| `/sources` | Показать карточки, их внутренние ID и подтверждение филиалов. |
| `/confirm ID` | Подтвердить одну карточку из `/sources`, например `/confirm 12`. Это ID карточки в базе бота, не ID из URL площадки. |

`/setup` последовательно спрашивает название, город, точный адрес, ссылку 2ГИС и ссылку Яндекс.Карт. Вместо отсутствующей ссылки отправьте `-`. Для каждой компании нужна хотя бы одна карточка. Нужна полная HTTPS-ссылка на конкретный филиал; короткие ссылки и страницы поиска не принимаются.

После своей компании можно сразу выполнить `/done` или добавить конкурентов через `/add`. После четвёртой организации бот сам переходит к проверке. Настройки начинают действовать после `/save`. Повторный `/setup` создаёт новую версию проекта; прежние данные остаются в истории, старое расписание отключается. Совпадение филиала на двух площадках автоматически не подтверждается — проверьте адреса и выполните `/confirm ID` для каждой карточки.

### Сбор, анализ и отчёт

| Команда | Действие и условия |
|---|---|
| `/collect` | Поставить сбор подтверждённых карточек в очередь. Требуется `COLLECTION_ENABLED=true`. Неподключённый 2ГИС пропускается с сообщением. |
| `/analyze` | Поставить анализ новых или изменённых текстов в очередь. Требуются `ANALYSIS_ENABLED=true` и доступ к OpenRouter. До 1000 отзывов за запуск; повторить команду для следующей порции. |
| `/status` | Последний сбор по каждой карточке, ошибки, состояние анализа и автообновления. |
| `/report` | Сформировать сводку и файл `audit-ID.md` по всем сохранённым отзывам с актуальным анализом. При неизменных данных вернуть сохранённый отчёт. |
| `/report 2026-10-01 2026-10-16` | Тот же отчёт за единый период для всех компаний. Обе даты включительно, дни UTC. Отзывы без точной даты публикации исключаются. |

Сбор не запускает анализ автоматически при ручном использовании: выполните `/collect`, дождитесь результата в `/status`, затем `/analyze` и `/report`. Пока полный автоматический цикл выполняется, ручной повтор этих команд блокируется. Пустой сбор или отсутствие актуальных анализов не выдаются за готовый отчёт.

### Ежедневное обновление

| Команда | Действие |
|---|---|
| `/schedule` | Показать расписание и состояние фонового планировщика. |
| `/schedule 09:00 Asia/Yekaterinburg` | Ежедневно запускать сбор → анализ → отчёт в 09:00 по Екатеринбургу. Можно указать другой действительный часовой пояс IANA, например `Europe/Moscow` или `UTC`. |
| `/schedule off` | Отключить следующие запуски. Уже начатый цикл завершается. |

Нужны `SCHEDULER_ENABLED=true`, включённые сбор и анализ, запущенное приложение и подключение к интернету. После простоя выполняется одно догоняющее обновление, а не отдельный запуск за каждый пропущенный день. На Mac во сне или с закрытым приложением задачи не выполняются.

### Порядок первого использования

```text
/start
/setup
ответить на вопросы → /done → /save
/sources
/confirm ID   — отдельно для каждой проверенной карточки
/collect
/status       — дождаться окончания сбора
/analyze      — только в установке с работающим LLM
/status
/report
```

## 2. Что реализовано

- Раздельные проекты пользователей по Telegram ID; черновик настройки сохраняется в PostgreSQL.
- Сбор отзывов, оценки и исходные даты, отдельные ошибки CAPTCHA/доступа/лимитов/изменения разметки. По умолчанию до 150 отзывов на карточку за сбор.
- Дедупликация внутри карточки, сохранение изменений. Совпадения текстов между источниками помечаются, а не удаляются автоматически.
- Тональность `positive`, `negative`, `neutral`, `mixed`; темы: продукт, обслуживание, ожидание, цена, атмосфера, чистота, доступность, прочее.
- Проверка JSON, ID и точных цитат. Кэш анализа по версии текста, модели, промпта и схемы. Пустые тексты и тексты длиннее 12 000 символов в LLM не отправляются.
- Отчёт с числом отзывов, покрытием анализом, средней оценкой **выборки**, долями тем, жалобами и похвалой. Числа рассчитывает код, не LLM.
- До пяти действий по жалобам своей компании с цитатами, ID и доступными ссылками. Если оснований меньше трёх, дополнительные проблемы не выдумываются.
- Предупреждения о малой выборке, неизвестных датах и неполном сборе. Численные различия с конкурентом не показываются при менее 30 анализах у сравниваемой компании или неизвестных датах в выборке. Это описательное сравнение, не рейтинг или проверка статистической значимости.
- Очереди, ограниченные повторы, восстановление этапов после перезапуска и подавление повторных уведомлений об одной ошибке.

## 3. Что сейчас не работает или не подтверждено

Состояние серверной установки на **16.10.2026**:

| Компонент | Фактическое состояние |
|---|---|
| Telegram, настройка компаний, PostgreSQL | Работают. |
| Яндекс.Карты | Живой запрос с сервера получил отзыв; сбор включён. Полнота и доступность зависят от площадки. |
| LLM с сервера | OpenRouter отвечает `403 / access_denied`; анализ выключен. Сам ключ исправен: с Mac получены успешные ответы. Точная причина серверного ограничения не подтверждена. |
| 2ГИС с сервера | Выключен: браузер получает CAPTCHA, разрешённого ключа API отзывов нет. Chromium удалён для освобождения диска. |
| Полный цикл по расписанию | Код установлен, но выключен, поскольку серверный анализ недоступен. |
| Реальный отчёт | Модуль установлен, однако на последней проверке в рабочей базе было 0 отзывов, анализов и отчётов. Без анализов отчёт не создаётся. |
| Проверка качества для ВКР | Подготовлены 100 реальных отзывов для независимой разметки и вычислитель метрик. Разметка, реальные показатели качества и замер полного цикла ещё не выполнены. |

Бот не определяет поддельные отзывы, не гарантирует выгрузку всех отзывов площадки, не обходит CAPTCHA и не подтверждает филиалы автоматически. Общего «репутационного балла» нет. Рабочие локальная и серверная базы не синхронизируются автоматически.

Имена авторов в LLM не передаются; контакты, ссылки и слова с заглавной буквы маскируются. Маскировка эвристическая: перед внешней отправкой реального корпуса проверьте обезличивание вручную. Условия бесплатного endpoint не разрешают отправку персональных и конфиденциальных данных.

## 4. Запуск локально на Mac

### 4.1. Зависимости и база

Нужны Git, Node.js **22–26**, npm и PostgreSQL. Текущий сервер использует PostgreSQL 16; интеграционные тесты поднимают отдельную временную PostgreSQL 18.

Проверьте установленное:

```bash
node --version
npm --version
psql --version
```

Если Node.js или PostgreSQL отсутствуют, пример установки через Homebrew:

```bash
brew install node@24 postgresql@16
export PATH="$(brew --prefix node@24)/bin:$(brew --prefix postgresql@16)/bin:$PATH"
brew services start postgresql@16
```

Команды Homebrew: [Node.js 24](https://formulae.brew.sh/formula/node@24), [PostgreSQL 16](https://formulae.brew.sh/formula/postgresql@16). `export PATH` действует в текущем терминале.

Создайте отдельные локальные роль и базу **один раз**:

```bash
createuser --pwprompt review_audit_local
createdb --owner=review_audit_local review_audit_local
```

### 4.2. Репозиторий и `.env`

```bash
git clone git@github.com:GabuniyaHub/review-audit-bot.git
cd review-audit-bot
npm ci
cp -n .env.example .env
nano .env
```

Нужен доступ к приватному репозиторию GitHub. Если копия уже есть, используйте её; существующий `.env` не заменяйте.

Минимальный локальный пример для Яндекса и LLM:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://review_audit_local:ВАШ_ПАРОЛЬ@127.0.0.1:5432/review_audit_local
DB_SSL=false
DB_POOL_MAX=5

TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=ТОКЕН_ОТДЕЛЬНОГО_ТЕСТОВОГО_БОТА

COLLECTION_ENABLED=true
COLLECTION_MAX_REVIEWS=150
TWOGIS_MODE=api
TWOGIS_REVIEWS_KEY=

ANALYSIS_ENABLED=true
LLM_API_KEY=sk-or-v1-ВАШ_КЛЮЧ
LLM_MODEL=nvidia/nemotron-3-super-120b-a12b:free
LLM_TIMEOUT_MS=90000
ANALYSIS_BATCH_SIZE=5

SCHEDULER_ENABLED=false
SCHEDULER_RUN_TIMEOUT_MINUTES=720
```

Замените все значения-заглушки. Спецсимволы пароля в `DATABASE_URL` должны быть URL-кодированы. Используется `LLM_API_KEY` **или** `OPENROUTER_API_KEY`; если заданы оба, приоритет у `OPENROUTER_API_KEY`. Флаги принимают только `true`/`false`.

Для запуска без Telegram установите `TELEGRAM_ENABLED=false`: приложение и проверки доступны, но команды и доставка сообщений не работают. Для запуска без LLM установите `ANALYSIS_ENABLED=false`; пустой ключ допустим, пока анализ выключен.

### 4.3. Миграции и запуск

```bash
npm run db:migrate
npm run start:dev
```

`db:migrate` сначала собирает проект, затем применяет недостающие миграции. Схема не обновляется автоматически при обычном старте. `start:dev` перезапускает процесс после изменения исходников.

Для запуска готовой сборки:

```bash
npm run build
npm start
```

В другом терминале:

```bash
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
```

Ожидается HTTP 200. `live` подтверждает доступность процесса; `ready` — актуальную схему БД и готовность включённого Telegram poller. Доступность 2ГИС и OpenRouter эти проверки **не подтверждают**.

Проверка LLM на вымышленных текстах без обращения к БД:

```bash
node tools/check-llm.mjs
node tools/demo-report.mjs data/demo-report
```

Первая команда проверяет JSON-контракт, вторая создаёт демонстрационные `report.md`, `metrics.json`, `analysis.json` для четырёх вымышленных кофеен. Сборка и заполненный `.env` нужны; Telegram не запускается.

### 4.4. Один токен — один Telegram poller

Для разработки используйте отдельного тестового бота и локальную базу. Если нужен **тот же** токен, сначала остановите серверную службу:

```bash
ssh root@191.44.47.253 'systemctl stop review-audit-bot'
```

После работы остановите локальный процесс через `Ctrl+C` и верните серверную службу:

```bash
ssh root@191.44.47.253 'systemctl start review-audit-bot'
```

Второй poller того же токена вызывает конфликт Telegram. Также приложение откажется запускать polling, если у бота настроен webhook. Webhook автоматически не удаляется. При запуске с той же рабочей базой могут обрабатываться уже сохранённые задачи и сообщения outbox; для изолированной разработки нужна отдельная база.

### 4.5. Необязательный браузерный 2ГИС и расписание

Для 2ГИС через публичную страницу на Mac:

```bash
npx playwright install chromium --only-shell
```

В `.env` задайте `TWOGIS_MODE=browser` и перезапустите приложение. Ключ 2ГИС в этом режиме не используется. CAPTCHA останавливает сбор; сохранённой пользовательской браузерной сессии и автоматического прохождения CAPTCHA в сборщике нет.

Режим `TWOGIS_MODE=api` требует разрешённый `TWOGIS_REVIEWS_KEY` с доступом именно к отзывам. Обычный ключ другого API 2ГИС сам по себе не подтверждает этот доступ.

Для расписания включите `SCHEDULER_ENABLED=true` при уже включённых сборе и анализе, перезапустите приложение и задайте время через `/schedule`. Окно терминала и приложение должны продолжать работать.

## 5. Текущий сервер и Nginx

Сервер: `191.44.47.253`, Ubuntu 24.04. Код: `/opt/review-audit-bot`. Служба: `review-audit-bot`. Пользователь процесса: `review-audit`. База: `review_audit` в существующей PostgreSQL; её роль и данные отдельны от сайтов.

**Nginx установлен, но обслуживает два сайта, а не Telegram-бота.**

| Порт | Компонент | Доступ |
|---|---|---|
| 80, 443 | Nginx: `avtokond-ugra.ru`, `territoriya-dobroty.ru` | Публичный HTTP/HTTPS |
| 4080 | API `avtokond-ugra.ru` | Только `127.0.0.1`, через Nginx |
| 5001 | API `territoriya-dobroty.ru` | Только `127.0.0.1`, через Nginx |
| 3001 | NestJS бота, `/health/live`, `/health/ready` | Только `127.0.0.1` |
| 5432 | PostgreSQL | Только локальные интерфейсы |

Бот сам обращается к Telegram по HTTPS и опрашивает сообщения. Ему сейчас не нужны отдельный домен, сертификат, webhook или Nginx-конфигурация. Порт 3001 наружу открывать не требуется. Публичной веб-панели и API аудитов нет; HTTP-контроллеры приложения предназначены для проверки состояния.

### 5.1. Что включено в серверном `.env`

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
DB_POOL_MAX=5
DB_SSL=false
TELEGRAM_ENABLED=true
COLLECTION_ENABLED=true
TWOGIS_MODE=api
ANALYSIS_ENABLED=false
SCHEDULER_ENABLED=false
```

`DATABASE_URL`, Telegram-токен и ключ OpenRouter уже находятся в `/opt/review-audit-bot/.env`. Файл не выводите в чат и не коммитьте. Он принадлежит `root:review-audit`, права `640`. Ключ отзывов 2ГИС не задан. Не включайте серверный анализ и расписание до успешной проверки доступа к LLM.

### 5.2. Запуск и обслуживание текущей установки

```bash
ssh root@191.44.47.253
cd /opt/review-audit-bot

sudo systemctl status review-audit-bot --no-pager
sudo systemctl restart review-audit-bot
sudo journalctl -u review-audit-bot -n 100 --no-pager

curl http://127.0.0.1:3001/health/live
curl http://127.0.0.1:3001/health/ready
```

Для SSH используйте свой авторизованный ключ; если он не выбран автоматически, добавьте `-i /путь/к/ключу`. Изменения `.env` требуют перезапуска службы.

Действующая служба запускает:

```text
/usr/bin/node --max-old-space-size=96 /opt/review-audit-bot/dist/src/main.js
```

Автозапуск — через systemd, перезапуск при ошибке — через 10 секунд; лимит памяти — 192 МБ. Nginx для перезапуска бота трогать не нужно. Из-за ресурсов VPS Chromium не установлен; его запуск с текущими ограничениями службы не подтверждён.

### 5.3. Обновление текущего сервера

Сборку делайте на Mac, чтобы не устанавливать dev-зависимости на небольшом VPS. Сначала убедитесь, что нужный код запушен в `main` и нет несохранённых изменений.

На Mac, из репозитория:

```bash
npm ci
npm test
npm run test:integration
mkdir -p data
tar --no-xattrs -czf data/review-audit-build.tgz dist/src
scp data/review-audit-build.tgz root@191.44.47.253:/opt/review-audit-build.tgz
ssh -A root@191.44.47.253
```

`ssh -A` нужен, если приватный GitHub-репозиторий доступен только ключом из локального SSH-agent. Загрузите свой GitHub-ключ в agent заранее. Приватный ключ на сервер не копируется. Архив сборки и серверная Git-ревизия должны соответствовать друг другу.

На сервере, в этой SSH-сессии:

```bash
cd /opt/review-audit-bot
sudo systemctl stop review-audit-bot

umask 077
audit_backup_dir="/opt/review-audit-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$audit_backup_dir"
sudo -u postgres pg_dump -Fc review_audit > "$audit_backup_dir/database.dump"
cp .env "$audit_backup_dir/env"
tar -czf "$audit_backup_dir/build.tgz" dist package.json package-lock.json
git rev-parse HEAD > "$audit_backup_dir/revision"

umask 0022
git pull --ff-only origin main
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
tar -xzf /opt/review-audit-build.tgz -C /opt/review-audit-bot
chown -R root:review-audit dist node_modules
sudo -u review-audit node dist/src/database/migrate.js
sudo systemctl start review-audit-bot
```

Выполняйте шаги последовательно; если резервная копия, обновление или миграция завершились ошибкой, сначала устраните её, не переходите к следующим шагам. Не заменяйте `.env` примером из репозитория. После удаления dev-зависимостей команда `db:migrate` не подходит: используйте собранный `dist/src/database/migrate.js` или `npm run db:migrate:prod`.

После запуска проверьте:

```bash
systemctl status review-audit-bot --no-pager
curl http://127.0.0.1:3001/health/ready
curl -I https://avtokond-ugra.ru
curl -I https://territoriya-dobroty.ru
df -h /
```

Readiness во время старта может появиться не сразу. Возвращать старую сборку после новой миграции нужно с учётом версии схемы: простой откат файлов может привести к readiness 503. Восстановление БД выполняйте только из согласованной резервной копии при остановленной записи.

### 5.4. Если переносить на другой сервер

Нужны Node.js 22–26, PostgreSQL, Git, отдельные роль/база, системный пользователь `review-audit`, каталог `/opt/review-audit-bot` и приватный `.env`. Код/сборка и миграции устанавливаются как выше. PostgreSQL повторно не устанавливайте, если подходящий экземпляр уже работает; создайте отдельные роль и базу.

На новом сервере после установки Node.js и PostgreSQL создайте пользователя и рабочую копию. Выполняйте от root в SSH-сессии с доступом к GitHub; архив сборки заранее загрузите с Mac, как в разделе 5.3.

```bash
sudo useradd --system --user-group --home-dir /opt/review-audit-bot --shell /usr/sbin/nologin review-audit
git clone git@github.com:GabuniyaHub/review-audit-bot.git /opt/review-audit-bot
cd /opt/review-audit-bot
umask 0022
sudo npm ci --omit=dev --ignore-scripts --no-audit --no-fund
sudo cp -n .env.example .env
sudoedit /opt/review-audit-bot/.env
sudo tar -xzf /opt/review-audit-build.tgz -C /opt/review-audit-bot
sudo chown -R root:review-audit dist node_modules
sudo chown root:review-audit .env
sudo chmod 640 .env
```

В `.env` укажите реальные секреты и серверные параметры из раздела 5.1. Если этот пользователь или каталог уже существуют, повторно их не создавайте.

Пример создания роли и базы на Ubuntu, **только если их ещё нет**:

```bash
sudo -u postgres createuser --pwprompt review_audit
sudo -u postgres createdb --owner=review_audit review_audit
```

После создания БД и заполнения `DATABASE_URL` примените миграции:

```bash
cd /opt/review-audit-bot
sudo -u review-audit node dist/src/database/migrate.js
```

Пример unit-файла `/etc/systemd/system/review-audit-bot.service` для сборки без браузерного 2ГИС:

```ini
[Unit]
Description=Review Audit Telegram Bot
After=network-online.target postgresql.service
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=review-audit
Group=review-audit
WorkingDirectory=/opt/review-audit-bot
EnvironmentFile=/opt/review-audit-bot/.env
ExecStart=/usr/bin/node --max-old-space-size=96 /opt/review-audit-bot/dist/src/main.js
Restart=on-failure
RestartSec=10
TimeoutStopSec=40
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectHome=true
ProtectSystem=strict
MemoryHigh=128M
MemoryMax=192M

[Install]
WantedBy=multi-user.target
```

`/usr/bin/node` — путь на текущем VPS; на другом проверьте `command -v node`. Пользователь процесса должен читать `.env`, сборку и зависимости; каталог проекта и исполняемый код не должны быть доступны ему для записи.

После установки unit:

```bash
sudo chown root:review-audit /opt/review-audit-bot/.env
sudo chmod 640 /opt/review-audit-bot/.env
sudo systemctl daemon-reload
sudo systemctl enable --now review-audit-bot
```

Nginx для polling не требуется и на новом сервере. Его подключение понадобится только при добавлении публичного HTTP-интерфейса или переходе на webhook — эти функции сейчас не реализованы.

## 6. Настройки лимитов

Остальные значения можно оставить из `.env.example`.

| Переменная | По умолчанию | Назначение |
|---|---:|---|
| `DB_POOL_MAX` | 5 | Подключения к БД; при включённом Telegram минимум 2. |
| `DB_CONNECT_TIMEOUT_MS` | 5000 | Ожидание подключения к БД. |
| `DB_QUERY_TIMEOUT_MS` | 10000 | Тайм-аут SQL-запроса. |
| `COLLECTION_MAX_REVIEWS` | 150 | Лимит на карточку за сбор, допустимо 1–1000. |
| `COLLECTION_TIMEOUT_MS` | 15000 | Ожидание источника, 100–60000 мс. |
| `COLLECTION_PAGE_DELAY_MS` | 1000 | Пауза между страницами. |
| `TWOGIS_MODE` | `api` в коде | `api` или `browser`; в `.env.example` выбран `browser`, поэтому настройте явно. |
| `LLM_TIMEOUT_MS` | 90000 | Тайм-аут LLM, 1000–120000 мс. |
| `ANALYSIS_BATCH_SIZE` | 5 | Отзывов в одном запросе, 1–10. |
| `SCHEDULER_RUN_TIMEOUT_MINUTES` | 720 | Общий предел автоматического цикла, 5–1440 минут. |

Все фоновые компоненты по умолчанию выключены. `DB_SSL=false` подходит текущему локальному PostgreSQL. Для удалённой БД TLS включается через `DB_SSL=true` с доверенным сертификатом; SSL-параметры в `DATABASE_URL` запрещены конфигурацией приложения.

## 7. Проверки и эксперимент ВКР

```bash
npm test
npm run test:integration
```

Последняя проверка: **34 модульных теста и 14 проверок PostgreSQL прошли**. Интеграционные тесты создают временную базу, рабочую БД и реальные Telegram-сообщения не используют. Запускать обычным пользователем, не root.

Подготовка независимой разметки и подсчёт качества:

```bash
node tools/evaluate.mjs prepare input.json data/reference
node tools/evaluate.mjs score data/reference/reference.json predictions.json data/metrics.json
```

`input.json`: массив `{id, organization, source, rating, text}`. Ручные метки в `reference.json` изначально пустые; инструмент не подставляет ответы модели вместо эталона. Подробности и незавершённые пункты: [эксперимент ВКР](docs/stage-8-evaluation.md). Пример формата итогового файла: [демонстрационный отчёт на вымышленных данных](docs/examples/stage-6-demo.md).
