create extension if not exists pgcrypto;
create table if not exists public.players (id uuid primary key default gen_random_uuid(),player_code text not null unique,created_at timestamptz not null default now());
create table if not exists public.game_records (id uuid primary key default gen_random_uuid(),player_id uuid not null references public.players(id),game_type text not null check(game_type in ('quiz','pinball','guessing')),score integer not null default 0,completed boolean not null default false,attempt_id text not null unique,details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
create table if not exists public.guessing_sessions (id uuid primary key default gen_random_uuid(),player_id uuid not null references public.players(id),answer text not null,question_count integer not null default 0,conversation jsonb not null default '[]'::jsonb,completed boolean not null default false,created_at timestamptz not null default now());
create table if not exists public.generated_images (id uuid primary key default gen_random_uuid(),player_id uuid not null unique references public.players(id),storage_path text,status text not null default 'pending',created_at timestamptz not null default now());
create index if not exists idx_records_player on public.game_records(player_id);
create index if not exists idx_guess_player on public.guessing_sessions(player_id,created_at desc);
alter table public.players enable row level security;
alter table public.game_records enable row level security;
alter table public.guessing_sessions enable row level security;
alter table public.generated_images enable row level security;
-- No client RLS policy: only backend with service role key accesses these tables.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('rewards','rewards',true,10485760,array['image/png','image/webp']) on conflict(id) do nothing;
-- Storage object writes happen through backend's service-role key. Public read is deliberate for demo only.
