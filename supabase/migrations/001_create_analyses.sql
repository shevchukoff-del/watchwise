create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_type text not null default 'youtube_video',
  input_url text not null,
  title text,
  verdict text,
  usefulness_score integer,
  water_percent integer,
  summary text,
  key_points jsonb,
  recommendation text,
  created_at timestamp with time zone default now()
);

alter table public.analyses enable row level security;

drop policy if exists "Users can select own analyses" on public.analyses;
create policy "Users can select own analyses"
on public.analyses
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own analyses" on public.analyses;
create policy "Users can insert own analyses"
on public.analyses
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own analyses" on public.analyses;
create policy "Users can delete own analyses"
on public.analyses
for delete
using (auth.uid() = user_id);
