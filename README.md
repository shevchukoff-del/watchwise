# WatchWise

WatchWise — учебный Next.js/TypeScript веб-сервис, который помогает быстро понять ценность YouTube-видео. Пользователь вставляет ссылку, сервис получает транскрипт через Supadata, отправляет его в OpenRouter LLM и показывает вердикт: смотреть, смотреть частично, достаточно конспекта или не стоит тратить время.

## Возможности

- анализ публичного YouTube-видео по транскрипту;
- структурированный результат: вердикт, польза, процент воды, краткое резюме, ключевые пункты и рекомендация;
- email/password вход через Supabase;
- сохранение истории проверок в личном кабинете;
- адаптивный AI SaaS-интерфейс без базы данных на стороне Next.js.

## Локальный запуск

```bash
npm install
cp .env.example .env.local
npm run dev
```

После запуска откройте `http://localhost:3000`.

## Переменные окружения

Создайте `.env.local` на основе `.env.example`:

```bash
SUPADATA_API_KEY=your_supadata_key_here
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=google/gemini-2.5-flash-lite
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

`SUPADATA_API_KEY` и `OPENROUTER_API_KEY` используются только на сервере в API route `/api/analyze`. Реальные ключи нельзя коммитить в GitHub.

## Supabase

1. Создайте проект в Supabase.
2. Включите Email authentication в разделе Authentication.
3. Скопируйте `Project URL` в `NEXT_PUBLIC_SUPABASE_URL`.
4. Скопируйте `anon public` key в `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. Откройте SQL Editor и выполните SQL из файла:

```text
supabase/migrations/001_create_analyses.sql
```

Таблица `analyses` использует Row Level Security: пользователь может читать, добавлять и удалять только свои записи.

## Проверки

```bash
npm run typecheck
npm run test
npm run build
```

Тесты используют моки Supabase и API-ответа, поэтому реальные ключи для них не нужны.

## Деплой на Vercel

1. Загрузите проект в GitHub.
2. Импортируйте репозиторий в Vercel.
3. В настройках проекта Vercel добавьте Environment Variables:
   - `SUPADATA_API_KEY`
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL=google/gemini-2.5-flash-lite`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Нажмите Deploy.

## Что вставить в поле ответа школы

Вставьте ссылку на опубликованный сайт Vercel, например:

```text
https://your-project-name.vercel.app
```
