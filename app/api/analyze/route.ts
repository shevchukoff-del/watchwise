import { NextResponse } from "next/server";

type AnalyzeRequest = {
  url?: unknown;
  lang?: unknown;
  mode?: unknown;
  customPrompt?: unknown;
};

type SupadataChunk = {
  text?: unknown;
};

type SupadataTranscript = {
  content?: unknown;
  transcript?: unknown;
  text?: unknown;
  lang?: unknown;
  language?: unknown;
  availableLangs?: unknown;
  availableLanguages?: unknown;
  languages?: unknown;
};

type SupadataJob = SupadataTranscript & {
  jobId?: unknown;
  id?: unknown;
  status?: unknown;
  result?: unknown;
};

const SUPADATA_BASE_URL = "https://api.supadata.ai/v1/transcript";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const MAX_TRANSCRIPT_CHARS = 45_000;
const MAX_POLL_ATTEMPTS = 20;
const POLL_DELAY_MS = 1_000;

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequest;
    const input = parseAnalyzeRequest(body);

    const supadataKey = process.env.SUPADATA_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!supadataKey) {
      return errorResponse("SUPADATA_API_KEY не настроен на сервере.", 500);
    }

    if (!openRouterKey) {
      return errorResponse("OPENROUTER_API_KEY не настроен на сервере.", 500);
    }

    const transcriptPayload = await getTranscript(input, supadataKey);
    const transcript = normalizeTranscript(transcriptPayload);

    if (!transcript.text.trim()) {
      return errorResponse(
        "Транскрипт пустой. Попробуйте другой ролик, язык или режим auto.",
        422,
      );
    }

    const limitedTranscript = transcript.text.slice(0, MAX_TRANSCRIPT_CHARS);
    const analysis = await analyzeTranscript({
      apiKey: openRouterKey,
      model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      customPrompt: input.customPrompt,
      transcript: limitedTranscript,
    });

    return NextResponse.json({
      analysis,
      transcriptLength: transcript.text.length,
      transcriptLanguage: transcript.language || input.lang,
      availableLanguages: transcript.availableLanguages,
    });
  } catch (error) {
    if (error instanceof UserFacingError) {
      return errorResponse(error.message, error.status);
    }

    console.error(error);
    return errorResponse(
      "Не удалось проанализировать ролик. Проверьте ссылку и попробуйте ещё раз.",
      500,
    );
  }
}

function parseAnalyzeRequest(body: AnalyzeRequest) {
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const lang = typeof body.lang === "string" ? body.lang : "auto";
  const mode = typeof body.mode === "string" ? body.mode : "native";
  const customPrompt =
    typeof body.customPrompt === "string" ? body.customPrompt.trim() : "";

  if (!url) {
    throw new UserFacingError("Вставьте ссылку на YouTube-видео.", 400);
  }

  if (!isAllowedYoutubeUrl(url)) {
    throw new UserFacingError(
      "Ссылка должна вести на youtube.com, www.youtube.com, m.youtube.com или youtu.be.",
      400,
    );
  }

  if (!["ru", "en", "auto"].includes(lang)) {
    throw new UserFacingError("Выберите корректный язык транскрипта.", 400);
  }

  if (!["native", "auto"].includes(mode)) {
    throw new UserFacingError("Выберите корректный режим Supadata.", 400);
  }

  return {
    url: normalizeYoutubeUrl(url),
    lang: lang as "ru" | "en" | "auto",
    mode: mode as "native" | "auto",
    customPrompt,
  };
}

function isAllowedYoutubeUrl(value: string) {
  try {
    const parsed = new URL(value);
    return [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
    ].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeYoutubeUrl(value: string) {
  const parsed = new URL(value);
  const host = parsed.hostname.toLowerCase();
  let videoId = "";

  if (host === "youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
  } else if (
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com"
  ) {
    const pathParts = parsed.pathname.split("/").filter(Boolean);

    if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v") || "";
    } else if (["shorts", "embed", "live"].includes(pathParts[0])) {
      videoId = pathParts[1] || "";
    }
  }

  if (!videoId) {
    return value;
  }

  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

async function getTranscript(
  input: ReturnType<typeof parseAnalyzeRequest>,
  apiKey: string,
) {
  const params = new URLSearchParams({
    url: input.url,
    text: "true",
    mode: input.mode,
  });

  if (input.lang !== "auto") {
    params.set("lang", input.lang);
  }

  const response = await fetch(`${SUPADATA_BASE_URL}?${params.toString()}`, {
    headers: {
      "x-api-key": apiKey,
    },
    cache: "no-store",
  });

  const data = (await readJson(response)) as SupadataJob;

  if (response.status === 202) {
    const jobId = getJobId(data);

    if (!jobId) {
      throw new UserFacingError(
        "Supadata приняла задачу, но не вернула jobId.",
        502,
      );
    }

    return pollTranscript(jobId, apiKey);
  }

  if (!response.ok) {
    throw new UserFacingError(
      formatProviderError("Supadata", parseProviderError(data, "ошибка API")),
      502,
    );
  }

  if (isPendingJob(data)) {
    const jobId = getJobId(data);

    if (jobId) {
      return pollTranscript(jobId, apiKey);
    }
  }

  return data;
}

async function pollTranscript(jobId: string, apiKey: string) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(POLL_DELAY_MS);
    }

    const response = await fetch(
      `${SUPADATA_BASE_URL}/${encodeURIComponent(jobId)}`,
      {
        headers: {
          "x-api-key": apiKey,
        },
        cache: "no-store",
      },
    );

    const data = (await readJson(response)) as SupadataJob;

    if (!response.ok) {
      throw new UserFacingError(
        formatProviderError("Supadata", parseProviderError(data, "ошибка API")),
        502,
      );
    }

    const status =
      typeof data.status === "string" ? data.status.toLowerCase() : "";

    if (status === "completed") {
      return unwrapSupadataResult(data);
    }

    if (status === "failed") {
      throw new UserFacingError(
        formatProviderError(
          "Supadata",
          parseProviderError(data, "не смогла получить транскрипт"),
        ),
        502,
      );
    }

    if (!["queued", "active", "processing", "pending"].includes(status)) {
      const normalized = normalizeTranscript(unwrapSupadataResult(data));

      if (normalized.text.trim()) {
        return unwrapSupadataResult(data);
      }
    }
  }

  throw new UserFacingError(
    "Supadata слишком долго готовит транскрипт. Попробуйте повторить запрос позже.",
    504,
  );
}

async function analyzeTranscript({
  apiKey,
  model,
  customPrompt,
  transcript,
}: {
  apiKey: string;
  model: string;
  customPrompt: string;
  transcript: string;
}) {
  const userPrompt = [
    customPrompt
      ? `Пользовательский промпт:\n${customPrompt}`
      : "Пользовательский промпт не указан.",
    "Проанализируй транскрипт YouTube-видео в формате Markdown. Сделай ответ живым, но не рекламным: используй 1 уместный эмодзи в заголовке каждой секции.",
    "Обязательно верни ВСЕ разделы ниже. Не останавливайся после вердикта. Если данных в транскрипте мало, всё равно заполни каждый раздел короткой честной фразой.",
    "Структура ответа строго такая:",
    "## 🎯 Вердикт",
    "Выбери только один основной вариант: смотреть / пропустить. Добавь 1 короткое объяснение. Если ролик стоит смотреть быстрее, укажи это как совет, но не как отдельный вердикт.",
    "## 🧭 Кратко за 5 пунктов",
    "Пять коротких bullet-пунктов по сути ролика.",
    "## 💡 Главные идеи",
    "Самые полезные инсайты без воды.",
    "## 👤 Кому подойдёт",
    "Для какой аудитории ролик будет полезен.",
    "## ⏭️ Кому можно пропустить",
    "Кому не стоит тратить время.",
    "## 🏃 Можно ли слушать на пробежке?",
    "Ответ да/нет и почему.",
    "## ⭐ Оценка пользы",
    "Оценка от 1 до 10 и строка звёзд, например: ★★★★★★★☆☆☆ 7/10.",
    `Транскрипт:\n${transcript}`,
  ].join("\n\n");

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://youtube-video-advisor.vercel.app",
      "X-Title": "WatchWise",
    },
    body: JSON.stringify({
      model,
      temperature: 0.25,
      max_tokens: 1800,
      messages: [
        {
          role: "system",
          content:
            "Ты строгий аналитик YouTube-контента. Пиши по-русски. Не выдумывай факты за пределами транскрипта. Если данных мало, прямо скажи об этом. Давай прикладной, полезный ответ.",
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
    cache: "no-store",
  });

  const data = (await readJson(response)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    error?: unknown;
  };

  if (!response.ok) {
    throw new UserFacingError(
      formatProviderError("OpenRouter", parseProviderError(data, "ошибка API")),
      502,
    );
  }

  const content = data.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new UserFacingError("OpenRouter вернул пустой ответ.", 502);
  }

  return content.trim();
}

function normalizeTranscript(value: unknown) {
  const payload = unwrapSupadataResult(value) as SupadataTranscript;
  const content = payload.content ?? payload.transcript ?? payload.text;
  const text = normalizeContent(content);
  const language = stringify(payload.lang ?? payload.language);
  const availableLanguages = normalizeLanguages(
    payload.availableLangs ?? payload.availableLanguages ?? payload.languages,
  );

  return {
    text,
    language,
    availableLanguages,
  };
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((chunk: SupadataChunk | unknown) => {
        if (chunk && typeof chunk === "object" && "text" in chunk) {
          return stringify((chunk as SupadataChunk).text);
        }

        return stringify(chunk);
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function normalizeLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return stringify(record.lang ?? record.language ?? record.code ?? record.name);
      }

      return "";
    })
    .filter(Boolean);
}

function unwrapSupadataResult(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const payload = value as SupadataJob;
  return payload.result ?? payload;
}

function getJobId(data: SupadataJob) {
  return stringify(data.jobId ?? data.id);
}

function isPendingJob(data: SupadataJob) {
  const status = typeof data.status === "string" ? data.status.toLowerCase() : "";
  return Boolean(getJobId(data)) && ["queued", "active", "processing", "pending"].includes(status);
}

function parseProviderError(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const error = record.error;
    const message = record.message;

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }

    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }

    if (error && typeof error === "object") {
      const errorMessage = (error as Record<string, unknown>).message;

      if (typeof errorMessage === "string" && errorMessage.trim()) {
        return errorMessage.trim();
      }
    }
  }

  return fallback;
}

function formatProviderError(provider: string, message: string) {
  return `${provider}: ${message}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function stringify(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

class UserFacingError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
