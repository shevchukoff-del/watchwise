# WatchWise

Учебный веб-сервис на Next.js, который принимает ссылку на публичное YouTube-видео, получает транскрипт через Supadata API, отправляет его в LLM через OpenRouter API и показывает практический разбор: стоит ли смотреть ролик.

## Локальный запуск

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

После запуска откройте `http://localhost:3000`.

## Переменные окружения

Нужно создать `.env.local` на основе `.env.local.example`:

```bash
SUPADATA_API_KEY=your_supadata_key_here
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=google/gemini-2.5-flash-lite
```

`SUPADATA_API_KEY` и `OPENROUTER_API_KEY` используются только на сервере в API route `/api/analyze`. Не добавляйте реальные ключи в git и не используйте их на клиенте.

## Деплой на Vercel

1. Загрузите проект в GitHub.
2. Импортируйте репозиторий в Vercel.
3. В настройках проекта Vercel добавьте переменные окружения:
   `SUPADATA_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`.
4. Запустите деплой. Дополнительная настройка не нужна.

## Что вставить в поле ответа школы

В поле ответа школы вставьте ссылку на опубликованный сайт Vercel, например:

```text
https://your-project-name.vercel.app
```
