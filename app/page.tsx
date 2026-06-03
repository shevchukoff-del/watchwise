"use client";

import { FormEvent, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { VantaBackground } from "./VantaBackground";

type AnalyzeResponse = {
  analysis: string;
  transcriptLength: number;
  transcriptLanguage: string;
  availableLanguages: string[];
};

type ErrorResponse = {
  error?: string;
};

const defaultPrompt =
  "Скажи прямо: стоит ли смотреть этот ролик или лучше пропустить. Если полезен только частично, объясни, какие фрагменты можно смотреть быстрее.";

export default function Home() {
  const [url, setUrl] = useState("");
  const [lang, setLang] = useState("auto");
  const [mode, setMode] = useState("auto");
  const [customPrompt, setCustomPrompt] = useState(defaultPrompt);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          lang,
          mode,
          customPrompt,
        }),
      });

      const data = (await response.json()) as AnalyzeResponse & ErrorResponse;

      if (!response.ok) {
        throw new Error(data.error || "Не удалось выполнить анализ.");
      }

      setResult(data);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Не удалось выполнить анализ.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <VantaBackground>
      <main className="page-shell">
        <section className="hero-screen" aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="eyebrow">WatchWise</p>
            <h1 id="page-title" aria-label="WatchWise посмотрит за вас">
              <span aria-hidden="true">WatchWise</span>
              <span aria-hidden="true">посмотрит</span>
              <em aria-hidden="true">за вас</em>
            </h1>
            <p className="subtitle">
              Вставьте ссылку на YouTube-ролик — AI прочитает транскрипт и
              скажет главное: смотреть или пропустить.
            </p>

            <a className="scroll-link" href="#advisor-form">
              Начать анализ
            </a>
          </div>
        </section>

        <section className="advisor-section" id="advisor-form">
          <div className="section-heading">
            <p className="eyebrow">Analyze</p>
            <h2>Проверить видео</h2>
          </div>

          <div className="content-grid">
          <form className="panel form-card" onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="youtube-url">YouTube URL</label>
              <input
                id="youtube-url"
                name="url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                required
              />
            </div>

            <button className="primary-button" type="submit" disabled={isLoading}>
              {isLoading ? "Проверяем..." : "Проверить видео"}
            </button>

            <details className="advanced-settings">
              <summary>Дополнительные настройки</summary>

              <div className="advanced-body">
                <div className="form-row">
                  <div className="field">
                    <label htmlFor="lang">Язык транскрипта</label>
                    <select
                      id="lang"
                      name="lang"
                      value={lang}
                      onChange={(event) => setLang(event.target.value)}
                    >
                      <option value="ru">ru</option>
                      <option value="en">en</option>
                      <option value="auto">auto</option>
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="mode">Режим Supadata</label>
                    <select
                      id="mode"
                      name="mode"
                      value={mode}
                      onChange={(event) => setMode(event.target.value)}
                    >
                      <option value="native">native</option>
                      <option value="auto">auto</option>
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="custom-prompt">Пользовательский промпт</label>
                  <textarea
                    id="custom-prompt"
                    name="customPrompt"
                    value={customPrompt}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                    placeholder="Например: оцени, есть ли в видео практические советы для новичка."
                  />
                </div>
              </div>
            </details>

            <p className="hint">
              Обработка длинных видео может занять до 20 секунд, если Supadata
              вернёт задачу на подготовку транскрипта.
            </p>
          </form>

          <div aria-live="polite">
            {error ? (
              <section className="panel error-card">
                <h2>Ошибка</h2>
                <p>{error}</p>
              </section>
            ) : null}

            {result ? (
              <section className="panel result-card">
                <div className="result-heading">
                  <span className="result-badge">✨ AI-разбор</span>
                  <h2>Вердикт WatchWise</h2>
                </div>

                <div className="analysis">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {result.analysis}
                  </ReactMarkdown>
                </div>

                <div className="meta-grid" aria-label="Метаданные транскрипта">
                  <div className="meta-item">
                    <span className="meta-label">Символов</span>
                    <span className="meta-value">
                      {result.transcriptLength.toLocaleString("ru-RU")}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Язык</span>
                    <span className="meta-value">
                      {result.transcriptLanguage || "не указан"}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Доступные языки</span>
                    <span className="meta-value">
                      {result.availableLanguages.length > 0
                        ? result.availableLanguages.join(", ")
                        : "не вернулись"}
                    </span>
                  </div>
                </div>
              </section>
            ) : null}

            {!error && !result ? (
              <section className="panel empty-card">
                <p>
                  Результат появится здесь после запроса к Supadata и OpenRouter.
                </p>
              </section>
            ) : null}
          </div>
          </div>
        </section>
      </main>
    </VantaBackground>
  );
}
