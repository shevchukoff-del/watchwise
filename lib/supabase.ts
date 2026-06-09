import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AnalysisRecord = {
  id?: string;
  user_id: string;
  analysis_type: "youtube_video";
  input_url: string;
  title: string | null;
  verdict: string | null;
  usefulness_score: number | null;
  water_percent: number | null;
  summary: string | null;
  key_points: string[] | null;
  recommendation: string | null;
  created_at?: string;
};

let client: SupabaseClient | null = null;

export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  if (!client) {
    client = createClient(url, anonKey);
  }

  return client;
}
