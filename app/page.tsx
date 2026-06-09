"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { VantaBackground } from "./VantaBackground";
import { getSupabaseClient, type AnalysisRecord } from "../lib/supabase";

type AnalyzeResponse = {
  analysis: string;
  title: string;
  verdict: string;
  usefulnessScore: number;
  waterPercent: number;
  summary: string;
  keyPoints: string[];
  recommendation: string;
  transcriptLength: number;
  transcriptLanguage: string;
  availableLanguages: string[];
};

type ErrorResponse = {
  error?: string;
};

const defaultPrompt =
  "Скажи прямо: смотреть видео полностью, частично, достаточно конспекта или не стоит тратить время. Оцени пользу и количество воды.";

const benefitItems = [
  "Краткий разбор вместо долгого просмотра",
  "Вердикт: смотреть полностью, частично или не тратить время",
  "Оценка пользы и количества “воды”",
  "История проверок в личном кабинете",
];

function isYoutubeUrl(value: string) {
  try {
    const url = new URL(value);
    return ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
      url.hostname.toLowerCase(),
    );
  } catch {
    return false;
  }
}

function scoreLabel(value: number) {
  return `${Math.max(1, Math.min(10, Math.round(value)))}/10`;
}

function verdictTone(verdict: string) {
  if (verdict.includes("Не стоит")) {
    return "skip";
  }

  if (verdict.includes("частично") || verdict.includes("конспекта")) {
    return "partial";
  }

  return "watch";
}

function formatAuthError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("security purposes") || normalized.includes("after")) {
    const seconds = message.match(/\d+/)?.[0];
    return seconds
      ? `Supabase временно ограничил повторный запрос. Подождите ${seconds} секунд и попробуйте снова.`
      : "Supabase временно ограничил повторный запрос. Подождите немного и попробуйте снова.";
  }

  if (normalized.includes("invalid login credentials")) {
    return "Неверный email или пароль.";
  }

  if (normalized.includes("email not confirmed")) {
    return "Email ещё не подтверждён. Проверьте письмо от Supabase.";
  }

  if (normalized.includes("user already registered") || normalized.includes("already")) {
    return "Аккаунт с таким email уже есть. Попробуйте войти.";
  }

  return message;
}

export default function Home() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [url, setUrl] = useState("");
  const [lang, setLang] = useState("auto");
  const [mode, setMode] = useState("auto");
  const [customPrompt, setCustomPrompt] = useState(defaultPrompt);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [history, setHistory] = useState<AnalysisRecord[]>([]);

  const loadHistory = useCallback(
    async (currentUser: User | null) => {
      if (!supabase || !currentUser) {
        setHistory([]);
        return;
      }

      const { data, error: historyError } = await supabase
        .from("analyses")
        .select("*")
        .eq("user_id", currentUser.id)
        .eq("analysis_type", "youtube_video")
        .order("created_at", { ascending: false })
        .limit(6);

      if (historyError) {
        setStatusMessage("Не удалось загрузить историю проверок.");
        return;
      }

      setHistory((data || []) as AnalysisRecord[]);
    },
    [supabase],
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) {
        return;
      }

      const currentUser = data.session?.user ?? null;
      setUser(currentUser);
      void loadHistory(currentUser);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      void loadHistory(currentUser);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadHistory, supabase]);

  async function saveAnalysis(data: AnalyzeResponse, currentUser: User) {
    if (!supabase) {
      setStatusMessage("Supabase не настроен: добавьте публичные переменные окружения.");
      return;
    }

    const record: AnalysisRecord = {
      user_id: currentUser.id,
      analysis_type: "youtube_video",
      input_url: url,
      title: data.title || null,
      verdict: data.verdict,
      usefulness_score: data.usefulnessScore,
      water_percent: data.waterPercent,
      summary: data.summary,
      key_points: data.keyPoints,
      recommendation: data.recommendation,
    };

    const { error: insertError } = await supabase.from("analyses").insert(record);

    if (insertError) {
      setStatusMessage("Разбор готов, но не удалось сохранить его в историю.");
      return;
    }

    setStatusMessage("Разбор сохранён в историю.");
    await loadHistory(currentUser);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatusMessage("");
    setResult(null);

    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setError("Вставьте ссылку на YouTube-видео.");
      return;
    }

    if (!isYoutubeUrl(trimmedUrl)) {
      setError("Ссылка должна вести на YouTube.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: trimmedUrl,
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

      if (user) {
        await saveAnalysis(data, user);
      } else {
        setStatusMessage("Войдите, чтобы сохранить проверку в историю.");
      }
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

  async function handleAuth(action: "sign-in" | "sign-up") {
    if (!supabase) {
      setAuthError("Supabase не настроен. Добавьте NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setAuthError("");
    setStatusMessage("");

    if (!email.trim() || password.length < 6) {
      setAuthError("Введите email и пароль минимум из 6 символов.");
      return;
    }

    setIsAuthLoading(true);

    const authResult =
      action === "sign-in"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });

    if (authResult.error) {
      setAuthError(formatAuthError(authResult.error.message));
    } else if (action === "sign-up") {
      setStatusMessage("Аккаунт создан. Если Supabase просит подтверждение, проверьте почту.");
    }

    setIsAuthLoading(false);
  }

  async function handleSignOut() {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setUser(null);
    setHistory([]);
  }

  return (
    <VantaBackground>
      <main className="page-shell">
        <section className="hero-screen" aria-labelledby="page-title">
          <div className="hero-copy">
            <p className="eyebrow">WatchWise</p>
            <h1 id="page-title">
              Пойми ценность YouTube-видео <em>за 10 секунд</em>
            </h1>
            <p className="subtitle">
              Вставь ссылку на ролик — WatchWise кратко покажет, что внутри,
              сколько в нем пользы и стоит ли смотреть видео полностью.
            </p>

            <div className="hero-actions">
              <a className="scroll-link" href="#advisor-form">
                Посмотреть за меня
              </a>
              <span>Без регистрации для первого разбора</span>
            </div>

            <div className="benefits-grid" aria-label="Преимущества WatchWise">
              {benefitItems.map((item) => (
                <div className="benefit-item" key={item}>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="advisor-section" id="advisor-form">
          <div className="section-heading">
            <p className="eyebrow">Analyze</p>
            <h2>Получить вердикт</h2>
          </div>

          <div className="content-grid">
            <div className="left-stack">
              <form className="panel form-card" onSubmit={handleSubmit}>
                <div className="field">
                  <label htmlFor="youtube-url">YouTube URL</label>
                  <input
                    id="youtube-url"
                    name="url"
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="Вставьте ссылку на YouTube-видео"
                  />
                </div>

                <button className="primary-button" type="submit" disabled={isLoading}>
                  {isLoading ? "Проверяем видео..." : "Проверить видео"}
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
                          <option value="auto">auto</option>
                          <option value="ru">ru</option>
                          <option value="en">en</option>
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
                          <option value="auto">auto</option>
                          <option value="native">native</option>
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

              <section className="panel auth-card" aria-labelledby="auth-title">
                <div className="card-kicker">Личный кабинет</div>
                <h3 id="auth-title">История полезных видео</h3>
                <p>
                  Войдите, чтобы сохранять историю проверок и возвращаться к
                  полезным видео позже.
                </p>

                {user ? (
                  <div className="signed-in">
                    <span>Вы вошли</span>
                    <strong>{user.email}</strong>
                    <button className="ghost-button" type="button" onClick={handleSignOut}>
                      Выйти
                    </button>
                  </div>
                ) : (
                  <div className="auth-form">
                    <input
                      aria-label="Email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="email@example.com"
                    />
                    <input
                      aria-label="Пароль"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Пароль"
                    />
                    <div className="auth-actions">
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={isAuthLoading}
                        onClick={() => void handleAuth("sign-in")}
                      >
                        Войти
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={isAuthLoading}
                        onClick={() => void handleAuth("sign-up")}
                      >
                        Создать аккаунт
                      </button>
                    </div>
                    {authError ? <p className="inline-error">{authError}</p> : null}
                  </div>
                )}
              </section>
            </div>

            <div className="right-stack" aria-live="polite">
              {error ? (
                <section className="panel error-card">
                  <h2>Ошибка</h2>
                  <p>{error}</p>
                </section>
              ) : null}

              {result ? (
                <section className="panel result-card">
                  <div className="result-heading">
                    <span className="result-badge">AI-разбор</span>
                    <h2>Вердикт WatchWise</h2>
                  </div>

                  <div className={`verdict-card ${verdictTone(result.verdict)}`}>
                    <span className="verdict-label">Вердикт</span>
                    <strong>{result.verdict}</strong>
                    {result.title ? <p>{result.title}</p> : null}
                  </div>

                  <div className="score-grid">
                    <div className="score-card">
                      <span>Оценка пользы</span>
                      <strong>{scoreLabel(result.usefulnessScore)}</strong>
                    </div>
                    <div className="score-card">
                      <span>Воды</span>
                      <strong>{result.waterPercent}%</strong>
                    </div>
                  </div>

                  <div className="analysis-block">
                    <h3>Краткий разбор</h3>
                    <p>{result.summary}</p>
                  </div>

                  <div className="analysis-block">
                    <h3>Главное из видео</h3>
                    <ul>
                      {result.keyPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="analysis-block recommendation">
                    <h3>Рекомендация</h3>
                    <p>{result.recommendation}</p>
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
                  <span>WatchWise покажет здесь вердикт, пользу, воду и краткий конспект.</span>
                </section>
              ) : null}

              {statusMessage ? <p className="status-message">{statusMessage}</p> : null}

              <section className="panel history-card" aria-labelledby="history-title">
                <div className="result-heading compact">
                  <span className="result-badge">Моя история</span>
                  <h2 id="history-title">Последние проверки</h2>
                </div>

                {!user ? (
                  <p className="muted">Войдите, чтобы сохранить проверку в историю.</p>
                ) : history.length > 0 ? (
                  <div className="history-list">
                    {history.map((item) => (
                      <article className="history-item" key={item.id || item.input_url}>
                        <div>
                          <strong>{item.verdict || "Без вердикта"}</strong>
                          <p>{item.summary || item.input_url}</p>
                        </div>
                        <span>
                          {item.usefulness_score ? `${item.usefulness_score}/10` : "—"}
                        </span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Пока нет сохранённых проверок.</p>
                )}
              </section>
            </div>
          </div>
        </section>
      </main>
    </VantaBackground>
  );
}
