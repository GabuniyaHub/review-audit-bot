# review-audit-bot

Telegram-бот для аудита и проверки отзывов, построенный на [Nest.js](https://nestjs.com/).

## Описание

Проект находится в начальной стадии разработки. Бот будет собирать и анализировать
отзывы, выявляя подозрительные и недобросовестные публикации.

## Стек

- **Runtime:** Node.js
- **Framework:** [Nest.js](https://nestjs.com/) (TypeScript)
- **Bot API:** Telegram Bot API

## Требования

- Node.js 20+
- npm 10+

## Установка

```bash
npm install
```

## Запуск

```bash
# режим разработки (watch)
npm run start:dev

# обычный запуск
npm run start

# production
npm run start:prod
```

## Переменные окружения

Создайте файл `.env` в корне проекта (в репозиторий не коммитится):

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

## Тесты

```bash
npm run test        # unit-тесты
npm run test:e2e    # e2e-тесты
npm run test:cov    # покрытие
```

## Структура проекта

```
src/
├── main.ts        # точка входа
├── app.module.ts  # корневой модуль
└── ...
```

## Лицензия

UNLICENSED
