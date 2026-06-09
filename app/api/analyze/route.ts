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

type StructuredAnalysis = {
  title: string;
  verdict: "Смотреть" | "Смотреть частично" | "Достаточно конспекта" | "Не стоит тратить время";
  usefulnessScore: number;
  waterPercent: number;
  summary: string;
  keyPoints: string[];
  recommendation: string;
  analysis: string;
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
      ...analysis,
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
}): Promise<StructuredAnalysis> {
  const userPrompt = [
    customPrompt
      ? `Пользовательский промпт:\n${customPrompt}`
      : "Пользовательский промпт не указан.",
    "Проанализируй транскрипт YouTube-видео и верни только валидный JSON без Markdown и пояснений вокруг.",
    "Не выдумывай факты за пределами транскрипта. Если данных мало, прямо скажи об этом в summary и recommendation.",
    "Схема JSON:",
    '{ "title": "короткое название ролика или пустая строка", "verdict": "Смотреть | Смотреть частично | Достаточно конспекта | Не стоит тратить время", "usefulnessScore": 8, "waterPercent": 30, "summary": "2-4 предложения", "keyPoints": ["3-5 коротких пунктов"], "recommendation": "практичная рекомендация" }',
    "verdict должен быть строго одним из четырех вариантов: Смотреть, Смотреть частично, Достаточно конспекта, Не стоит тратить время.",
    "usefulnessScore — целое число от 1 до 10. waterPercent — целое число от 0 до 100.",
    `Транскрипт:\n${transcript}`,
  ].join("\n\n");

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://watchwise-chi.vercel.app",
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

  return normalizeAnalysis(content.trim());
}

function normalizeAnalysis(content: string): StructuredAnalysis {
  const parsed = parseAnalysisJson(content);
  const verdict = normalizeVerdict(parsed.verdict);
  const usefulnessScore = clampInteger(parsed.usefulnessScore, 1, 10, 5);
  const waterPercent = clampInteger(parsed.waterPercent, 0, 100, 50);
  const keyPoints = Array.isArray(parsed.keyPoints)
    ? parsed.keyPoints.map((item) => stringify(item)).filter(Boolean).slice(0, 5)
    : [];

  const summary =
    stringify(parsed.summary) ||
    "Не удалось надежно выделить краткое содержание из ответа модели.";
  const recommendation =
    stringify(parsed.recommendation) ||
    "Используйте краткий разбор и решите, нужен ли полный просмотр.";

  const normalized: StructuredAnalysis = {
    title: stringify(parsed.title),
    verdict,
    usefulnessScore,
    waterPercent,
    summary,
    keyPoints:
      keyPoints.length > 0
        ? keyPoints
        : ["Модель не вернула отдельные ключевые пункты."],
    recommendation,
    analysis: "",
  };

  normalized.analysis = [
    `## Вердикт: ${normalized.verdict}`,
    `Польза: ${normalized.usefulnessScore}/10. Воды: ${normalized.waterPercent}%.`,
    normalized.summary,
    "### Ключевые пункты",
    ...normalized.keyPoints.map((point) => `- ${point}`),
    "### Рекомендация",
    normalized.recommendation,
  ].join("\n\n");

  return normalized;
}

function parseAnalysisJson(content: string): Record<string, unknown> {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return {
          summary: content,
          recommendation: "Ответ модели пришел в свободном формате, поэтому WatchWise показывает его как краткое резюме.",
        };
      }
    }

    return {
      summary: content,
      recommendation: "Ответ модели пришел в свободном формате, поэтому WatchWise показывает его как краткое резюме.",
    };
  }
}

function normalizeVerdict(value: unknown): StructuredAnalysis["verdict"] {
  const verdict = stringify(value);

  if (
    verdict === "Смотреть" ||
    verdict === "Смотреть частично" ||
    verdict === "Достаточно конспекта" ||
    verdict === "Не стоит тратить время"
  ) {
    return verdict;
  }

  const lower = verdict.toLowerCase();

  if (lower.includes("част")) {
    return "Смотреть частично";
  }

  if (lower.includes("консп")) {
    return "Достаточно конспекта";
  }

  if (lower.includes("не стоит") || lower.includes("пропуст")) {
    return "Не стоит тратить время";
  }

  return "Смотреть";
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(stringify(value), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
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
