import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "../app/page";
import type { AnalysisRecord } from "../lib/supabase";

const supabaseState = vi.hoisted(() => ({
  enabled: false,
  user: null as { id: string; email: string } | null,
  history: [] as AnalysisRecord[],
}));

const mockFetchResponse = {
  analysis: "## Вердикт",
  title: "Тестовое видео",
  verdict: "Смотреть частично",
  usefulnessScore: 8,
  waterPercent: 30,
  summary: "Видео полезное, но не все фрагменты одинаково важны.",
  keyPoints: ["Главная идея", "Практический вывод", "Что можно пропустить"],
  recommendation: "Посмотрите ключевые фрагменты и пропустите длинные вступления.",
  transcriptLength: 1200,
  transcriptLanguage: "ru",
  availableLanguages: ["ru", "en"],
};

vi.mock("../app/VantaBackground", () => ({
  VantaBackground: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../lib/supabase", () => ({
  getSupabaseClient: () => {
    if (!supabaseState.enabled) {
      return null;
    }

    return {
      auth: {
        getSession: vi.fn(async () => ({
          data: {
            session: supabaseState.user ? { user: supabaseState.user } : null,
          },
        })),
        onAuthStateChange: vi.fn(() => ({
          data: {
            subscription: {
              unsubscribe: vi.fn(),
            },
          },
        })),
        signInWithPassword: vi.fn(async () => ({
          data: { user: supabaseState.user },
          error: null,
        })),
        signUp: vi.fn(async () => ({
          data: { user: supabaseState.user },
          error: null,
        })),
        signOut: vi.fn(async () => ({ error: null })),
      },
      from: vi.fn(() => {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          order: vi.fn(() => query),
          limit: vi.fn(async () => ({
            data: supabaseState.history.filter(
              (record) => record.user_id === supabaseState.user?.id,
            ),
            error: null,
          })),
          insert: vi.fn(async (record: AnalysisRecord) => {
            supabaseState.history.unshift({
              ...record,
              id: "saved-id",
              created_at: new Date().toISOString(),
            });

            return { error: null };
          }),
        };

        return query;
      }),
    };
  },
}));

function mockAnalyzeFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => mockFetchResponse,
    })),
  );
}

describe("WatchWise homepage", () => {
  beforeEach(() => {
    supabaseState.enabled = false;
    supabaseState.user = null;
    supabaseState.history = [];
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the homepage", () => {
    render(<Home />);

    expect(screen.getAllByText("WatchWise").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", {
        name: /Пойми ценность YouTube-видео за 10 секунд/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Вставьте ссылку на YouTube-видео"),
    ).toBeInTheDocument();
  });

  it("validates empty and invalid URLs", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Проверить видео" }));
    expect(screen.getByText("Вставьте ссылку на YouTube-видео.")).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("Вставьте ссылку на YouTube-видео"),
      "https://example.com/video",
    );
    await user.click(screen.getByRole("button", { name: "Проверить видео" }));

    expect(screen.getByText("Ссылка должна вести на YouTube.")).toBeInTheDocument();
  });

  it("shows structured result after a valid submit", async () => {
    mockAnalyzeFetch();
    const user = userEvent.setup();
    render(<Home />);

    await user.type(
      screen.getByPlaceholderText("Вставьте ссылку на YouTube-видео"),
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    await user.click(screen.getByRole("button", { name: "Проверить видео" }));

    expect(await screen.findByText("Смотреть частично")).toBeInTheDocument();
    expect(screen.getByText("Вердикт")).toBeInTheDocument();
    expect(screen.getByText("Оценка пользы")).toBeInTheDocument();
    expect(screen.getByText("Краткий разбор")).toBeInTheDocument();
    expect(screen.getByText("Рекомендация")).toBeInTheDocument();
    expect(screen.getByText("8/10")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("Главная идея")).toBeInTheDocument();
    expect(
      screen.getAllByText("Войдите, чтобы сохранить проверку в историю.").length,
    ).toBeGreaterThan(0);
  });

  it("renders auth elements and unauthenticated history message", () => {
    render(<Home />);

    expect(screen.getByText("Личный кабинет")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Пароль")).toBeInTheDocument();
    expect(
      screen.getByText("Войдите, чтобы сохранить проверку в историю."),
    ).toBeInTheDocument();
  });

  it("shows only the current user's history and saves a new analysis", async () => {
    supabaseState.enabled = true;
    supabaseState.user = { id: "user-1", email: "me@example.com" };
    supabaseState.history = [
      {
        id: "own",
        user_id: "user-1",
        analysis_type: "youtube_video",
        input_url: "https://www.youtube.com/watch?v=own",
        title: "Свое видео",
        verdict: "Смотреть",
        usefulness_score: 9,
        water_percent: 15,
        summary: "Своя сохраненная проверка",
        key_points: ["Пункт"],
        recommendation: "Смотреть",
      },
      {
        id: "foreign",
        user_id: "user-2",
        analysis_type: "youtube_video",
        input_url: "https://www.youtube.com/watch?v=foreign",
        title: "Чужое видео",
        verdict: "Не стоит тратить время",
        usefulness_score: 2,
        water_percent: 80,
        summary: "Чужая запись",
        key_points: ["Нельзя показывать"],
        recommendation: "Пропустить",
      },
    ];
    mockAnalyzeFetch();
    const user = userEvent.setup();

    render(<Home />);

    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
    expect(screen.getByText("Своя сохраненная проверка")).toBeInTheDocument();
    expect(screen.queryByText("Чужая запись")).not.toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("Вставьте ссылку на YouTube-видео"),
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    await user.click(screen.getByRole("button", { name: "Проверить видео" }));

    await waitFor(() => {
      expect(screen.getByText("Разбор сохранён в историю.")).toBeInTheDocument();
    });
    expect(screen.getAllByText(mockFetchResponse.summary).length).toBeGreaterThan(0);
    expect(screen.queryByText("Чужая запись")).not.toBeInTheDocument();
  });
});
